"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

import { Icon } from "./ui-icons";
import { MetricCard, PageIntro, StatusBadge } from "./portal-shell";
import styles from "./workspace-ui.module.css";

type AdminWork = {
  id: string;
  codigo: string;
  nome: string;
  local: string | null;
  ativa: boolean;
  totalNotas: number;
  criadaEm: string;
  atualizadaEm: string;
};

type WorksResponse = {
  obras: AdminWork[];
  paginacao: {
    pagina: number;
    porPagina: number;
    total: number;
    totalPaginas: number;
  };
};

type WorkFormState = {
  codigo: string;
  nome: string;
  local: string;
};

const emptyForm: WorkFormState = { codigo: "", nome: "", local: "" };

function getApiError(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object") return fallback;
  if ("error" in payload && typeof payload.error === "string") {
    return payload.error;
  }
  if (
    "erro" in payload &&
    payload.erro &&
    typeof payload.erro === "object" &&
    "mensagem" in payload.erro &&
    typeof payload.erro.mensagem === "string"
  ) {
    return payload.erro.mensagem;
  }
  return fallback;
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: init?.body
      ? { "Content-Type": "application/json", ...init.headers }
      : init?.headers,
  });
  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    throw new Error(
      getApiError(payload, "Não foi possível concluir a operação."),
    );
  }
  return payload as T;
}

export function AdminWorksClient() {
  const [works, setWorks] = useState<AdminWork[]>([]);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"todas" | "ativas" | "inativas">(
    "todas",
  );
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [metrics, setMetrics] = useState({ active: 0, inactive: 0 });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [editing, setEditing] = useState<AdminWork | null>(null);
  const [form, setForm] = useState<WorkFormState>(emptyForm);
  const [formOpen, setFormOpen] = useState(false);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [searchInput]);

  const loadMetrics = useCallback(async () => {
    const [active, inactive] = await Promise.all([
      requestJson<WorksResponse>("/api/admin/obras?status=ativas&porPagina=1"),
      requestJson<WorksResponse>(
        "/api/admin/obras?status=inativas&porPagina=1",
      ),
    ]);
    setMetrics({
      active: active.paginacao.total,
      inactive: inactive.paginacao.total,
    });
  }, []);

  const loadWorks = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          status,
          pagina: String(page),
          porPagina: "10",
        });
        if (search) params.set("busca", search);
        const response = await requestJson<WorksResponse>(
          `/api/admin/obras?${params}`,
          { signal },
        );
        setWorks(response.obras);
        setTotal(response.paginacao.total);
        setTotalPages(Math.max(1, response.paginacao.totalPaginas));
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === "AbortError")
          return;
        setError(
          caught instanceof Error
            ? caught.message
            : "Não foi possível carregar as obras.",
        );
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [page, search, status],
  );

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(
      () => void loadWorks(controller.signal),
      0,
    );
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [loadWorks]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void loadMetrics().catch((caught) => {
        setError(
          caught instanceof Error
            ? caught.message
            : "Não foi possível carregar os totais.",
        );
      });
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [loadMetrics]);

  function startCreate() {
    setEditing(null);
    setForm(emptyForm);
    setError(null);
    setSuccess(null);
    setFormOpen(true);
  }

  function startEdit(work: AdminWork) {
    setEditing(work);
    setForm({ codigo: work.codigo, nome: work.nome, local: work.local ?? "" });
    setError(null);
    setSuccess(null);
    setFormOpen(true);
  }

  function closeForm() {
    setEditing(null);
    setForm(emptyForm);
    setFormOpen(false);
  }

  async function submitWork(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const payload = {
        codigo: form.codigo,
        nome: form.nome,
        local: form.local || null,
      };
      if (editing) {
        await requestJson(`/api/admin/obras/${editing.id}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
        setSuccess("Obra atualizada com sucesso.");
      } else {
        await requestJson("/api/admin/obras", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        setSuccess("Obra cadastrada com sucesso.");
      }
      closeForm();
      await Promise.all([loadWorks(), loadMetrics()]);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Não foi possível salvar a obra.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function toggleWork(work: AdminWork) {
    if (
      work.ativa &&
      !window.confirm(
        "Desativar esta obra? Ela deixará de aparecer no envio de notas, mas todo o histórico será preservado.",
      )
    ) {
      return;
    }

    setError(null);
    setSuccess(null);
    try {
      await requestJson(`/api/admin/obras/${work.id}`, {
        method: "PATCH",
        body: JSON.stringify({ ativa: !work.ativa }),
      });
      setSuccess(work.ativa ? "Obra desativada." : "Obra reativada.");
      await Promise.all([loadWorks(), loadMetrics()]);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Não foi possível alterar a obra.",
      );
    }
  }

  const firstItem = total === 0 ? 0 : (page - 1) * 10 + 1;
  const lastItem = Math.min(page * 10, total);

  return (
    <>
      <PageIntro
        title="Obras"
        description="Gerencie as obras cadastradas no sistema. Elas serão utilizadas na seleção do envio de notas fiscais."
        action={<button onClick={startCreate}>＋ Nova obra</button>}
      />
      <section className={styles.workMetrics}>
        <MetricCard
          icon="building"
          label="Obras ativas"
          value={String(metrics.active)}
          footnote="Disponíveis para envio"
        />
        <MetricCard
          icon="building"
          label="Obras inativas"
          value={String(metrics.inactive)}
          footnote="Histórico preservado"
          tone="orange"
        />
        <MetricCard
          icon="building"
          label="Total de obras"
          value={String(metrics.active + metrics.inactive)}
          footnote="Cadastradas no sistema"
          tone="green"
        />
      </section>
      {error ? (
        <p className={styles.workFeedbackError} role="alert">
          {error}
        </p>
      ) : null}
      {success ? (
        <p className={styles.workFeedbackSuccess} role="status">
          {success}
        </p>
      ) : null}
      <section className={styles.worksLayout}>
        <article className={styles.panel}>
          <div className={styles.workSearch}>
            <label>
              <Icon name="search" />
              <input
                aria-label="Buscar obras"
                placeholder="Buscar por nome, código ou local..."
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
              />
            </label>
            <select
              aria-label="Filtrar obras por status"
              value={status}
              onChange={(event) => {
                setStatus(event.target.value as typeof status);
                setPage(1);
              }}
            >
              <option value="todas">Todas</option>
              <option value="ativas">Ativas</option>
              <option value="inativas">Inativas</option>
            </select>
          </div>
          {loading ? (
            <p className={styles.workEmpty}>Carregando obras...</p>
          ) : null}
          {!loading && works.length === 0 ? (
            <p className={styles.workEmpty}>Nenhuma obra encontrada.</p>
          ) : null}
          {!loading && works.length > 0 ? (
            <>
              <table className={styles.dataTable}>
                <thead>
                  <tr>
                    <th>Nome da obra</th>
                    <th>Código</th>
                    <th>Local</th>
                    <th>Notas</th>
                    <th>Status</th>
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {works.map((work) => (
                    <tr key={work.id}>
                      <td>
                        <strong>{work.nome}</strong>
                      </td>
                      <td>{work.codigo}</td>
                      <td>{work.local || "Não informado"}</td>
                      <td>{work.totalNotas}</td>
                      <td>
                        <StatusBadge tone={work.ativa ? "ok" : "danger"}>
                          {work.ativa ? "Ativa" : "Inativa"}
                        </StatusBadge>
                      </td>
                      <td>
                        <span className={styles.workActions}>
                          <button onClick={() => startEdit(work)}>
                            Editar
                          </button>
                          <button onClick={() => void toggleWork(work)}>
                            {work.ativa ? "Desativar" : "Reativar"}
                          </button>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className={styles.mobileCardsList}>
                {works.map((work) => (
                  <article className={styles.workMobileCard} key={work.id}>
                    <span className={styles.noteIcon}>
                      <Icon name="building" />
                    </span>
                    <div>
                      <h2>{work.nome}</h2>
                      <p>
                        {work.codigo} · {work.local || "Local não informado"}
                      </p>
                      <p>{work.totalNotas} nota(s)</p>
                      <StatusBadge tone={work.ativa ? "ok" : "danger"}>
                        {work.ativa ? "Ativa" : "Inativa"}
                      </StatusBadge>
                    </div>
                    <span className={styles.workActions}>
                      <button onClick={() => startEdit(work)}>Editar</button>
                      <button onClick={() => void toggleWork(work)}>
                        {work.ativa ? "Desativar" : "Reativar"}
                      </button>
                    </span>
                  </article>
                ))}
              </div>
              <footer className={styles.pagination}>
                <span>
                  {firstItem}-{lastItem} de {total}
                </span>
                <div className={styles.workPaginationButtons}>
                  <button
                    disabled={page === 1}
                    onClick={() => setPage((current) => current - 1)}
                  >
                    Anterior
                  </button>
                  <span>
                    Página {page} de {totalPages}
                  </span>
                  <button
                    disabled={page >= totalPages}
                    onClick={() => setPage((current) => current + 1)}
                  >
                    Próxima
                  </button>
                </div>
              </footer>
            </>
          ) : null}
        </article>
        <form
          className={`${styles.panel} ${styles.workForm} ${formOpen ? styles.workFormOpen : ""}`}
          onSubmit={submitWork}
        >
          <h2>{editing ? "Editar obra" : "Nova obra"}</h2>
          <p>
            {editing
              ? "Atualize os dados da obra selecionada."
              : "Preencha os dados da obra."}
          </p>
          <label>
            Nome da obra <b>*</b>
            <input
              required
              minLength={2}
              maxLength={160}
              placeholder="Ex.: Residencial Parque das Águas"
              value={form.nome}
              onChange={(event) =>
                setForm((current) => ({ ...current, nome: event.target.value }))
              }
            />
          </label>
          <label>
            Código da obra <b>*</b>
            <input
              required
              minLength={2}
              maxLength={32}
              pattern="[A-Za-z0-9][A-Za-z0-9_-]*"
              placeholder="Ex.: OBR-0001"
              value={form.codigo}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  codigo: event.target.value,
                }))
              }
            />
          </label>
          <label>
            Cidade / Estado
            <input
              maxLength={240}
              placeholder="Ex.: Goiânia - GO"
              value={form.local}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  local: event.target.value,
                }))
              }
            />
          </label>
          {editing ? (
            <p className={styles.workHistoryNote}>
              Para alterar o status, use a ação na lista. A desativação preserva
              notas e histórico.
            </p>
          ) : null}
          <button disabled={saving}>
            <Icon name="lock" />{" "}
            {saving
              ? "Salvando..."
              : editing
                ? "Salvar alterações"
                : "Salvar obra"}
          </button>
          <button type="button" onClick={closeForm}>
            Cancelar
          </button>
        </form>
      </section>
      <button className={styles.floatingAction} onClick={startCreate}>
        ＋ Nova obra
      </button>
    </>
  );
}
