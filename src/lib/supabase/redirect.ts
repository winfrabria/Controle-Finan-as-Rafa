const DEFAULT_AUTHENTICATED_PATH = "/auth/landing";

export function getSafeRedirectPath(value: string | null | undefined) {
  if (
    !value?.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    /[\u0000-\u001F]/.test(value)
  ) {
    return DEFAULT_AUTHENTICATED_PATH;
  }

  return value;
}
