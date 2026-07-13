import "server-only";

type AdminAuditAction =
  | "work.created"
  | "work.updated"
  | "work.deactivated"
  | "work.reactivated"
  | "work.imported";

type AdminAuditEntry = {
  action: AdminAuditAction;
  actorId: string;
  actorEmail: string;
  entityId: string;
  changes?: Record<string, unknown>;
};

/**
 * Emite eventos estruturados para o coletor de logs da aplicação. Este contrato
 * fica isolado para poder ser trocado por persistência própria sem acoplar as APIs.
 */
export function recordAdminAudit(entry: AdminAuditEntry) {
  console.info(
    JSON.stringify({
      event: "admin.audit",
      occurredAt: new Date().toISOString(),
      entity: "work",
      ...entry,
    }),
  );
}
