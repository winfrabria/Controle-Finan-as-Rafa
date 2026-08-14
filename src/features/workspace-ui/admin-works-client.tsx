"use client";

import {
  ChangeEvent,
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { beginPwaCriticalActivity } from "@/components/pwa/pwa-critical-activity";

import { Icon } from "./ui-icons";
import styles from "./admin-works.module.css";

type AdminWork = {
  id: string;
  codigo: string;
  nome: string;
  local: string | null;
  ativa: boolean;
  responsavel: string | null;
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
  cidade: string;
  uf: string;
  responsavel: string;
  ativa: boolean;
};

type ImportResult = {
  valido: boolean;
  aplicado: boolean;
  totalLinhas: number;
  erros: Array<{ linha: number; campo: string; mensagem: string }>;
};

const emptyForm: WorkFormState = {
  codigo: "",
  nome: "",
  cidade: "",
  uf: "",
  responsavel: "",
  ativa: true,
};
const PAGE_SIZE = 10;
const UFS = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT",
  "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO",
  "RR", "SC", "SP", "SE", "TO",
] as const;

function splitLocation(location: string | null) {
  if (!location) return { cidade: "", uf: "" };
  const separator = location.lastIndexOf(" - ");
  if (separator < 0) return { cidade: location, uf: "" };
  return {
    cidade: location.slice(0, separator),
    uf: location.slice(separator + 3).toUpperCase(),
  };
}

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
  const [citySuggestions, setCitySuggestions] = useState<string[]>([]);
  const [cityOpen, setCityOpen] = useState(false);
  const [cityLoading, setCityLoading] = useState(false);
  const [cityWarning, setCityWarning] = useState<string | null>(null);
  const [importCsv, setImportCsv] = useState("");
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importing, setImporting] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);
  const mobileFormDialogRef = useRef<HTMLDivElement>(null);
  const importDialogRef = useRef<HTMLElement>(null);
  const modalTriggerRef = useRef<HTMLElement | null>(null);

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
    if (!form.uf) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setCityLoading(true);
      try {
        const params = new URLSearchParams({ uf: form.uf });
        if (form.cidade.trim()) params.set("busca", form.cidade.trim());
        const response = await fetch(`/api/localidades/municipios?${params}`, {
          cache: "force-cache",
          signal: controller.signal,
        });
        const payload = (await response.json()) as {
          cidades?: string[];
          aviso?: string;
        };
        setCitySuggestions(payload.cidades ?? []);
        setCityWarning(payload.aviso ?? null);
      } catch (caught) {
        if (!(caught instanceof DOMException && caught.name === "AbortError")) {
          setCitySuggestions([]);
          setCityWarning("Digite a cidade manualmente.");
        }
      } finally {
        if (!controller.signal.aborted) setCityLoading(false);
      }
    }, 250);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [form.cidade, form.uf]);

  useEffect(() => {
    const mobileFormActive =
      formOpen && window.matchMedia("(max-width: 940px)").matches;
    const dialog = importResult
      ? importDialogRef.current
      : mobileFormActive
        ? mobileFormDialogRef.current
        : null;
    if (!dialog) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = window.requestAnimationFrame(() => dialog.focus());
    const handleKeyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (importResult) {
          setImportResult(null);
          setImportCsv("");
        } else {
          setEditing(null);
          setForm(emptyForm);
          setCitySuggestions([]);
          setCityWarning(null);
          setFormOpen(false);
        }
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (!focusable.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handleKeyboard);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", handleKeyboard);
      document.body.style.overflow = previousOverflow;
      modalTriggerRef.current?.focus();
      modalTriggerRef.current = null;
    };
  }, [formOpen, importResult]);

  function startCreate() {
    modalTriggerRef.current = document.activeElement as HTMLElement | null;
    setEditing(null);
    setForm(emptyForm);
    setError(null);
    setSuccess(null);
    setActionsOpen(null);
    setCitySuggestions([]);
    setCityWarning(null);
    setFormOpen(true);
  }

  function startEdit(work: AdminWork) {
    modalTriggerRef.current = document.activeElement as HTMLElement | null;
    const location = splitLocation(work.local);
    setEditing(work);
    setForm({
      codigo: work.codigo,
      nome: work.nome,
      cidade: location.cidade,
      uf: location.uf,
      responsavel: work.responsavel ?? "",
      ativa: work.ativa,
    });
    setError(null);
    setSuccess(null);
    setActionsOpen(null);
    setCitySuggestions([]);
    setCityWarning(null);
    setFormOpen(true);
  }

  function clearForm() {
    setEditing(null);
    setForm(emptyForm);
    setCitySuggestions([]);
    setCityWarning(null);
  }

  function closeForm() {
    clearForm();
    setFormOpen(false);
  }

  async function submitWork(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const endCriticalActivity = beginPwaCriticalActivity();
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const payload = {
        codigo: form.codigo.trim(),
        nome: form.nome.trim(),
        local: `${form.cidade.trim()} - ${form.uf}`,
        responsavel: form.responsavel.trim(),
        ativa: form.ativa,
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
      endCriticalActivity();
    }
  }

  async function validateImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.name.toLocaleLowerCase("pt-BR").endsWith(".csv")) {
      setError("Selecione um arquivo no formato CSV.");
      return;
    }
    const endCriticalActivity = beginPwaCriticalActivity();
    setImporting(true);
    setError(null);
    try {
      const csv = await file.text();
      const result = await requestJson<ImportResult>("/api/admin/obras/import", {
        method: "POST",
        body: JSON.stringify({ modo: "validar", csv }),
      });
      setImportCsv(csv);
      setImportResult(result);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Não foi possível validar o CSV.",
      );
    } finally {
      setImporting(false);
      endCriticalActivity();
    }
  }

  function downloadCsvTemplate() {
    const content = [
      "codigo,nome,cidade,uf,responsavel,status",
      "OBR-0001,Residencial Parque das Águas,Goiânia,GO,Naldo,Ativa",
    ].join("\n");
    const url = URL.createObjectURL(
      new Blob([content], { type: "text/csv;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "modelo-importacao-obras.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  async function applyImport() {
    if (!importResult?.valido || !importCsv) return;
    const endCriticalActivity = beginPwaCriticalActivity();
    setImporting(true);
    setError(null);
    try {
      const result = await requestJson<ImportResult>("/api/admin/obras/import", {
        method: "POST",
        body: JSON.stringify({ modo: "aplicar", csv: importCsv }),
      });
      setImportResult(null);
      setImportCsv("");
      setSuccess(`${result.totalLinhas} obra(s) importada(s) com sucesso.`);
      await Promise.all([loadWorks(), loadMetrics()]);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Não foi possível importar as obras.",
      );
    } finally {
      setImporting(false);
      endCriticalActivity();
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

    const endCriticalActivity = beginPwaCriticalActivity();
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
      endCriticalActivity();
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
          className={styles.editButton}
          aria-label={`Editar ${work.nome}`}
          onClick={() => startEdit(work)}
        >
          <Icon name="edit" />
        </button>
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

  function renderWorkForm(cityOptionsId: string) {
    return (
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
      <div className={styles.locationFields}>
        <label>
          Estado <b>*</b>
          <select
            required
            value={form.uf}
            onChange={(event) => {
              setCitySuggestions([]);
              setCityWarning(null);
              setForm((current) => ({
                ...current,
                uf: event.target.value,
                cidade: "",
              }));
            }}
          >
            <option value="">UF</option>
            {UFS.map((uf) => (
              <option key={uf} value={uf}>{uf}</option>
            ))}
          </select>
        </label>
        <label>
          Cidade <b>*</b>
          <div className={styles.cityCombobox}>
            <input
              required
              maxLength={200}
              role="combobox"
              aria-autocomplete="list"
              aria-controls={cityOptionsId}
              aria-expanded={cityOpen && citySuggestions.length > 0}
              disabled={!form.uf}
              placeholder={form.uf ? "Busque ou digite a cidade" : "Selecione a UF"}
              value={form.cidade}
              onFocus={() => setCityOpen(true)}
              onBlur={() => window.setTimeout(() => setCityOpen(false), 120)}
              onChange={(event) => {
                setCityOpen(true);
                setForm((current) => ({ ...current, cidade: event.target.value }));
              }}
            />
            {cityOpen && citySuggestions.length > 0 ? (
              <div className={styles.cityOptions} id={cityOptionsId} role="listbox">
                {citySuggestions.map((city) => (
                  <button
                    key={city}
                    type="button"
                    role="option"
                    aria-selected={form.cidade === city}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      setForm((current) => ({ ...current, cidade: city }));
                      setCityOpen(false);
                    }}
                  >
                    {city}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </label>
      </div>
      {cityLoading ? <p className={styles.fieldHint}>Buscando cidades no IBGE…</p> : null}
      {cityWarning ? <p className={styles.fieldHint}>{cityWarning}</p> : null}
      <label>
        Responsável <b>*</b>
        <input
          required
          minLength={2}
          maxLength={120}
          placeholder="Nome do responsável pela obra"
          value={form.responsavel}
          onChange={(event) =>
            setForm((current) => ({
              ...current,
              responsavel: event.target.value,
            }))
          }
        />
      </label>
      <label>
        Status <b>*</b>
        <select
          value={form.ativa ? "ativa" : "inativa"}
          onChange={(event) =>
            setForm((current) => ({
              ...current,
              ativa: event.target.value === "ativa",
            }))
          }
        >
          <option value="ativa">Ativa</option>
          <option value="inativa">Inativa</option>
        </select>
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
  }

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
        <div className={styles.headerActions}>
          <input
            ref={importInputRef}
            className={styles.fileInput}
            type="file"
            accept=".csv,text/csv"
            onChange={(event) => void validateImport(event)}
          />
          <button
            className={styles.importButton}
            disabled={importing}
            onClick={() => {
              modalTriggerRef.current = document.activeElement as HTMLElement;
              importInputRef.current?.click();
            }}
            title="Selecione um CSV com código, nome, cidade, UF, responsável e status"
          >
            <Icon name="upload" /> {importing ? "Validando..." : "Importar"}
          </button>
          <button className={styles.newWorkButton} onClick={startCreate}>
            <span>＋</span> Nova obra
          </button>
        </div>
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
                        <th>Responsável</th>
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
                          <td>
                            {work.responsavel || "Não definido"}
                          </td>
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
                        <small>
                          Responsável: {work.responsavel || "Não definido"}
                        </small>
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

        <aside className={styles.desktopForm}>
          {renderWorkForm("desktop-work-city-options")}
        </aside>
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
          <div
            aria-label={editing ? "Editar obra" : "Nova obra"}
            aria-modal="true"
            className={styles.mobileFormDialog}
            ref={mobileFormDialogRef}
            role="dialog"
            tabIndex={-1}
          >
            {renderWorkForm("mobile-work-city-options")}
          </div>
        </div>
      ) : null}

      {importResult ? (
        <div className={styles.importBackdrop} role="presentation">
          <section
            aria-labelledby="import-works-title"
            aria-modal="true"
            className={styles.importDialog}
            ref={importDialogRef}
            role="dialog"
            tabIndex={-1}
          >
            <div className={styles.formHeader}>
              <div>
                <h2 id="import-works-title">Importar obras</h2>
                <p>
                  {importResult.valido
                    ? `${importResult.totalLinhas} linha(s) pronta(s) para importar.`
                    : "Corrija os itens indicados e selecione o CSV novamente."}
                </p>
              </div>
              <button
                className={styles.closeFormButton}
                type="button"
                aria-label="Fechar importação"
                onClick={() => {
                  setImportResult(null);
                  setImportCsv("");
                }}
              >
                ×
              </button>
            </div>
            {importResult.erros.length > 0 ? (
              <ul className={styles.importErrors}>
                {importResult.erros.slice(0, 12).map((issue, index) => (
                  <li key={`${issue.linha}-${issue.campo}-${index}`}>
                    Linha {issue.linha}, {issue.campo}: {issue.mensagem}
                  </li>
                ))}
              </ul>
            ) : (
              <p className={styles.importReady}>
                Validação concluída. Nenhum conflito foi encontrado.
              </p>
            )}
            <div className={styles.importActions}>
              <button
                className={styles.clearButton}
                type="button"
                onClick={downloadCsvTemplate}
              >
                Baixar modelo CSV
              </button>
              <button
                className={styles.clearButton}
                type="button"
                onClick={() => {
                  setImportResult(null);
                  setImportCsv("");
                }}
              >
                Cancelar
              </button>
              <button
                className={styles.saveButton}
                disabled={!importResult.valido || importing}
                onClick={() => void applyImport()}
              >
                {importing ? "Importando..." : "Aplicar importação"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
