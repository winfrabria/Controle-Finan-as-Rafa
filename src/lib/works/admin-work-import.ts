import { createAdminWorkSchema } from "./admin-work-contract";

const REQUIRED_HEADERS = [
  "codigo",
  "nome",
  "cidade",
  "uf",
  "status",
] as const;

export type AdminWorkImportRow = {
  linha: number;
  codigo: string;
  nome: string;
  local: string;
  responsavel: string;
  ativa: boolean;
};

export type AdminWorkImportIssue = {
  linha: number;
  campo: string;
  mensagem: string;
};

function readCsv(csv: string) {
  const records: Array<{ line: number; values: string[] }> = [];
  let values: string[] = [];
  let value = "";
  let quoted = false;
  let line = 1;
  let recordLine = 1;

  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index];
    const next = csv[index + 1];

    if (char === '"') {
      if (quoted && next === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }

    if (char === "," && !quoted) {
      values.push(value.trim());
      value = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      values.push(value.trim());
      if (values.some(Boolean)) records.push({ line: recordLine, values });
      values = [];
      value = "";
      line += 1;
      recordLine = line;
      continue;
    }

    if (char === "\n") line += 1;
    value += char;
  }

  if (quoted) {
    throw new Error("O arquivo CSV possui aspas não fechadas.");
  }

  values.push(value.trim());
  if (values.some(Boolean)) records.push({ line: recordLine, values });
  return records;
}

function parseStatus(value: string) {
  const normalized = value.trim().toLocaleLowerCase("pt-BR");
  if (["ativa", "ativo", "true", "1"].includes(normalized)) return true;
  if (["inativa", "inativo", "false", "0"].includes(normalized)) return false;
  return null;
}

export function parseAdminWorksCsv(csv: string): {
  rows: AdminWorkImportRow[];
  issues: AdminWorkImportIssue[];
} {
  let records: ReturnType<typeof readCsv>;
  try {
    records = readCsv(csv.replace(/^\uFEFF/, ""));
  } catch (error) {
    return {
      rows: [],
      issues: [
        {
          linha: 1,
          campo: "csv",
          mensagem: error instanceof Error ? error.message : "CSV inválido.",
        },
      ],
    };
  }

  const header = records.shift();
  if (!header) {
    return {
      rows: [],
      issues: [{ linha: 1, campo: "csv", mensagem: "O arquivo CSV está vazio." }],
    };
  }

  const normalizedHeaders = header.values.map((item) => item.toLowerCase());
  const missingHeaders = REQUIRED_HEADERS.filter(
    (item) => !normalizedHeaders.includes(item),
  );
  if (missingHeaders.length > 0) {
    return {
      rows: [],
      issues: [
        {
          linha: header.line,
          campo: "cabecalho",
          mensagem: `Colunas obrigatórias ausentes: ${missingHeaders.join(", ")}.`,
        },
      ],
    };
  }

  const responsibleHeader = normalizedHeaders.includes("responsavel")
    ? "responsavel"
    : normalizedHeaders.includes("responsavel_email")
      ? "responsavel_email"
      : null;
  if (!responsibleHeader) {
    return {
      rows: [],
      issues: [
        {
          linha: header.line,
          campo: "cabecalho",
          mensagem: "Coluna obrigatória ausente: responsavel.",
        },
      ],
    };
  }

  const indexes = Object.fromEntries(
    REQUIRED_HEADERS.map((name) => [name, normalizedHeaders.indexOf(name)]),
  ) as Record<(typeof REQUIRED_HEADERS)[number], number>;
  const rows: AdminWorkImportRow[] = [];
  const issues: AdminWorkImportIssue[] = [];

  for (const record of records) {
    const get = (name: (typeof REQUIRED_HEADERS)[number]) =>
      record.values[indexes[name]]?.trim() ?? "";
    const uf = get("uf").toUpperCase();
    const cidade = get("cidade");
    const status = parseStatus(get("status"));
    const responsavel =
      record.values[normalizedHeaders.indexOf(responsibleHeader)]?.trim() ?? "";
    const local = cidade && /^[A-Z]{2}$/.test(uf) ? `${cidade} - ${uf}` : "";
    const candidate = createAdminWorkSchema.safeParse({
      codigo: get("codigo"),
      nome: get("nome"),
      local,
      responsavel,
      ativa: status ?? true,
    });

    if (!cidade) {
      issues.push({ linha: record.line, campo: "cidade", mensagem: "Informe a cidade." });
    }
    if (!/^[A-Z]{2}$/.test(uf)) {
      issues.push({ linha: record.line, campo: "uf", mensagem: "Use uma UF com duas letras." });
    }
    if (responsavel.length < 2) {
      issues.push({ linha: record.line, campo: "responsavel", mensagem: "Informe o nome do responsável." });
    }
    if (status === null) {
      issues.push({ linha: record.line, campo: "status", mensagem: "Use Ativa ou Inativa." });
    }
    if (!candidate.success) {
      for (const issue of candidate.error.issues) {
        const field = String(issue.path[0] ?? "linha");
        if (field === "local" && !local) continue;
        issues.push({ linha: record.line, campo: field, mensagem: issue.message });
      }
    }

    if (
      cidade &&
      /^[A-Z]{2}$/.test(uf) &&
      status !== null &&
      candidate.success
    ) {
      rows.push({
        linha: record.line,
        codigo: candidate.data.codigo,
        nome: candidate.data.nome,
        local,
        responsavel: candidate.data.responsavel,
        ativa: status,
      });
    }
  }

  if (records.length === 0) {
    issues.push({ linha: 1, campo: "csv", mensagem: "Inclua ao menos uma obra." });
  }

  return { rows, issues };
}
