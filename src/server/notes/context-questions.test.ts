import assert from "node:assert/strict";
import test from "node:test";

import { ContextQuestionType } from "@/generated/prisma/enums";
async function contextQuestionsModule() {
  process.env.DATABASE_URL ??= "postgresql://user:pass@localhost:5432/test";
  return import("./context-questions");
}

const questions = [
  {
    code: "PEOPLE_COUNT",
    id: "11111111-1111-4111-8111-111111111111",
    options: [],
    position: 1,
    prompt: "Quantas pessoas foram atendidas?",
    required: true,
    type: ContextQuestionType.NUMBER,
  },
  {
    code: "CONFIRMED_WORK",
    id: "22222222-2222-4222-8222-222222222222",
    options: [],
    position: 2,
    prompt: "O documento pertence à obra selecionada?",
    required: true,
    type: ContextQuestionType.BOOLEAN,
  },
  {
    code: "VEHICLE",
    id: "33333333-3333-4333-8333-333333333333",
    options: [
      { label: "Sim", value: "yes" },
      { label: "Não", value: "no" },
    ],
    position: 3,
    prompt: "O equipamento estava na obra?",
    required: false,
    type: ContextQuestionType.SINGLE_SELECT,
  },
] as const;

test("normaliza respostas por tipo e rejeita resposta fora da rodada", async () => {
  const { ContextQuestionError, validateContextAnswers } = await contextQuestionsModule();
  const normalized = validateContextAnswers(questions as never, [
    { perguntaId: questions[1].id, valor: true },
    { perguntaId: questions[0].id, valor: "2" },
  ]);

  assert.deepEqual(normalized, [
    { questionId: questions[0].id, value: 2 },
    { questionId: questions[1].id, value: true },
  ]);

  assert.throws(
    () => validateContextAnswers(questions as never, [{ perguntaId: "44444444-4444-4444-8444-444444444444", valor: "x" }]),
    (error: unknown) => error instanceof ContextQuestionError && error.code === "CONTEXT_QUESTION_INVALID",
  );
});

test("mapeia tipos internos para o contrato público sem expor rationale", async () => {
  const { toPublicContextQuestion } = await contextQuestionsModule();
  const question = toPublicContextQuestion(questions[2]);

  assert.deepEqual(question, {
    id: questions[2].id,
    obrigatoria: false,
    opcoes: ["Sim", "Não"],
    pergunta: questions[2].prompt,
    tipo: "SELECT",
  });
  assert.equal("rationale" in question, false);
  assert.equal(toPublicContextQuestion(questions[1]).tipo, "CONFIRMATION");
});

test("aceita o rótulo público de uma opção e persiste uma resposta legível", async () => {
  const { validateContextAnswers } = await contextQuestionsModule();

  assert.deepEqual(
    validateContextAnswers([questions[2]] as never, [
      { perguntaId: questions[2].id, valor: "Sim" },
    ]),
    [{ questionId: questions[2].id, value: "Sim" }],
  );
});

test("trata opções opacas antigas como texto livre em vez de exibi-las", async () => {
  const { toPublicContextQuestion, validateContextAnswers } = await contextQuestionsModule();
  const question = {
    ...questions[2],
    options: [
      { label: "All Violet", value: "all_violet" },
      { label: "All Filet", value: "all_filet" },
    ],
  } as const;

  assert.deepEqual(toPublicContextQuestion(question as never), {
    id: question.id,
    obrigatoria: false,
    opcoes: undefined,
    pergunta: question.prompt,
    tipo: "TEXT",
  });
  assert.deepEqual(
    validateContextAnswers([question] as never, [
      { perguntaId: question.id, valor: "Placa GWI-62-07" },
    ]),
    [{ questionId: question.id, value: "Placa GWI-62-07" }],
  );
});
