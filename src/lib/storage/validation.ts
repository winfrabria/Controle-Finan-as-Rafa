import {
  getInvoiceStorageConfig,
  type InvoiceStorageMimeType,
} from "@/lib/storage/config";

export type InvoiceFileExtension = "jpg" | "pdf" | "png";

export type InvoiceFileValidationErrorCode =
  | "EMPTY_FILE"
  | "FILE_TOO_LARGE"
  | "INVALID_EXTENSION"
  | "INVALID_FILE_SIGNATURE"
  | "INVALID_MIME_TYPE"
  | "MIME_TYPE_MISMATCH";

export class InvoiceFileValidationError extends Error {
  constructor(
    public readonly code: InvoiceFileValidationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "InvoiceFileValidationError";
  }
}

type FileTypeDefinition = {
  extension: InvoiceFileExtension;
  mimeType: InvoiceStorageMimeType;
  signature: readonly number[];
};

const FILE_TYPES: readonly FileTypeDefinition[] = [
  {
    extension: "pdf",
    mimeType: "application/pdf",
    signature: [0x25, 0x50, 0x44, 0x46, 0x2d],
  },
  {
    extension: "jpg",
    mimeType: "image/jpeg",
    signature: [0xff, 0xd8, 0xff],
  },
  {
    extension: "png",
    mimeType: "image/png",
    signature: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  },
];

const MIME_ALIASES: Readonly<Record<string, InvoiceStorageMimeType>> = {
  "application/pdf": "application/pdf",
  "application/x-pdf": "application/pdf",
  "image/jpeg": "image/jpeg",
  "image/jpg": "image/jpeg",
  "image/png": "image/png",
};

function normalizeMimeType(value: string) {
  return MIME_ALIASES[value.trim().toLowerCase()];
}

function extensionFromFileName(fileName: string) {
  const match = /\.([a-z0-9]+)$/i.exec(fileName.trim());

  if (!match) {
    return undefined;
  }

  const extension = match[1].toLowerCase();
  return extension === "jpeg" ? "jpg" : extension;
}

function hasSignature(bytes: Uint8Array, signature: readonly number[]) {
  return signature.every((value, index) => bytes[index] === value);
}

export type ValidatedInvoiceFile = {
  bytes: Uint8Array;
  extension: InvoiceFileExtension;
  mimeType: InvoiceStorageMimeType;
  originalFileName: string;
  size: number;
};

export function validateInvoiceFile(input: {
  bytes: ArrayBuffer | Uint8Array;
  contentType: string;
  fileName: string;
  maxFileSizeBytes?: number;
}): ValidatedInvoiceFile {
  const bytes =
    input.bytes instanceof Uint8Array
      ? input.bytes
      : new Uint8Array(input.bytes);
  const maxFileSizeBytes =
    input.maxFileSizeBytes ?? getInvoiceStorageConfig().maxFileSizeBytes;

  if (bytes.byteLength === 0) {
    throw new InvoiceFileValidationError("EMPTY_FILE", "The file is empty.");
  }

  if (bytes.byteLength > maxFileSizeBytes) {
    throw new InvoiceFileValidationError(
      "FILE_TOO_LARGE",
      `The file exceeds the ${maxFileSizeBytes} byte limit.`,
    );
  }

  const mimeType = normalizeMimeType(input.contentType);

  if (!mimeType) {
    throw new InvoiceFileValidationError(
      "INVALID_MIME_TYPE",
      "Only PDF, JPG and PNG files are accepted.",
    );
  }

  const extension = extensionFromFileName(input.fileName);
  const matchingDefinition = FILE_TYPES.find(
    (definition) => definition.mimeType === mimeType,
  );

  if (!matchingDefinition || extension !== matchingDefinition.extension) {
    throw new InvoiceFileValidationError(
      "INVALID_EXTENSION",
      "The file extension does not match an accepted PDF, JPG or PNG type.",
    );
  }

  const detectedDefinition = FILE_TYPES.find((definition) =>
    hasSignature(bytes, definition.signature),
  );

  if (!detectedDefinition) {
    throw new InvoiceFileValidationError(
      "INVALID_FILE_SIGNATURE",
      "The file contents are not a valid PDF, JPG or PNG file.",
    );
  }

  if (detectedDefinition.mimeType !== mimeType) {
    throw new InvoiceFileValidationError(
      "MIME_TYPE_MISMATCH",
      "The declared file type does not match its contents.",
    );
  }

  return {
    bytes,
    extension: matchingDefinition.extension,
    mimeType,
    originalFileName: input.fileName,
    size: bytes.byteLength,
  };
}
