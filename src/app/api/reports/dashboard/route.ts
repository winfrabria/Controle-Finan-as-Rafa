import { NextRequest, NextResponse } from "next/server";

import { AuditResult, NoteClassification, NoteStatus } from "@/generated/prisma/enums";
import { INTERNAL_ROLES } from "@/server/auth/access-policy";
import { requireApiRoles } from "@/server/auth/authorization";
import { prisma } from "@/server/db/prisma";

function quoteCsv(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

export async function GET(request: NextRequest) {
  void request;
  const access = await requireApiRoles(INTERNAL_ROLES);
  if (!access.ok) return access.response;

  const [total, suspicious, processedValue, failures, workCount] =
    await Promise.all([
      prisma.note.count(),
      prisma.note.count({
        where: {
          OR: [
            { auditResult: AuditResult.SUSPICIOUS },
            { classification: NoteClassification.SUSPICIOUS },
            { status: { in: [NoteStatus.PENDING_VALIDATION, NoteStatus.REJECTED] } },
          ],
        },
      }),
      prisma.note.aggregate({
        where: {
          status: {
            notIn: [NoteStatus.RECEIVED, NoteStatus.PROCESSING, NoteStatus.FAILED],
          },
        },
        _sum: { totalAmount: true },
      }),
      prisma.note.count({
        where: { status: { in: [NoteStatus.READ_FAILED, NoteStatus.FAILED] } },
      }),
      access.profile.role === "ADMIN" ? prisma.work.count() : Promise.resolve(0),
    ]);

  const money = new Intl.NumberFormat("pt-BR", {
    currency: "BRL",
    style: "currency",
  }).format(Number(processedValue._sum.totalAmount ?? 0));
  const reportRows = [
    ["Métrica", "Valor"],
    ["Total de anexos", String(total)],
    ["Anexos suspeitos", String(suspicious)],
    ["Falhas de leitura ou processamento", String(failures)],
    ["Valor processado", money],
    ...(access.profile.role === "ADMIN"
      ? [["Obras cadastradas", String(workCount)]]
      : []),
  ];
  const role = access.profile.role === "ADMIN" ? "admin" : "reviewer";
  const csv = reportRows
    .map((row) => row.map(quoteCsv).join(";"))
    .join("\r\n");

  return new NextResponse(`\uFEFF${csv}`, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="relatorio-${role}.csv"`,
      "Content-Type": "text/csv; charset=utf-8",
    },
  });
}
