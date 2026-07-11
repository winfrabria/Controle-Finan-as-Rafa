import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    await supabase.auth.signOut();
  } catch {
    // Mesmo sem configuração/sessão válida, o usuário retorna ao login.
  }

  return NextResponse.redirect(new URL("/login", request.url), { status: 303 });
}
