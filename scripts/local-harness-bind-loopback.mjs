// Local validation only. Recreate the two published containers with loopback
// bindings, preserving named volumes and stopped originals for recovery.
import http from "node:http";
import { execFileSync } from "node:child_process";
const project = "winfra-harness-20260907";
const host = JSON.parse(execFileSync("docker", ["context", "inspect", "--format", "{{json .Endpoints.docker}}"], { encoding: "utf8" })).Host;
const socketPath = host.startsWith("npipe://") ? host.slice("npipe://".length).replaceAll("/", "\\")
  : host.startsWith("unix://") ? host.slice("unix://".length) : null;
if (!socketPath) throw new Error("Only a local Docker socket is permitted.");
function api(method, path, body, binary = false) {
  return new Promise((resolve, reject) => {
    const request = http.request({ socketPath, method, path: `/v1.47${path}`, headers: { "Content-Type": Buffer.isBuffer(body) ? "application/x-tar" : "application/json" } }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => { chunks.push(chunk); });
      response.on("end", () => {
        if (response.statusCode >= 300) return reject(new Error(`Docker ${method} failed (${response.statusCode}).`));
        const content = Buffer.concat(chunks);
        resolve(binary ? content : content.length ? JSON.parse(content.toString()) : null);
      });
    });
    request.on("error", reject);
    request.end(Buffer.isBuffer(body) ? body : body ? JSON.stringify(body) : undefined);
  });
}
for (const service of ["db", "kong", "auth"]) {
  const name = `supabase_${service}_${project}`;
  const container = await api("GET", `/containers/${name}/json`);
  if (container.Name !== `/${name}`) throw new Error("Unexpected target.");
  const authChange = service === "auth" && container.Config.Env.includes("GOTRUE_EXTERNAL_EMAIL_ENABLED=false");
  if (service === "auth") {
    if (!container.Config.Env.includes("GOTRUE_DISABLE_SIGNUP=true")) throw new Error("Public signups must remain disabled.");
    if (!authChange) { console.log(`${name}: email login enabled; public signup blocked`); continue; }
    container.Config.Env = container.Config.Env.map((value) => value === "GOTRUE_EXTERNAL_EMAIL_ENABLED=false" ? "GOTRUE_EXTERNAL_EMAIL_ENABLED=true" : value);
  }
  if (service === "db" && !container.Mounts.some((mount) => mount.Type === "volume" && mount.Name === `supabase_db_${project}`)) {
    throw new Error("Database must use the expected named volume.");
  }
  const bindings = container.HostConfig.PortBindings ?? {};
  const backup = `${name}-before-loopback`;
  const restoreGatewayFiles = async () => {
    // CLI-injected certificates and gateway configuration are in the writable
    // container layer, not a mount. Transfer privately without logging secrets.
    const archive = await api("GET", `/containers/${backup}/archive?path=/home/kong`, undefined, true);
    await api("PUT", `/containers/${name}/archive?path=/home`, archive);
  };
  if (!authChange && Object.values(bindings).flat().every((binding) => binding.HostIp === "127.0.0.1")) {
    await api("POST", `/containers/${backup}/update`, { RestartPolicy: { Name: "no" } });
    if (service === "kong" && container.State.Restarting) {
      await restoreGatewayFiles();
      await api("POST", `/containers/${name}/restart?t=10`);
    }
    console.log(`${name}: already loopback-only`); continue;
  }
  for (const binding of Object.values(bindings).flat()) binding.HostIp = "127.0.0.1";
  const endpoints = Object.fromEntries(Object.entries(container.NetworkSettings.Networks).map(([network, data]) => [network, { Aliases: data.Aliases }]));
  // Retained originals must never auto-start against the same named DB volume.
  await api("POST", `/containers/${name}/update`, { RestartPolicy: { Name: "no" } });
  await api("POST", `/containers/${name}/stop?t=20`);
  await api("POST", `/containers/${name}/rename?name=${backup}`);
  try {
    await api("POST", `/containers/create?name=${name}`, {
      ...container.Config, Hostname: "", HostConfig: container.HostConfig,
      NetworkingConfig: { EndpointsConfig: endpoints },
    });
    if (service === "kong") await restoreGatewayFiles();
    await api("POST", `/containers/${name}/start`);
    const current = await api("GET", `/containers/${name}/json`);
    if (!current.State.Running) throw new Error("New container did not start.");
    console.log(`${name}: bound to 127.0.0.1; stopped original retained as ${backup}`);
  } catch (error) {
    // Do not remove volumes or overwrite a replacement on an uncertain failure.
    console.error(`Loopback setup interrupted. Original retained as ${backup}; check Docker before retrying.`);
    throw error;
  }
}
