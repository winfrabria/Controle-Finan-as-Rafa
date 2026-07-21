import { NextResponse, type NextRequest } from "next/server";

import {
  getAuthLandingPath,
  getSafeRedirectPath,
} from "@/lib/supabase/redirect";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const type = request.nextUrl.searchParams.get("type");
  const nextPath = getSafeRedirectPath(request.nextUrl.searchParams.get("next"));

  if (code || (tokenHash && type === "recovery")) {
    try {
      const supabase = await createClient();
      const { error } = code
        ? await supabase.auth.exchangeCodeForSession(code)
        : await supabase.auth.verifyOtp({
            token_hash: tokenHash!,
            type: "recovery",
          });
      if (!error) {
        if (type === "recovery" || nextPath === "/atualizar-senha") {
          return NextResponse.redirect(
            new URL("/atualizar-senha", request.url),
          );
        }
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
