import "server-only";

import { INTERNAL_ROLES } from "@/server/auth/access-policy";
import { requirePageRoles } from "@/server/auth/authorization";

export async function requireInternalUser(nextPath: string) {
  return requirePageRoles(nextPath, INTERNAL_ROLES);
}
