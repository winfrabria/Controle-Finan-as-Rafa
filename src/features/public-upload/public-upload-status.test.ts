import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizePublicQuestions,
  resolvePublicProcessingPhase,
  resolvePublicUploadResult,
} from "./public-upload-status";

const base = { etapa: "COMPLETED", id: "note-1" } as const;

test("usa apenas o estado público fornecido pela API", () => {
  assert.equal(
    resolvePublicUploadResult({ ...base, estadoPublico: "COMPLETED" }),
    "COMPLETED",
  );
  assert.equal(
    resolvePublicUploadResult({ ...base, estadoPublico: "NEEDS_CONTEXT" }),
    "NEEDS_CONTEXT",
  );
  assert.equal(
    resolvePublicUploadResult({ ...base, estadoPublico: "PROCESSING" }),
    "PROCESSING",
  );
  assert.equal(
    resolvePublicUploadResult({ ...base, estadoPublico: "READ_FAILED" }),
    "READ_FAILED",
  );
  assert.equal(
    resolvePublicUploadResult({ ...base, estadoPublico: "FAILED" }),
    "FAILED",
  );
  assert.equal(
    resolvePublicUploadResult({
      ...base,
      estadoPublico: "UNKNOWN" as never,
    }),
    null,
  );
});

test("traduz a etapa técnica para o progresso público simples", () => {
  assert.equal(resolvePublicProcessingPhase("EXTRACTING"), "READING");
  assert.equal(resolvePublicProcessingPhase("OCR"), "READING");
  assert.equal(resolvePublicProcessingPhase("ANALYZING"), "CHECKING");
  assert.equal(resolvePublicProcessingPhase("AUDIT_RULES"), "CHECKING");
});

test("limita, limpa e preserva no máximo três perguntas suportadas", () => {
  const questions = normalizePublicQuestions([
    { id: " q1 ", pergunta: " Qual veículo? ", tipo: "TEXT", obrigatoria: true },
    {
      id: "q2",
      pergunta: "Quantas pessoas?",
      tipo: "NUMBER",
      obrigatoria: true,
    },
    {
      id: "q3",
      pergunta: "A obra selecionada está correta?",
      tipo: "CONFIRMATION",
      obrigatoria: true,
    },
    {
      id: "q4",
      pergunta: "Qual categoria?",
      tipo: "SELECT",
      obrigatoria: false,
      opcoes: ["Hospedagem", "Alimentação"],
    },
  ]);

  assert.equal(questions.length, 3);
  assert.equal(questions[0]?.id, "q1");
  assert.equal(questions[0]?.pergunta, "Qual veículo?");
});
