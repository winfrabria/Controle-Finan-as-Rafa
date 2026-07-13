import "dotenv/config";

import assert from "node:assert/strict";
import test from "node:test";

import {
  FindingStatus,
  NoteClassification,
  NoteStatus,
  ProcessingStage,
} from "@/generated/prisma/enums";
import { prisma } from "@/server/db/prisma";
import { recordReviewerValidation } from "./record-reviewer-validation";

const enabled = process.env.HARNESS_DATABASE_TESTS === "1";

test(
  "decisão do revisor é imutável e rejeita versão concorrente",
  { skip: !enabled },
  async (context) => {
    const reviewer = await prisma.profile.findFirst({
      where: { active: true },
      select: { id: true },
    });
    if (!reviewer) {
      context.skip("Nenhum perfil ativo disponível para a FK de validação.");
      return;
    }

    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const work = await prisma.work.create({
      data: { code: `VALIDATION-${suffix}`, name: "Validation test" },
    });
    try {
      const note = await prisma.note.create({
        data: {
          classification: NoteClassification.SUSPICIOUS,
          originalFileName: "test.pdf",
          originalFilePath: "test/validation.pdf",
          originalMimeType: "application/pdf",
          originalSizeBytes: BigInt(1),
          processingStage: ProcessingStage.COMPLETED,
          status: NoteStatus.PENDING_VALIDATION,
          workId: work.id,
        },
      });
      await prisma.finding.create({
        data: {
          category: "TEST",
          code: "TEST_FINDING",
          confidence: 0.9,
          description: "Achado de integração.",
          evidence: { field: "value" },
          justification: "Evidência de teste.",
          noteId: note.id,
          policyVersion: "test",
          status: FindingStatus.OPEN,
          title: "Achado de teste",
        },
      });

      const input = {
        comment: "Documento conferido.",
        decision: "OK" as const,
        noteId: note.id,
        noteVersion: note.version,
        reason: "Alerta não se aplica",
        reviewerId: reviewer.id,
      };
      const results = await Promise.all([
        recordReviewerValidation(input),
        recordReviewerValidation(input),
      ]);
      assert.equal(results.filter(Boolean).length, 1);

      const refreshed = await prisma.note.findUniqueOrThrow({
        where: { id: note.id },
        include: { findings: true, validations: true },
      });
      assert.equal(refreshed.status, NoteStatus.APPROVED);
      assert.equal(refreshed.version, note.version + 1);
      assert.equal(refreshed.validations.length, 1);
      assert.equal(refreshed.validations[0].noteVersion, note.version);
      assert.equal(refreshed.validations[0].comment, input.comment);
      assert.equal(refreshed.findings[0].status, FindingStatus.FALSE_POSITIVE);
    } finally {
      await prisma.note.deleteMany({ where: { workId: work.id } });
      await prisma.work.delete({ where: { id: work.id } });
    }
  },
);
