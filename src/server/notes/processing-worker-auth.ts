import { timingSafeEqual } from "node:crypto";

export type ProcessingWorkerAuthorization =
  | { ok: true }
  | { code: "WORKER_NOT_CONFIGURED" | "WORKER_UNAUTHORIZED"; ok: false };

function equalSecrets(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

export function authorizeProcessingWorker(
  authorizationHeader: string | null,
  configuredSecret =
    process.env.PROCESSING_WORKER_SECRET ?? process.env.CRON_SECRET,
): ProcessingWorkerAuthorization {
  if (!configuredSecret || configuredSecret.length < 16) {
    return { code: "WORKER_NOT_CONFIGURED", ok: false };
  }

  const prefix = "Bearer ";
  if (!authorizationHeader?.startsWith(prefix)) {
    return { code: "WORKER_UNAUTHORIZED", ok: false };
  }

  const receivedSecret = authorizationHeader.slice(prefix.length);
  if (!equalSecrets(receivedSecret, configuredSecret)) {
    return { code: "WORKER_UNAUTHORIZED", ok: false };
  }

  return { ok: true };
}
