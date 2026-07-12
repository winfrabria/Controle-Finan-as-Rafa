import "server-only";

import { NextResponse } from "next/server";
import type { ZodError } from "zod";

import {
  WorkCodeConflictError,
  WorkNotFoundError,
} from "@/server/works/admin-work-service";

export function workValidationError(error: ZodError) {
  return NextResponse.json(
    {
      error: "Dados inválidos.",
      detalhes: error.issues.map((issue) => ({
        campo: issue.path.join("."),
        mensagem: issue.message,
      })),
    },
    { status: 422 },
  );
}

export function malformedJsonError() {
  return NextResponse.json(
    { error: "O corpo da requisição deve ser um JSON válido." },
    { status: 400 },
  );
}

export function workServiceError(error: unknown, operation: string) {
  if (error instanceof WorkNotFoundError) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }

  if (error instanceof WorkCodeConflictError) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }

  console.error(`Failed to ${operation} work`, error);
  return NextResponse.json(
    { error: "Não foi possível concluir a operação com a obra." },
    { status: 503 },
  );
}
