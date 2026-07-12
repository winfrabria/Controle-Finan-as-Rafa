import { NextResponse, type NextRequest } from "next/server";

import { getRoleHome } from "@/server/auth/access-policy";
import { getAuthenticationContext } from "@/server/auth/authorization";

export async function GET(request: NextRequest) {
  const auth = await getAuthenticationContext();

  if (auth.kind === "unauthenticated") {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (auth.kind === "forbidden") {
    return NextResponse.redirect(new URL("/acesso-negado", request.url));
  }

  return NextResponse.redirect(
    new URL(getRoleHome(auth.profile.role), request.url),
  );
}
