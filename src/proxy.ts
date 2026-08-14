import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { getSupabaseConfig } from "@/lib/supabase/config";
import {
  getAuthLandingPath,
  getSafeRedirectPath,
} from "@/lib/supabase/redirect";
import { getRoleDestination, type ApplicationRole } from "@/server/auth/access-policy";

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
      const nextPath =
        pathname === "/auth/landing"
          ? getSafeRedirectPath(request.nextUrl.searchParams.get("next"))
          : `${pathname}${search}`;
      if (nextPath !== "/auth/landing") {
        loginUrl.searchParams.set("next", nextPath);
      }
      return NextResponse.redirect(loginUrl);
    }

    if (
      user &&
      (pathname === "/admin" ||
        pathname.startsWith("/admin/") ||
        pathname === "/revisao" ||
        pathname.startsWith("/revisao/"))
    ) {
      const role = request.cookies.get("winfra_role")?.value;
      if (role === "ADMIN" || role === "REVIEWER") {
        const currentPath = `${pathname}${search}`;
        const destination = getRoleDestination(
          role as ApplicationRole,
          currentPath,
        );
        if (destination !== currentPath) {
          return NextResponse.redirect(new URL(destination, request.url));
        }
      }
    }

    if (user && (pathname === "/" || pathname === "/login")) {
      const nextPath = getSafeRedirectPath(
        request.nextUrl.searchParams.get("next"),
      );
      return NextResponse.redirect(
        new URL(getAuthLandingPath(nextPath), request.url),
      );
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
    "/((?!_next/static|_next/image|favicon.ico|sw\\.js|manifest\\.webmanifest|offline\\.html|brand(?:/|$)|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
