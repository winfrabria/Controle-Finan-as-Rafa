import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const UF_PATTERN = /^[A-Z]{2}$/;

type IbgeCity = { id?: number; nome?: unknown };

export async function GET(request: NextRequest) {
  const uf = (request.nextUrl.searchParams.get("uf") ?? "").toUpperCase();
  const search = (request.nextUrl.searchParams.get("busca") ?? "")
    .trim()
    .toLocaleLowerCase("pt-BR");

  if (!UF_PATTERN.test(uf)) {
    return NextResponse.json(
      { error: "Informe uma UF válida." },
      { status: 400 },
    );
  }

  try {
    const response = await fetch(
      `https://servicodados.ibge.gov.br/api/v1/localidades/estados/${uf}/municipios?orderBy=nome`,
      { next: { revalidate: 86_400 }, signal: AbortSignal.timeout(8_000) },
    );
    if (!response.ok) throw new Error(`IBGE respondeu ${response.status}`);

    const data = (await response.json()) as IbgeCity[];
    const cidades = data
      .map((city) => (typeof city.nome === "string" ? city.nome : null))
      .filter((name): name is string => Boolean(name))
      .filter((name) =>
        search ? name.toLocaleLowerCase("pt-BR").includes(search) : true,
      )
      .slice(0, 80);

    return NextResponse.json(
      { cidades },
      { headers: { "Cache-Control": "public, max-age=3600" } },
    );
  } catch {
    return NextResponse.json(
      {
        cidades: [],
        aviso: "A busca automática está indisponível. Digite a cidade manualmente.",
      },
      { status: 200 },
    );
  }
}
