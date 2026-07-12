import type { ReactNode } from "react";

import { REVIEW_ROLES } from "@/server/auth/access-policy";
import { requirePageRoles } from "@/server/auth/authorization";

export default async function ReviewLayout({
  children,
}: {
  children: ReactNode;
}) {
  await requirePageRoles("/revisao", REVIEW_ROLES);

  return children;
}
