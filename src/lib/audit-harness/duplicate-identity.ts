import type { DuplicateCandidate, HarnessInvoice } from "./contracts";

export function originalFileHash(value: string | null | undefined): string | null {
  return value && /^[a-f0-9]{64}$/i.test(value) ? value.toLowerCase() : null;
}

export function fiscalDocumentNumber(value: string | null | undefined): string | null {
  return value?.replace(/[^\p{L}\p{N}]+/gu, "").toLocaleLowerCase("pt-BR") || null;
}

export function fiscalSupplierId(value: string | null | undefined): string | null {
  return value?.replace(/\D/g, "") || null;
}

export function hasCompleteFiscalIdentity(
  value: Pick<HarnessInvoice, "documentNumber" | "supplierTaxId" | "issuedAt" | "totalAmount">,
): boolean {
  return Boolean(fiscalDocumentNumber(value.documentNumber) && fiscalSupplierId(value.supplierTaxId) &&
    value.issuedAt && value.totalAmount !== null);
}

export function findRepeatedOriginal(invoice: HarnessInvoice, candidates: DuplicateCandidate[]) {
  const hash = originalFileHash(invoice.originalFileSha256);
  return hash ? candidates.find((candidate) => originalFileHash(candidate.originalFileSha256) === hash) : undefined;
}
