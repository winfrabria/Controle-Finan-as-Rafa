import "server-only";

import { getInvoiceStorageConfig, validateInvoiceFile } from "@/lib/storage";
import { getStorageAdminClient } from "@/server/storage/admin-client";
import {
  assertInvoiceObjectPath,
  createInvoiceObjectPath,
} from "@/server/storage/paths";

export class InvoiceStorageError extends Error {
  constructor(
    public readonly operation: "signed-url" | "upload",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "InvoiceStorageError";
  }
}

export async function uploadInvoiceFile(input: {
  bytes: ArrayBuffer | Uint8Array;
  contentType: string;
  fileName: string;
  noteId: string;
  workId: string;
}) {
  const config = getInvoiceStorageConfig();
  const file = validateInvoiceFile({
    bytes: input.bytes,
    contentType: input.contentType,
    fileName: input.fileName,
    maxFileSizeBytes: config.maxFileSizeBytes,
  });
  const path = createInvoiceObjectPath({
    extension: file.extension,
    noteId: input.noteId,
    workId: input.workId,
  });
  const client = getStorageAdminClient();
  const { data, error } = await client.storage.from(config.bucket).upload(
    path,
    file.bytes,
    {
      cacheControl: "3600",
      contentType: file.mimeType,
      upsert: false,
    },
  );

  if (error) {
    throw new InvoiceStorageError(
      "upload",
      "Supabase Storage could not persist the invoice file.",
      { cause: error },
    );
  }

  return {
    bucket: config.bucket,
    contentType: file.mimeType,
    originalFileName: file.originalFileName,
    path: data.path,
    size: file.size,
  } as const;
}

export async function createInvoiceSignedUrl(input: {
  download?: boolean | string;
  expiresInSeconds?: number;
  path: string;
}) {
  const config = getInvoiceStorageConfig();
  const path = assertInvoiceObjectPath(input.path);
  const expiresInSeconds =
    input.expiresInSeconds ?? config.signedUrlTtlSeconds;

  if (
    !Number.isSafeInteger(expiresInSeconds) ||
    expiresInSeconds <= 0 ||
    expiresInSeconds > 60 * 60
  ) {
    throw new Error("Signed URL lifetime must be between 1 and 3600 seconds.");
  }

  const client = getStorageAdminClient();
  const { data, error } = await client.storage
    .from(config.bucket)
    .createSignedUrl(path, expiresInSeconds, {
      download: input.download,
    });

  if (error) {
    throw new InvoiceStorageError(
      "signed-url",
      "Supabase Storage could not create a signed invoice URL.",
      { cause: error },
    );
  }

  return {
    expiresInSeconds,
    signedUrl: data.signedUrl,
  } as const;
}
