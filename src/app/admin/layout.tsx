import type { ReactNode } from "react";

import { ADMIN_ONLY_ROLES } from "@/server/auth/access-policy";
import { requirePageRoles } from "@/server/auth/authorization";

export default async function AdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  await requirePageRoles("/admin", ADMIN_ONLY_ROLES);

  return children;
}
