import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { getSupabaseConfig } from "@/lib/supabase/config";
import { getSafeRedirectPath } from "@/lib/supabase/redirect";

const protectedPaths = [
  "/admin",
  "/auth/landing",
  "/notas",
  "/revisao",
  "/validacoes",
];

function isProtectedPath(pathname: string) {
  return protectedPaths.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
}

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  try {
    const { supabaseUrl, supabaseAnonKey } = getSupabaseConfig();
    const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    });

    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { pathname, search } = request.nextUrl;

    if (!user && isProtectedPath(pathname)) {
      const loginUrl = new URL("/", request.url);
      loginUrl.searchParams.set("next", `${pathname}${search}`);
      return NextResponse.redirect(loginUrl);
    }

    if (user && (pathname === "/" || pathname === "/login")) {
      const nextPath = getSafeRedirectPath(
        request.nextUrl.searchParams.get("next"),
      );
      return NextResponse.redirect(new URL(nextPath, request.url));
    }
  } catch {
    if (isProtectedPath(request.nextUrl.pathname)) {
      const loginUrl = new URL("/", request.url);
      loginUrl.searchParams.set("erro", "configuracao");
      return NextResponse.redirect(loginUrl);
    }
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
