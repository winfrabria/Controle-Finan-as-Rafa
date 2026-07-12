"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import { Icon } from "./ui-icons";
import styles from "./admin-works.module.css";

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
const PAGE_SIZE = 10;

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
  const [changingStatusId, setChangingStatusId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [editing, setEditing] = useState<AdminWork | null>(null);
  const [form, setForm] = useState<WorkFormState>(emptyForm);
  const [formOpen, setFormOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState<string | null>(null);

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
          porPagina: String(PAGE_SIZE),
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
        if (caught instanceof DOMException && caught.name === "AbortError") {
          return;
        }
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

  useEffect(() => {
    if (!formOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setEditing(null);
        setForm(emptyForm);
        setFormOpen(false);
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [formOpen]);

  function startCreate() {
    setEditing(null);
    setForm(emptyForm);
    setError(null);
    setSuccess(null);
    setActionsOpen(null);
    setFormOpen(true);
  }

  function startEdit(work: AdminWork) {
    setEditing(work);
    setForm({ codigo: work.codigo, nome: work.nome, local: work.local ?? "" });
    setError(null);
    setSuccess(null);
    setActionsOpen(null);
    setFormOpen(true);
  }

  function clearForm() {
    setEditing(null);
    setForm(emptyForm);
  }

  function closeForm() {
    clearForm();
    setFormOpen(false);
  }

  async function submitWork(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const payload = {
        codigo: form.codigo.trim(),
        nome: form.nome.trim(),
        local: form.local.trim() || null,
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
    setActionsOpen(null);
    if (
      work.ativa &&
      !window.confirm(
        "Desativar esta obra? Ela deixará de aparecer no envio de notas, mas as notas vinculadas e todo o histórico serão preservados.",
      )
    ) {
      return;
    }

    setChangingStatusId(work.id);
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
    } finally {
      setChangingStatusId(null);
    }
  }

  const firstItem = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const lastItem = Math.min(page * PAGE_SIZE, total);
  const pageNumbers = useMemo(() => {
    const start = Math.max(1, Math.min(page - 2, totalPages - 4));
    return Array.from(
      { length: Math.min(5, totalPages) },
      (_, index) => start + index,
    );
  }, [page, totalPages]);

  function renderStatus(work: AdminWork) {
    return (
      <span className={work.ativa ? styles.activeBadge : styles.inactiveBadge}>
        <i /> {work.ativa ? "Ativa" : "Inativa"}
      </span>
    );
  }

  function renderActions(work: AdminWork) {
    const open = actionsOpen === work.id;
    return (
      <div className={styles.actionsMenu}>
        <button
          type="button"
          className={styles.moreButton}
          aria-label={`Ações de ${work.nome}`}
          aria-expanded={open}
          onClick={() => setActionsOpen(open ? null : work.id)}
        >
          <Icon name="more" />
        </button>
        {open ? (
          <div className={styles.actionsPopover}>
            <button type="button" onClick={() => startEdit(work)}>
              Editar obra
            </button>
            <button
              type="button"
              disabled={changingStatusId === work.id}
              onClick={() => void toggleWork(work)}
            >
              {work.ativa ? "Desativar obra" : "Reativar obra"}
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  const workForm = (
    <form className={styles.workForm} onSubmit={submitWork}>
      <div className={styles.formHeader}>
        <div>
          <h2>{editing ? "Editar obra" : "Nova obra"}</h2>
          <p>
            {editing
              ? "Atualize os dados da obra selecionada."
              : "Preencha os dados da obra."}
          </p>
        </div>
        <button
          className={styles.closeFormButton}
          type="button"
          aria-label="Fechar formulário"
          onClick={closeForm}
        >
          ×
        </button>
      </div>
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
            setForm((current) => ({ ...current, local: event.target.value }))
          }
        />
      </label>
      <p className={styles.historyNote}>
        A desativação nunca exclui as notas nem o histórico vinculados à obra.
      </p>
      <button className={styles.saveButton} disabled={saving}>
        <Icon name="lock" />
        {saving ? "Salvando..." : editing ? "Salvar alterações" : "Salvar obra"}
      </button>
      <button className={styles.clearButton} type="button" onClick={clearForm}>
        Limpar
      </button>
    </form>
  );

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <h1>Obras</h1>
          <p>
            Gerencie as obras cadastradas no sistema. Elas serão utilizadas na
            seleção do envio de notas fiscais.
          </p>
        </div>
        <button className={styles.newWorkButton} onClick={startCreate}>
          <span>＋</span> Nova obra
        </button>
      </header>

      <div className={styles.desktopGrid}>
        <main>
          <section className={styles.metrics} aria-label="Resumo de obras">
            <article className={styles.metricCard}>
              <span className={`${styles.metricIcon} ${styles.blueIcon}`}>
                <Icon name="building" />
              </span>
              <div>
                <p>Obras ativas</p>
                <strong>{metrics.active}</strong>
                <small className={styles.blueText}>
                  Disponíveis para envio
                </small>
              </div>
            </article>
            <article className={styles.metricCard}>
              <span className={`${styles.metricIcon} ${styles.orangeIcon}`}>
                <Icon name="building" />
              </span>
              <div>
                <p>Obras inativas</p>
                <strong>{metrics.inactive}</strong>
                <small className={styles.orangeText}>
                  Histórico preservado
                </small>
              </div>
            </article>
            <article className={styles.metricCard}>
              <span className={`${styles.metricIcon} ${styles.greenIcon}`}>
                <Icon name="building" />
              </span>
              <div>
                <p>Total de obras</p>
                <strong>{metrics.active + metrics.inactive}</strong>
                <small className={styles.greenText}>
                  Cadastradas no sistema
                </small>
              </div>
            </article>
          </section>

          {error ? (
            <p className={styles.errorFeedback} role="alert">
              {error}
            </p>
          ) : null}
          {success ? (
            <p className={styles.successFeedback} role="status">
              {success}
            </p>
          ) : null}

          <section className={styles.listPanel}>
            <div className={styles.filters}>
              <label className={styles.searchField}>
                <Icon name="search" />
                <input
                  aria-label="Buscar obras"
                  placeholder="Buscar obras..."
                  value={searchInput}
                  onChange={(event) => setSearchInput(event.target.value)}
                />
              </label>
              <label className={styles.statusFilter}>
                <Icon name="filter" />
                <span>Filtrar</span>
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
              </label>
            </div>

            {loading ? (
              <div className={styles.emptyState}>Carregando obras...</div>
            ) : null}
            {!loading && works.length === 0 ? (
              <div className={styles.emptyState}>
                <Icon name="building" />
                <strong>Nenhuma obra encontrada</strong>
                <span>Tente alterar a busca ou o filtro selecionado.</span>
              </div>
            ) : null}
            {!loading && works.length > 0 ? (
              <>
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Nome da obra</th>
                        <th>Código</th>
                        <th>Local</th>
                        <th>Notas</th>
                        <th>Status</th>
                        <th aria-label="Ações" />
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
                          <td>{renderStatus(work)}</td>
                          <td>{renderActions(work)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className={styles.mobileList}>
                  {works.map((work) => (
                    <article className={styles.mobileCard} key={work.id}>
                      <span className={styles.mobileWorkIcon}>
                        <Icon name="building" />
                      </span>
                      <div className={styles.mobileWorkInfo}>
                        <h2>{work.nome}</h2>
                        <p>
                          {work.codigo} <i>•</i> {work.local || "Não informado"}
                        </p>
                        <small>{work.totalNotas} nota(s)</small>
                        {renderStatus(work)}
                      </div>
                      {renderActions(work)}
                    </article>
                  ))}
                </div>

                <footer className={styles.pagination}>
                  <span>
                    {firstItem}-{lastItem} de {total} obras
                  </span>
                  <nav aria-label="Paginação das obras">
                    <button
                      aria-label="Página anterior"
                      disabled={page === 1}
                      onClick={() => setPage((current) => current - 1)}
                    >
                      ‹
                    </button>
                    {pageNumbers.map((number) => (
                      <button
                        className={number === page ? styles.currentPage : ""}
                        aria-current={number === page ? "page" : undefined}
                        key={number}
                        onClick={() => setPage(number)}
                      >
                        {number}
                      </button>
                    ))}
                    <button
                      aria-label="Próxima página"
                      disabled={page >= totalPages}
                      onClick={() => setPage((current) => current + 1)}
                    >
                      ›
                    </button>
                  </nav>
                </footer>
              </>
            ) : null}
          </section>
        </main>

        <aside className={styles.desktopForm}>{workForm}</aside>
      </div>

      <button className={styles.floatingButton} onClick={startCreate}>
        <span>＋</span> Nova obra
      </button>

      {formOpen ? (
        <div
          className={styles.mobileFormBackdrop}
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) closeForm();
          }}
        >
          <div className={styles.mobileFormDialog} role="dialog" aria-modal>
            {workForm}
          </div>
        </div>
      ) : null}
    </div>
  );
}
