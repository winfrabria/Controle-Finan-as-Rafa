import "server-only";

import { randomUUID } from "node:crypto";

import type { InvoiceFileExtension } from "@/lib/storage";

const SAFE_IDENTIFIER_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const INVOICE_OBJECT_PATH_PATTERN =
  /^obras\/[A-Za-z0-9_-]{1,128}\/notas\/[A-Za-z0-9_-]{1,128}\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(pdf|jpg|png)$/;

function assertSafeIdentifier(value: string, fieldName: string) {
  if (!SAFE_IDENTIFIER_PATTERN.test(value)) {
    throw new Error(`${fieldName} contains unsafe characters.`);
  }
}

export function createInvoiceObjectPath(input: {
  extension: InvoiceFileExtension;
  noteId: string;
  workId: string;
}) {
  assertSafeIdentifier(input.workId, "workId");
  assertSafeIdentifier(input.noteId, "noteId");

  return `obras/${input.workId}/notas/${input.noteId}/${randomUUID()}.${input.extension}`;
}

export function assertInvoiceObjectPath(path: string) {
  if (!INVOICE_OBJECT_PATH_PATTERN.test(path)) {
    throw new Error("The Storage object path is not a valid invoice path.");
  }

  return path;
}
