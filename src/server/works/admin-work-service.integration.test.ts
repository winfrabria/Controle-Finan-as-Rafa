import "dotenv/config";

import assert from "node:assert/strict";
import test from "node:test";

import {
  createAdminWorkSchema,
  updateAdminWorkSchema,
} from "@/lib/works/admin-work-contract";
import { prisma } from "@/server/db/prisma";

import {
  createAdminWork,
  getAdminWork,
  listAdminWorks,
  updateAdminWork,
  WorkCodeConflictError,
} from "./admin-work-service";

test(
  "CRUD administrativo mantém a obra e alterna seu estado sem hard-delete",
  { skip: !process.env.DATABASE_URL },
  async (context) => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const code = `TEST-${suffix}`.toUpperCase();
    try {
      await prisma.$queryRaw`SELECT responsible_name FROM works LIMIT 1`;
    } catch {
      context.skip("A migration de responsável por obra ainda não foi aplicada.");
      return;
    }
    let id: string | undefined;

    try {
      const created = await createAdminWork(
        createAdminWorkSchema.parse({
          codigo: code,
          nome: `Obra integração ${suffix}`,
          local: "São Paulo - SP",
          responsavel: "Carlos Menezes",
        }),
      );
      id = created.id;
      assert.equal(created.ativa, true);
      assert.equal(created.totalNotas, 0);
      assert.equal(created.responsavel, "Carlos Menezes");

      await assert.rejects(
        () =>
          createAdminWork(
            createAdminWorkSchema.parse({
              codigo: code.toLowerCase(),
              nome: "Código repetido",
              local: "São Paulo - SP",
              responsavel: "Carlos Menezes",
            }),
          ),
        WorkCodeConflictError,
      );

      const listed = await listAdminWorks({
        busca: suffix,
        status: "ativas",
        pagina: 1,
        porPagina: 20,
      });
      assert.equal(listed.paginacao.total, 1);
      assert.equal(listed.obras[0]?.id, id);

      const deactivated = await updateAdminWork(
        id,
        updateAdminWorkSchema.parse({ ativa: false }),
      );
      assert.equal(deactivated.ativa, false);
      assert.equal((await getAdminWork(id)).id, id);

      const activeList = await listAdminWorks({
        busca: suffix,
        status: "ativas",
        pagina: 1,
        porPagina: 20,
      });
      assert.equal(activeList.paginacao.total, 0);

      const reactivated = await updateAdminWork(
        id,
        updateAdminWorkSchema.parse({
          ativa: true,
          local: "Campinas - SP",
        }),
      );
      assert.equal(reactivated.ativa, true);
      assert.equal(reactivated.local, "Campinas - SP");
    } finally {
      // Remove exclusivamente o fixture sem histórico criado por este teste.
      if (id)
        await prisma.work.deleteMany({ where: { id, notes: { none: {} } } });
    }
  },
);
