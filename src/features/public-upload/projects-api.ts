import {
  PUBLIC_UPLOAD_ENDPOINTS,
  type ProjectOption,
  type ProjectsResponse,
} from "./api-contract";

const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_RETRY_DELAY_MS = 250;
const DEFAULT_ATTEMPTS = 2;

type ProjectsRequestOptions = {
  attempts?: number;
  fetchImpl?: typeof fetch;
  retryDelayMs?: number;
  timeoutMs?: number;
};

function isProjectOption(value: unknown): value is ProjectOption {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ProjectOption>;
  return (
    typeof candidate.id === "string" &&
    candidate.id.length > 0 &&
    typeof candidate.nome === "string" &&
    candidate.nome.length > 0 &&
    (candidate.local === undefined ||
      candidate.local === null ||
      typeof candidate.local === "string")
  );
}

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => {
    globalThis.setTimeout(resolve, milliseconds);
  });
}

export async function requestProjects(
  options: ProjectsRequestOptions = {},
): Promise<ProjectOption[]> {
  const attempts = Math.max(1, options.attempts ?? DEFAULT_ATTEMPTS);
  const fetchImpl = options.fetchImpl ?? fetch;
  const retryDelayMs = Math.max(
    0,
    options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS,
  );
  const timeoutMs = Math.max(1, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetchImpl(PUBLIC_UPLOAD_ENDPOINTS.projects, {
        cache: "no-store",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("PROJECTS_REQUEST_FAILED");

      const payload = (await response.json()) as ProjectsResponse;
      if (!Array.isArray(payload.obras) || !payload.obras.every(isProjectOption)) {
        throw new Error("PROJECTS_INVALID_RESPONSE");
      }

      return payload.obras;
    } catch (error) {
      lastError = error;
    } finally {
      globalThis.clearTimeout(timeout);
    }

    if (attempt + 1 < attempts && retryDelayMs > 0) {
      await wait(retryDelayMs);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("PROJECTS_REQUEST_FAILED");
}
