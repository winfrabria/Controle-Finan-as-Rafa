import { NextResponse, type NextRequest } from "next/server";

import { getSafeRedirectPath } from "@/lib/supabase/redirect";
import { getRoleDestination } from "@/server/auth/access-policy";
import { getAuthenticationContext } from "@/server/auth/authorization";

export async function GET(request: NextRequest) {
  const nextPath = getSafeRedirectPath(
    request.nextUrl.searchParams.get("next"),
  );
  const auth = await getAuthenticationContext();

  if (auth.kind === "unauthenticated") {
    const loginUrl = new URL("/login", request.url);
    if (nextPath !== "/auth/landing") {
      loginUrl.searchParams.set("next", nextPath);
    }
    return NextResponse.redirect(loginUrl);
  }

  if (auth.kind === "forbidden") {
    return NextResponse.redirect(new URL("/acesso-negado", request.url));
  }

  const response = NextResponse.redirect(
    new URL(getRoleDestination(auth.profile.role, nextPath), request.url),
  );
  response.cookies.set("winfra_role", auth.profile.role, {
    httpOnly: true,
    maxAge: 60 * 60 * 8,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
  return response;
}
