import assert from "node:assert/strict";
import test from "node:test";

import {
  sanitizeReviewerJson,
  sanitizeReviewerMarkdown,
  sanitizeReviewerText,
} from "./reviewer-data-policy";

test("payload do reviewer não vaza metadados técnicos e preserva apenas link documental", () => {
  const documentUrl = "https://storage.test/documento.pdf?token=document-preview-token";
  const payload = {
    documentUrl,
    finding: {
      provider: "OpenAI",
      requestId: "request-internal-123",
      route: "openai-zdr",
      costUsd: 0.12,
      tokens: 321,
      reasoning: "internal reasoning must not escape",
      boundingBox: { x: 1, y: 2, width: 3, height: 4 },
      documentRole: "LINE_ITEM",
      signedUrl: "https://storage.test/documento.pdf?token=provider-signed-token",
      description:
        "Achado seguro; provider: OpenAI; requestId: request-internal-123; route: openai-zdr; reasoning: secreto.",
    },
  };

  const sanitized = sanitizeReviewerJson(payload) as {
    documentUrl?: string;
    finding?: Record<string, unknown>;
  };
  const finding = sanitized.finding ?? {};
  const forbiddenKeys = [
    "provider",
    "requestId",
    "route",
    "costUsd",
    "tokens",
    "reasoning",
    "boundingBox",
    "documentRole",
    "signedUrl",
  ];
  const leakedKeys = forbiddenKeys.filter((key) => key in finding);

  assert.equal(sanitized.documentUrl, documentUrl);
  assert.deepEqual(leakedKeys, []);
  assert.doesNotMatch(
    JSON.stringify(sanitized),
    /provider|requestId|openai-zdr|internal reasoning|provider-signed-token/i,
  );
});

test("texto livre destinado ao reviewer não expõe rota, provider, requestId ou reasoning", () => {
  const sanitized = sanitizeReviewerText(
    "provider: OpenAI; requestId: req-1; route: openai-zdr; reasoning: secreto; tokens: 42",
  );

  assert.doesNotMatch(
    sanitized,
    /provider|requestId|openai-zdr|reasoning|tokens\s*:/i,
  );
});

test("mantém texto comum sobre rota/provedor e não permite documentUrl técnico aninhado", () => {
  const trustedDocumentUrl = "https://storage.test/documento.pdf?token=document-preview-token";
  const technicalDocumentUrl = "https://storage.test/evidence.pdf?token=technical-preview-token";
  const sanitized = sanitizeReviewerJson({
    documentUrl: trustedDocumentUrl,
    evidence: {
      documentUrl: technicalDocumentUrl,
      description:
        "A rota do caminhão foi conferida antes do recebimento. O provedor local confirmou a entrega.",
      frota: "A frota da obra foi conferida.",
    },
  }) as {
    documentUrl?: string;
    evidence?: {
      documentUrl?: string;
      description?: string;
      frota?: string;
    };
  };

  assert.equal(sanitized.documentUrl, trustedDocumentUrl);
  assert.notEqual(sanitized.evidence?.documentUrl, technicalDocumentUrl);
  const extraction = sanitizeReviewerJson(
    { documentUrl: technicalDocumentUrl },
    { preserveDocumentUrl: false },
  ) as { documentUrl?: string };
  assert.notEqual(extraction.documentUrl, technicalDocumentUrl);
  assert.equal(
    sanitized.evidence?.description,
    "A rota do caminhão foi conferida antes do recebimento. O provedor local confirmou a entrega.",
  );
  assert.equal(sanitized.evidence?.frota, "A frota da obra foi conferida.");
  assert.equal(
    sanitizeReviewerMarkdown(
      "A rota do caminhão foi conferida.\nO provedor local confirmou a entrega.\nprovider: OpenAI",
    ),
    "A rota do caminhão foi conferida.\nO provedor local confirmou a entrega.",
  );
  assert.doesNotMatch(
    JSON.stringify(sanitized),
    /technical-preview-token|https:\/\/storage\.test\/evidence\.pdf/i,
  );
});
