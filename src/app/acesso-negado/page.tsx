import Link from "next/link";

import { getRoleHome } from "@/server/auth/access-policy";
import { getAuthenticationContext } from "@/server/auth/authorization";

export default async function AccessDeniedPage() {
  const auth = await getAuthenticationContext();
  const home =
    auth.kind === "authenticated" ? getRoleHome(auth.profile.role) : "/login";

  return (
    <main>
      <h1>Acesso negado</h1>
      <p>Seu perfil não tem permissão para acessar esta área.</p>
      <Link href={home}>Voltar para sua área</Link>
    </main>
  );
}
