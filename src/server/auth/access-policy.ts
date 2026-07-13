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

function splitPathSuffix(path: string) {
  const suffixIndex = path.search(/[?#]/);

  if (suffixIndex === -1) {
    return { pathname: path, suffix: "" };
  }

  return {
    pathname: path.slice(0, suffixIndex),
    suffix: path.slice(suffixIndex),
  };
}

function isSharedNoteDetail(pathname: string) {
  return /^\/notas\/[^/]+(?:\/analise-ia)?\/?$/.test(pathname);
}

export function getRoleDestination(
  role: ApplicationRole,
  requestedPath: string,
) {
  const { pathname, suffix } = splitPathSuffix(requestedPath);

  if (pathname === "/auth/landing") {
    return getRoleHome(role);
  }

  if (isSharedNoteDetail(pathname)) {
    return requestedPath;
  }

  if (role === "ADMIN") {
    if (pathname === "/notas") return `/admin/notas${suffix}`;
    if (pathname === "/validacoes") return `/admin/validacoes${suffix}`;
    if (pathname === "/revisao") return `/admin${suffix}`;
    if (pathname.startsWith("/revisao/")) {
      return `/admin${pathname.slice("/revisao".length)}${suffix}`;
    }

    return requestedPath;
  }

  if (pathname === "/notas") return `/revisao/notas${suffix}`;
  if (pathname === "/validacoes") return `/revisao/validacoes${suffix}`;
  if (pathname === "/admin") return `/revisao${suffix}`;
  if (pathname === "/admin/notas") return `/revisao/notas${suffix}`;
  if (pathname === "/admin/validacoes") {
    return `/revisao/validacoes${suffix}`;
  }
  if (pathname === "/admin/historico") {
    return `/revisao/historico${suffix}`;
  }
  if (pathname.startsWith("/admin/")) return `/revisao${suffix}`;

  return requestedPath;
}
