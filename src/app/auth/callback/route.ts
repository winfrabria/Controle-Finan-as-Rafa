import { NextResponse, type NextRequest } from "next/server";

import {
  getAuthLandingPath,
  getSafeRedirectPath,
} from "@/lib/supabase/redirect";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const nextPath = getSafeRedirectPath(request.nextUrl.searchParams.get("next"));

  if (code) {
    try {
      const supabase = await createClient();
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (!error) {
        return NextResponse.redirect(
          new URL(getAuthLandingPath(nextPath), request.url),
        );
      }
    } catch {
      // Redireciona para uma mensagem segura no login.
    }
  }

  return NextResponse.redirect(new URL("/login?erro=callback", request.url));
}
