import assert from "node:assert/strict";
import test from "node:test";

import {
  getPublicCapabilityCookieName,
  hashPublicCapability,
  matchesPublicCapability,
  publicCapabilityCookieOptions,
  revokedPublicCapabilityFields,
  terminalPublicCapabilityFields,
} from "./public-capability";

test("capability usa hash, expiração e comparação em tempo constante", () => {
  const token = "capability-test-token";
  const hash = hashPublicCapability(token);

  assert.equal(matchesPublicCapability(token, hash, new Date(Date.now() + 10_000)), true);
  assert.equal(matchesPublicCapability("outro-token", hash, new Date(Date.now() + 10_000)), false);
  assert.equal(matchesPublicCapability(token, hash, new Date(Date.now() - 1)), false);
});

test("cookie público é HttpOnly, estrito e limitado ao protocolo", () => {
  const noteId = "note-id";
  const options = publicCapabilityCookieOptions(noteId, 900);

  assert.equal(getPublicCapabilityCookieName(noteId), "winfra_note_cap_note-id");
  assert.equal(options.httpOnly, true);
  assert.equal(options.sameSite, "strict");
  assert.equal(options.maxAge, 900);
  assert.equal(options.path, "/api/notas/note-id");
});

test("capability revogada no servidor falha para status, contexto e preview", () => {
  const token = "capability-terminal-token";
  const revoked = revokedPublicCapabilityFields();
  const hash = hashPublicCapability(token);

  assert.equal(revoked.publicTokenExpiresAt.getTime(), 0);
  assert.notEqual(revoked.publicTokenHash, hash);
  assert.equal(
    matchesPublicCapability(
      token,
      revoked.publicTokenHash,
      new Date(Date.now() + 60_000),
    ),
    false,
  );
});

test("token consumido não ressuscita após retry ou reprocessamento", () => {
  const oldToken = "capability-before-terminal";
  const firstRevocation = revokedPublicCapabilityFields();
  const reprocessRevocation = revokedPublicCapabilityFields();
  const futureExpiry = new Date(Date.now() + 60_000);

  assert.notEqual(firstRevocation.publicTokenHash, reprocessRevocation.publicTokenHash);
  assert.equal(
    matchesPublicCapability(
      oldToken,
      firstRevocation.publicTokenHash,
      futureExpiry,
    ),
    false,
  );
  assert.equal(
    matchesPublicCapability(
      oldToken,
      reprocessRevocation.publicTokenHash,
      futureExpiry,
    ),
    false,
  );
});

test("status terminal é entregue uma vez, preview é bloqueado e não há vazamento", async () => {
  process.env.DATABASE_URL ??= "postgresql://user:pass@localhost:5432/test";
  const [{ GET: getStatus }, { GET: getPreview }, { prisma }] = await Promise.all([
    import("@/app/api/notas/[id]/status/route"),
    import("@/app/api/notas/[id]/preview/route"),
    import("@/server/db/prisma"),
  ]);
  const noteId = "11111111-1111-4111-8111-111111111111";
  const token = "copied-terminal-token";
  const terminalCapability = terminalPublicCapabilityFields();
  const terminalNote = {
    auditResult: "SUSPICIOUS",
    contextQuestions: [],
    contextRound: 0,
    contextSubmissions: [],
    id: noteId,
    publicTokenHash: hashPublicCapability(token),
    publicTokenExpiresAt: terminalCapability.publicTokenExpiresAt,
    publicProtocol: "WF-TEST",
    processingStage: "COMPLETED",
    status: "OK",
    version: 4,
  };
  const noteState = { current: terminalNote };
  const noteDelegate = prisma.note as unknown as {
    findFirst: (...args: never[]) => Promise<unknown>;
    updateMany: (...args: never[]) => Promise<{ count: number }>;
  };
  const originalFindFirst = noteDelegate.findFirst;
  const originalUpdateMany = noteDelegate.updateMany;
  noteDelegate.findFirst = async () => noteState.current;
  noteDelegate.updateMany = async (args) => {
    const { where } = args as unknown as {
      where: {
        id: string;
        publicTokenHash: string;
        publicTokenExpiresAt: { gt: Date };
        version: number;
      };
    };
    if (
      where.id !== noteState.current.id ||
      where.publicTokenHash !== noteState.current.publicTokenHash ||
      where.version !== noteState.current.version ||
      noteState.current.publicTokenExpiresAt.getTime() <= where.publicTokenExpiresAt.gt.getTime()
    ) {
      return { count: 0 };
    }
    const revoked = revokedPublicCapabilityFields();
    noteState.current = {
      ...noteState.current,
      ...revoked,
      version: noteState.current.version + 1,
    };
    return { count: 1 };
  };

  const cookie = `${getPublicCapabilityCookieName(noteId)}=${encodeURIComponent(token)}`;
  const request = (path: string) =>
    new Request(`http://localhost${path}`, { headers: { cookie } });

  try {
    const previewBeforeStatus = await getPreview(request(`/api/notas/${noteId}/preview`), {
      params: Promise.resolve({ id: noteId }),
    });
    assert.equal(previewBeforeStatus.status, 404);

    const statusResponse = await getStatus(request(`/api/notas/${noteId}/status`), {
      params: Promise.resolve({ id: noteId }),
    });
    const statusBody = await statusResponse.json();
    assert.deepEqual(statusBody, {
      nota: {
        id: noteId,
        estadoPublico: "COMPLETED",
        etapa: "CHECKING",
        protocolo: "WF-TEST",
      },
    });
    assert.doesNotMatch(JSON.stringify(statusBody), /SUSPICIOUS|auditResult|finding|justification/i);
    assert.match(statusResponse.headers.get("set-cookie") ?? "", /Max-Age=0/i);
    assert.notEqual(noteState.current.publicTokenHash, terminalNote.publicTokenHash);

    // Simula um retry/reprocess defeituoso que apenas reabrisse a expiração.
    // O hash substituído mantém o token antigo definitivamente inválido.
    noteState.current = {
      ...noteState.current,
      publicTokenExpiresAt: new Date(Date.now() + 60_000),
    };

    const secondStatusResponse = await getStatus(request(`/api/notas/${noteId}/status`), {
      params: Promise.resolve({ id: noteId }),
    });
    const previewAfterStatus = await getPreview(request(`/api/notas/${noteId}/preview`), {
      params: Promise.resolve({ id: noteId }),
    });

    assert.equal(secondStatusResponse.status, 404);
    assert.equal(previewAfterStatus.status, 404);
  } finally {
    noteDelegate.findFirst = originalFindFirst;
    noteDelegate.updateMany = originalUpdateMany;
  }
});
