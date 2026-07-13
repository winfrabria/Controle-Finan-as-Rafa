import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { sanitizeForPersistence } from "@/lib/audit-harness";
import { prisma } from "@/server/db/prisma";

export async function persistAdminAudit(entry: {
  action: string;
  actorId?: string;
  actorEmail?: string;
  entityId?: string;
  entityType: string;
  requestId?: string;
  changes?: Record<string, unknown>;
}) {
  return prisma.adminAuditLog.create({
    data: {
      action: entry.action,
      actorEmail: entry.actorEmail,
      actorId: entry.actorId,
      data: entry.changes
        ? (sanitizeForPersistence(entry.changes) as Prisma.InputJsonValue)
        : undefined,
      entityId: entry.entityId,
      entityType: entry.entityType,
      requestId: entry.requestId,
    },
    select: { id: true },
  });
}
