import "server-only";

import { NextResponse } from "next/server";
import { redirect } from "next/navigation";

import type { UserRole } from "@/generated/prisma/enums";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/server/db/prisma";

import { canAccess, type ApplicationRole } from "./access-policy";

export type ActiveProfile = {
  active: true;
  email: string;
  fullName: string | null;
  id: string;
  role: UserRole;
};

type AuthenticationContext =
  | { kind: "authenticated"; profile: ActiveProfile }
  | { kind: "forbidden" }
  | { kind: "unauthenticated" };

export async function getAuthenticationContext(): Promise<AuthenticationContext> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { kind: "unauthenticated" };

  const profile = await prisma.profile.findFirst({
    where: { active: true, id: user.id },
    select: {
      active: true,
      email: true,
      fullName: true,
      id: true,
      role: true,
    },
  });

  if (!profile) return { kind: "forbidden" };

  return {
    kind: "authenticated",
    profile: { ...profile, active: true },
  };
}

export async function requirePageRoles(
  nextPath: string,
  allowedRoles: readonly ApplicationRole[],
) {
  const auth = await getAuthenticationContext();

  if (auth.kind === "unauthenticated") {
    redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  }

  if (
    auth.kind === "forbidden" ||
    !canAccess(auth.profile.role, allowedRoles)
  ) {
    redirect("/acesso-negado");
  }

  return auth.profile;
}

export async function requireApiRoles(
  allowedRoles: readonly ApplicationRole[],
): Promise<
  { ok: true; profile: ActiveProfile } | { ok: false; response: NextResponse }
> {
  const auth = await getAuthenticationContext();

  if (auth.kind === "unauthenticated") {
    return {
      ok: false,
      response: NextResponse.json(
        {
          erro: {
            codigo: "NAO_AUTENTICADO",
            mensagem: "Faça login para continuar.",
          },
        },
        { status: 401 },
      ),
    };
  }

  if (
    auth.kind === "forbidden" ||
    !canAccess(auth.profile.role, allowedRoles)
  ) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          erro: {
            codigo: "ACESSO_NEGADO",
            mensagem: "Você não tem permissão para esta ação.",
          },
        },
        { status: 403 },
      ),
    };
  }

  return { ok: true, profile: auth.profile };
}
