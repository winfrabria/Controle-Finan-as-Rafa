export type ApplicationRole = "ADMIN" | "REVIEWER";

export const ADMIN_ONLY_ROLES = ["ADMIN"] as const;
export const INTERNAL_ROLES = ["ADMIN", "REVIEWER"] as const;
export const REVIEW_ROLES = ["REVIEWER"] as const;

export function canAccess(
  role: ApplicationRole,
  allowedRoles: readonly ApplicationRole[],
) {
  return role === "ADMIN" || allowedRoles.includes(role);
}

export function getRoleHome(role: ApplicationRole) {
  return role === "ADMIN" ? "/admin" : "/revisao";
}
