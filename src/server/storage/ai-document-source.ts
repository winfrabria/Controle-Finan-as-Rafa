import "server-only";
import { getInvoiceStorageConfig, validateInvoiceFile } from "@/lib/storage";
import { getStorageAdminClient } from "./admin-client";
import { assertInvoiceObjectPath } from "./paths";

/** Public signed URLs can be sent directly; private/local storage needs bytes. */
export function requiresInlineDocument(signedUrl: string) {
  const { hostname, protocol } = new URL(signedUrl);
  if (!['http:', 'https:'].includes(protocol)) throw new Error("Unsupported document URL protocol.");
  const host = hostname.toLowerCase();
  return protocol === "http:" || host === "localhost" || host === "[::1]" ||
    /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) || host.endsWith(".local") || host.endsWith(".internal");
}

export async function resolveAiDocumentSource(input: {
  signedUrl: string; path: string; mimeType: string; fileName: string; forceInline?: boolean;
}, dependencies: { download?: (path: string) => Promise<Blob> } = {}) {
  const localSource = requiresInlineDocument(input.signedUrl);
  if (!localSource && !input.forceInline) return input.signedUrl;
  const path = assertInvoiceObjectPath(input.path);
  const config = getInvoiceStorageConfig();
  // Download by validated storage path, never by a user-supplied URL (SSRF).
  const download = dependencies.download ?? (async (safePath: string) => {
    const { data, error } = await getStorageAdminClient().storage.from(config.bucket).download(safePath);
    if (error || !data) throw new Error("Could not read the private document for analysis.");
    return data;
  });
  const blob = await download(path);
  if (blob.size > config.maxFileSizeBytes) throw new Error("Private document exceeds the upload limit.");
  const file = validateInvoiceFile({ bytes: await blob.arrayBuffer(), contentType: input.mimeType,
    fileName: input.fileName, maxFileSizeBytes: config.maxFileSizeBytes });
  return `data:${file.mimeType};base64,${Buffer.from(file.bytes).toString("base64")}`;
}
