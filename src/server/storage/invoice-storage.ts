import "server-only";

import { getInvoiceStorageConfig, validateInvoiceFile } from "@/lib/storage";
import { getStorageAdminClient } from "@/server/storage/admin-client";
import {
  assertInvoiceObjectPath,
  createInvoiceObjectPath,
} from "@/server/storage/paths";

export class InvoiceStorageError extends Error {
  constructor(
    public readonly operation: "remove" | "signed-url" | "upload",
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
  path?: string;
  workId: string;
}) {
  const config = getInvoiceStorageConfig();
  const file = validateInvoiceFile({
    bytes: input.bytes,
    contentType: input.contentType,
    fileName: input.fileName,
    maxFileSizeBytes: config.maxFileSizeBytes,
  });
  const path = input.path
    ? assertInvoiceObjectPath(input.path)
    : createInvoiceObjectPath({
        extension: file.extension,
        noteId: input.noteId,
        workId: input.workId,
      });
  const expectedPrefix = `obras/${input.workId}/notas/${input.noteId}/`;

  if (!path.startsWith(expectedPrefix)) {
    throw new Error("The Storage path does not belong to the informed note.");
  }
  const client = getStorageAdminClient();
  const { data, error } = await client.storage.from(config.bucket).upload(
    path,
    file.bytes,
    {
      cacheControl: "0",
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

export async function removeInvoiceFile(path: string) {
  const config = getInvoiceStorageConfig();
  const safePath = assertInvoiceObjectPath(path);
  const client = getStorageAdminClient();
  const { error } = await client.storage.from(config.bucket).remove([safePath]);

  if (error) {
    throw new InvoiceStorageError(
      "remove",
      "Supabase Storage could not remove the invoice file.",
      { cause: error },
    );
  }
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
