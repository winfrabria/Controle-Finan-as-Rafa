import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgresql://user:pass@localhost:5432/test";

test("inclui no período de recebimento uma nota emitida em mês antigo", async () => {
  const prismaMock = {
    note: {
      findMany: async () => [
        {
          auditResult: null,
          classification: null,
          createdAt: new Date("2026-08-08T12:00:00Z"),
          documentNumber: "123",
          findings: [],
          id: "note-1",
          issuedAt: new Date("2025-01-15T00:00:00Z"),
          processingJobs: [],
          status: "RECEIVED",
          supplierName: "Fornecedor",
          totalAmount: null,
          work: {
            name: "Obra",
            responsibleName: "Responsável",
            responsibleProfile: null,
          },
        },
      ],
    },
    noteRead: {},
    pushSubscription: {},
  };

  const globalForPrisma = globalThis as typeof globalThis & { prisma?: unknown };
  const previousPrisma = globalForPrisma.prisma;
  globalForPrisma.prisma = prismaMock;

  try {
    const { listReviewerDashboardNotes } = await import(
      "./reviewer-dashboard-query"
    );
    const [item] = await listReviewerDashboardNotes();

    assert.equal(item.date, "08/08/2026");
    assert.equal(item.dateKey, "2026-08");
  } finally {
    globalForPrisma.prisma = previousPrisma;
  }
});
