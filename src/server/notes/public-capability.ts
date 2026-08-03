import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const PUBLIC_CAPABILITY_TTL_SECONDS = 15 * 60;
export const PUBLIC_CONTEXT_CAPABILITY_TTL_SECONDS = 30 * 60;
export const PUBLIC_TERMINAL_CAPABILITY_TTL_SECONDS = 60;

const COOKIE_PREFIX = "winfra_note_cap_";

export function createPublicCapability(noteId: string) {
  const token = randomBytes(32).toString("base64url");
  return {
    hash: hashPublicCapability(token),
    token,
    expiresAt: new Date(Date.now() + PUBLIC_CAPABILITY_TTL_SECONDS * 1_000),
    protocol: `WF-${randomBytes(6).toString("hex").toUpperCase()}`,
    cookieName: getPublicCapabilityCookieName(noteId),
  };
}

export function rotatePublicCapability() {
  const token = randomBytes(32).toString("base64url");
  return {
    hash: hashPublicCapability(token),
    token,
    expiresAt: new Date(
      Date.now() + PUBLIC_CONTEXT_CAPABILITY_TTL_SECONDS * 1_000,
    ),
  };
}

/**
 * Irreversibly revokes the current public capability. Replacing the stored
 * hash is important: merely expiring it would allow an old token to become
 * valid again if a retry or administrative reprocess extended the expiry.
 */
export function revokedPublicCapabilityFields() {
  return {
    publicTokenHash: hashPublicCapability(randomBytes(32).toString("base64url")),
    publicTokenExpiresAt: new Date(0),
  };
}

/**
 * Keeps a short one-shot window for the terminal status response. Preview is
 * denied independently for terminal notes; the status route consumes this
 * window with a compare-and-set and then calls revokedPublicCapabilityFields.
 */
export function terminalPublicCapabilityFields() {
  return {
    publicTokenExpiresAt: new Date(
      Date.now() + PUBLIC_TERMINAL_CAPABILITY_TTL_SECONDS * 1_000,
    ),
  };
}

export function hashPublicCapability(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function matchesPublicCapability(
  token: string | null | undefined,
  storedHash: string,
  expiresAt: Date,
) {
  if (!token || expiresAt.getTime() <= Date.now()) return false;
  const received = Buffer.from(hashPublicCapability(token), "utf8");
  const stored = Buffer.from(storedHash, "utf8");
  return received.length === stored.length && timingSafeEqual(received, stored);
}

export function getPublicCapabilityCookieName(noteId: string) {
  return `${COOKIE_PREFIX}${noteId}`;
}

export function readPublicCapabilityCookie(request: Request, noteId: string) {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const cookieName = getPublicCapabilityCookieName(noteId);
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    const name = part.slice(0, separator).trim();
    if (name !== cookieName) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

export function publicCapabilityCookieOptions(
  noteId: string,
  maxAge: number,
) {
  return {
    httpOnly: true,
    maxAge,
    path: `/api/notas/${noteId}`,
    sameSite: "strict" as const,
    secure: process.env.NODE_ENV === "production",
  };
}

export function isTrustedPublicOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;

  try {
    const expected = process.env.NEXT_PUBLIC_APP_URL
      ? new URL(process.env.NEXT_PUBLIC_APP_URL).origin
      : new URL(request.url).origin;
    return new URL(origin).origin === expected;
  } catch {
    return false;
  }
}
