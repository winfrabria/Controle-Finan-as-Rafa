import "dotenv/config";
import { createConnection } from "node:net";

// next start keeps loaded server modules in memory. Replacing .next while it
// serves requests can mix old analysis code with new assets on disk.
if (process.env.HARNESS_ISOLATED_LOCAL === "true") {
  const target = new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://127.0.0.1:3117");
  if (target.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(target.hostname) || !target.port) {
    throw new Error("O build isolado exige NEXT_PUBLIC_APP_URL local com porta explícita.");
  }
  const listening = await new Promise((resolve, reject) => {
    const socket = createConnection({ host: "127.0.0.1", port: Number(target.port) });
    socket.setTimeout(2000);
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("error", error => {
      socket.destroy();
      if (error.code === "ECONNREFUSED") resolve(false);
      else reject(error);
    });
    socket.once("timeout", () => {
      socket.destroy();
      reject(new Error("Não foi possível confirmar se o servidor local está parado."));
    });
  });
  if (listening) {
    throw new Error(`Pare o servidor local da porta ${target.port} antes do build e reinicie-o após a compilação. Sobrescrever .next com o servidor ativo deixa versões antigas em memória.`);
  }
}
