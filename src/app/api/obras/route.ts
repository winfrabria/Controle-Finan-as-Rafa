import { NextResponse } from "next/server";

import { prisma } from "@/server/db/prisma";

export const runtime = "nodejs";

export async function GET() {
  try {
    const works = await prisma.work.findMany({
      where: { active: true },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      select: { id: true, location: true, name: true },
    });
    const obras = works.map((work) => ({
      id: work.id,
      nome: work.name,
      ...(work.location ? { local: work.location } : {}),
    }));

    return NextResponse.json({ obras });
  } catch (error) {
    console.error("Failed to list active works", error);

    return NextResponse.json(
      { error: "Não foi possível carregar as obras ativas." },
      { status: 503 },
    );
  }
}
