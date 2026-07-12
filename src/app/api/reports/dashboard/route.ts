import { NextRequest, NextResponse } from "next/server";

const reportRows = {
  admin: [
    ["Métrica", "Valor"],
    ["Total de notas", "2847"],
    ["Notas suspeitas", "176"],
    ["Obras cadastradas", "48"],
    ["Validações pelo Rafael", "498"],
    ["Valor analisado", "R$ 18,75 mi"],
  ],
  reviewer: [
    ["Métrica", "Valor"],
    ["Total de notas", "1248"],
    ["Notas suspeitas", "142"],
    ["Valor analisado", "R$ 8,45 mi"],
    ["Pendentes de validação", "198"],
  ],
} as const;

function quoteCsv(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

export async function GET(request: NextRequest) {
  const requestedRole = request.nextUrl.searchParams.get("role");
  const role = requestedRole === "reviewer" ? "reviewer" : "admin";
  const csv = reportRows[role]
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
