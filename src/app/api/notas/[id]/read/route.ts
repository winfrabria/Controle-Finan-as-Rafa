import { NextResponse } from "next/server";

import { INTERNAL_ROLES } from "@/server/auth/access-policy";
import { requireApiRoles } from "@/server/auth/authorization";
import { NoteReadError, recordNoteRead } from "@/server/notes/record-note-read";

export const runtime = "nodejs";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const access = await requireApiRoles(INTERNAL_ROLES);
  if (!access.ok) return access.response;

  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json(
      { erro: { codigo: "NOTA_INVALIDA", mensagem: "Nota inválida." } },
      { status: 400 },
    );
  }

  let expectedVersion: number | undefined;
  // Existing list actions send no body; the detail view sends its exact version.
  const body = await request.text();
  if (body) {
    let parsed: unknown;
    try { parsed = JSON.parse(body); } catch { parsed = null; }
    if (!parsed || typeof parsed !== "object" || !("version" in parsed) ||
      typeof parsed.version !== "number" || !Number.isSafeInteger(parsed.version) || parsed.version < 1) {
      return NextResponse.json({ erro: { codigo: "VERSAO_INVALIDA", mensagem: "Versão da análise inválida." } }, { status: 400 });
    }
    expectedVersion = parsed.version;
  }
  try {
    const readAt = await recordNoteRead(id, access.profile.id, expectedVersion);
    return NextResponse.json({ nota: { id, lidaEm: readAt.toISOString() } });
  } catch (error) {
    if (!(error instanceof NoteReadError)) throw error;
    return NextResponse.json(
      { erro: { codigo: error.code, mensagem: error.message } },
      { status: error.status },
    );
  }
}
