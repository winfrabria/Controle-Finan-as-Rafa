import { createServerClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";

import { getSupabaseConfig } from "@/lib/supabase/config";
import { getSafeRedirectPath } from "@/lib/supabase/redirect";

function loginRedirect(request: NextRequest, error?: string) {
  const url = new URL("/", request.url);

  if (error) {
    url.searchParams.set("erro", error);
  }

  return NextResponse.redirect(url, 303);
}

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const nextPath = getSafeRedirectPath(String(formData.get("next") ?? ""));

  if (!email || !password) {
    return loginRedirect(request, "credenciais");
  }

  try {
    const { supabaseUrl, supabaseAnonKey } = getSupabaseConfig();
    const response = NextResponse.redirect(new URL(nextPath, request.url), 303);
    const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    });

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      return loginRedirect(request, "credenciais");
    }

    return response;
  } catch {
    return loginRedirect(request, "configuracao");
  }
}
