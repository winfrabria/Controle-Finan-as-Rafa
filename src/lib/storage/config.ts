export const INVOICE_STORAGE_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
] as const;

export type InvoiceStorageMimeType =
  (typeof INVOICE_STORAGE_MIME_TYPES)[number];

export const DEFAULT_INVOICE_BUCKET = "notas-fiscais";
export const DEFAULT_INVOICE_MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
export const DEFAULT_SIGNED_URL_TTL_SECONDS = 5 * 60;

const BUCKET_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;

function parsePositiveInteger(
  value: string | undefined,
  fallback: number,
  variableName: string,
) {
  if (value === undefined || value === "") {
    return fallback;
  }

  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${variableName} must be a positive integer.`);
  }

  return parsed;
}

export function getInvoiceStorageConfig(
  environment: NodeJS.ProcessEnv = process.env,
) {
  const bucket = environment.SUPABASE_STORAGE_BUCKET ?? DEFAULT_INVOICE_BUCKET;

  if (!BUCKET_NAME_PATTERN.test(bucket)) {
    throw new Error(
      "SUPABASE_STORAGE_BUCKET must contain only lowercase letters, numbers and hyphens.",
    );
  }

  const maxFileSizeBytes = parsePositiveInteger(
    environment.SUPABASE_STORAGE_MAX_FILE_SIZE_BYTES,
    DEFAULT_INVOICE_MAX_FILE_SIZE_BYTES,
    "SUPABASE_STORAGE_MAX_FILE_SIZE_BYTES",
  );
  const signedUrlTtlSeconds = parsePositiveInteger(
    environment.SUPABASE_STORAGE_SIGNED_URL_TTL_SECONDS,
    DEFAULT_SIGNED_URL_TTL_SECONDS,
    "SUPABASE_STORAGE_SIGNED_URL_TTL_SECONDS",
  );

  if (signedUrlTtlSeconds > 60 * 60) {
    throw new Error(
      "SUPABASE_STORAGE_SIGNED_URL_TTL_SECONDS cannot exceed 3600 seconds.",
    );
  }

  return {
    bucket,
    maxFileSizeBytes,
    signedUrlTtlSeconds,
  } as const;
}
