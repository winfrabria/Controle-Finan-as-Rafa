import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import { requireInternalUser } from "@/features/internal-notes/require-internal-user";
import {
  PortalShell,
  StatusBadge,
  type PortalRole,
} from "@/features/workspace-ui/portal-shell";
import { Icon } from "@/features/workspace-ui/ui-icons";
import { prisma } from "@/server/db/prisma";
import { createInvoiceSignedUrl } from "@/server/storage";

import { DetailActions } from "./detail-actions";
import styles from "./detail.module.css";
import { ValidationPanel } from "./validation-panel";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const dateOnlyFormatter = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeZone: "UTC",
});
const dateTimeFormatter = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
});
const currencyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});
const FISCAL_CELL_IDS = [
  "base-icms",
  "valor-icms",
  "base-st",
  "valor-st",
  "valor-produtos",
  "valor-frete",
  "valor-seguro",
  "desconto",
  "outras-despesas",
  "valor-ipi",
  "valor-tributos",
  "valor-nota",
] as const;

type DetailData = {
  classification: "OK" | "Suspeita" | "Em análise";
  document: { fileName: string; isImage: boolean; url: string | null };
  extracted: Array<{
    label: string;
    value: string;
    tone?: "blue" | "green" | "orange" | "cyan";
  }>;
  findings: Array<{ description: string; id: string; title: string }>;
  issuedAt: string;
  number: string;
  supplier: string;
  updatedAt: string;
  value: string;
  work: string;
};

type PageProps = { params: Promise<{ id: string }> };

function demoData(id: string): DetailData {
  const number = id.replace("demo-", "") || "00012589";
  return {
    classification: "Suspeita",
    document: { fileName: `DANFE-${number}.pdf`, isImage: false, url: null },
    extracted: [
      { label: "Número da nota", value: number, tone: "blue" },
      { label: "Série", value: "001", tone: "orange" },
      { label: "Tipo de operação", value: "Venda de mercadoria", tone: "cyan" },
      {
        label: "Natureza da operação",
        value: "Venda de mercadoria",
        tone: "cyan",
      },
      {
        label: "CNPJ do fornecedor",
        value: "01.234.567/0001-99",
        tone: "blue",
      },
      { label: "Inscrição estadual", value: "123.456.789.112", tone: "cyan" },
      {
        label: "CNPJ do destinatário",
        value: "09.876.543/0001-21",
        tone: "blue",
      },
      { label: "Data de emissão", value: "30/04/2025", tone: "blue" },
      {
        label: "Valor total dos produtos",
        value: "R$ 125.430,00",
        tone: "green",
      },
      { label: "Valor total da nota", value: "R$ 125.430,00", tone: "green" },
      { label: "Base de cálculo ICMS", value: "R$ 150.000,00", tone: "cyan" },
      { label: "Valor do ICMS", value: "R$ 27.000,00", tone: "cyan" },
    ],
    findings: [
      {
        id: `${id}-finding-1`,
        title: "Item não previsto no contrato",
        description:
          "O item “BRITA 1” não consta na relação de materiais prevista no contrato da obra.",
      },
      {
        id: `${id}-finding-2`,
        title: "Quantidade acima do executado",
        description:
          "O item “CIMENTO CP IV 32 - SACO 50KG” apresenta quantidade 35% acima do executado acumulado.",
      },
      {
        id: `${id}-finding-3`,
        title: "Preço acima da referência",
        description:
          "O item “VERGALHÃO CA-50 12,5MM” possui preço unitário 12% acima da referência cadastrada.",
      },
    ],
    issuedAt: "30/04/2025",
    number,
    supplier: "Construluz Materiais",
    updatedAt: "30/04/2025 08:45",
    value: "R$ 125.430,00",
    work: "Obra Piloto HWN – Alphaville",
  };
}

async function signedUrl(path: string) {
  try {
    return (await createInvoiceSignedUrl({ path })).signedUrl;
  } catch {
    return null;
  }
}

export default async function NoteDetailPage({ params }: PageProps) {
  const { id } = await params;
  const profile = await requireInternalUser(`/notas/${id}`);
  const role: PortalRole = profile.role === "ADMIN" ? "admin" : "reviewer";
  let data: DetailData;

  if (id.startsWith("demo-")) {
    data = demoData(id);
  } else {
    if (!UUID_PATTERN.test(id)) notFound();
    const note = await prisma.note.findUnique({
      where: { id },
      include: {
        work: { select: { name: true } },
        findings: { orderBy: [{ severity: "desc" }, { createdAt: "asc" }] },
      },
    });
    if (!note) notFound();
    const documentUrl = await signedUrl(note.originalFilePath);
    const classification =
      note.classification === "OK"
        ? "OK"
        : note.classification === "SUSPICIOUS"
          ? "Suspeita"
          : "Em análise";
    data = {
      classification,
      document: {
        fileName: note.originalFileName,
        isImage: note.originalMimeType.startsWith("image/"),
        url: documentUrl,
      },
      extracted: [
        {
          label: "Número da nota",
          value: note.documentNumber ?? "Não identificado",
          tone: "blue",
        },
        {
          label: "Fornecedor",
          value: note.supplierName ?? "Não identificado",
          tone: "blue",
        },
        {
          label: "CNPJ do fornecedor",
          value: note.supplierTaxId ?? "Não identificado",
          tone: "cyan",
        },
        {
          label: "Data de emissão",
          value: note.issuedAt
            ? dateOnlyFormatter.format(note.issuedAt)
            : "Não identificada",
          tone: "blue",
        },
        {
          label: "Valor total da nota",
          value: note.totalAmount
            ? currencyFormatter.format(note.totalAmount.toNumber())
            : "Não identificado",
          tone: "green",
        },
        {
          label: "Confiança da leitura",
          value: note.readConfidence
            ? `${Math.round(note.readConfidence.toNumber() * 100)}%`
            : "Não informada",
          tone: "orange",
        },
      ],
      findings: note.findings.map((finding) => ({
        id: finding.id,
        title: finding.title,
        description: finding.description,
      })),
      issuedAt: note.issuedAt
        ? dateOnlyFormatter.format(note.issuedAt)
        : "Não identificada",
      number: note.documentNumber ?? "Sem número",
      supplier: note.supplierName ?? "Fornecedor não identificado",
      updatedAt: dateTimeFormatter.format(note.updatedAt),
      value: note.totalAmount
        ? currencyFormatter.format(note.totalAmount.toNumber())
        : "Não identificado",
      work: note.work.name,
    };
  }

  const basePath = role === "admin" ? "/admin" : "/revisao";
  return (
    <PortalShell active="notas" role={role} userEmail={profile.email}>
      <div className={styles.detailPage}>
        <div className={styles.breadcrumb}>
          <Link href={`${basePath}/notas`}>Notas</Link>
          <span>›</span>
          <b>Detalhe da nota</b>
        </div>
        <header className={styles.detailHeader}>
          <div>
            <div className={styles.titleLine}>
              <h1>Detalhe da nota</h1>
              <StatusBadge
                tone={data.classification === "OK" ? "ok" : "warning"}
              >
                ● &nbsp;{data.classification}
              </StatusBadge>
            </div>
            <p>Análise completa da nota fiscal eletrônica.</p>
          </div>
          <DetailActions />
        </header>

        <section className={styles.summary}>
          <Summary icon="document" label="Obra" value={data.work} />
          <Summary icon="help" label="Fornecedor" value={data.supplier} />
          <Summary
            icon="calendar"
            label="Data da emissão"
            value={data.issuedAt}
          />
          <Summary
            icon="money"
            label="Valor da nota (R$)"
            value={data.value}
            green
          />
        </section>

        <div className={styles.columns}>
          <section className={`${styles.card} ${styles.previewCard}`}>
            <header>
              <h2>Prévia da nota original</h2>
              {data.document.url ? (
                <a href={data.document.url} target="_blank" rel="noreferrer">
                  Abrir em nova aba ↗
                </a>
              ) : null}
            </header>
            <div className={styles.preview}>
              {data.document.url ? (
                data.document.isImage ? (
                  <Image
                    alt={`Nota fiscal ${data.number}`}
                    fill
                    sizes="(max-width: 800px) 100vw, 32vw"
                    src={data.document.url}
                    unoptimized
                  />
                ) : (
                  <iframe
                    src={data.document.url}
                    title={`Nota fiscal ${data.number}`}
                  />
                )
              ) : (
                <DemoDocument
                  number={data.number}
                  supplier={data.supplier}
                  value={data.value}
                />
              )}
            </div>
            <footer>
              <div className={styles.zoom}>
                <button type="button" aria-label="Reduzir zoom">
                  −
                </button>
                <span>100%</span>
                <button type="button" aria-label="Aumentar zoom">
                  ＋
                </button>
              </div>
              {data.document.url ? (
                <a href={data.document.url} target="_blank" rel="noreferrer">
                  <Icon name="download" /> Baixar DANFE
                </a>
              ) : (
                <span>{data.document.fileName}</span>
              )}
            </footer>
          </section>

          <section className={`${styles.card} ${styles.dataCard}`}>
            <header>
              <div>
                <h2>Dados extraídos</h2>
                <p>Campos principais identificados na nota fiscal.</p>
              </div>
            </header>
            <dl>
              {data.extracted.map((item) => (
                <div key={item.label}>
                  <span className={styles[item.tone ?? "blue"]}>
                    <Icon
                      name={
                        item.label.includes("Valor")
                          ? "money"
                          : item.label.includes("Data")
                            ? "calendar"
                            : "document"
                      }
                    />
                  </span>
                  <dt>{item.label}</dt>
                  <dd>{item.value}</dd>
                </div>
              ))}
            </dl>
            <button type="button" className={styles.textButton}>
              Ver todos os campos extraídos →
            </button>
          </section>

          <aside className={styles.rightColumn}>
            <section className={`${styles.card} ${styles.aiCard}`}>
              <header>
                <div>
                  <h2>Explicação da IA</h2>
                  <p>Principais pontos que levaram à classificação da nota.</p>
                </div>
              </header>
              {data.findings.length ? (
                <ol>
                  {data.findings.map((finding) => (
                    <li key={finding.id}>
                      <Icon name="warning" />
                      <div>
                        <strong>{finding.title}</strong>
                        <p>{finding.description}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              ) : (
                <div className={styles.noFindings}>
                  <Icon name="check" />
                  <p>Nenhuma inconsistência foi encontrada nesta nota.</p>
                </div>
              )}
              <button type="button" className={styles.textButton}>
                Ver análise completa da IA →
              </button>
            </section>
            {role === "reviewer" && data.classification !== "OK" ? (
              <ValidationPanel />
            ) : (
              <section className={`${styles.card} ${styles.historyCard}`}>
                <h2>
                  {role === "admin"
                    ? "Acompanhamento administrativo"
                    : "Resultado da auditoria"}
                </h2>
                <p>
                  {role === "admin"
                    ? "A validação do Rafael será exibida aqui com decisão, motivo e comentário completos."
                    : "A nota foi processada e não exige uma decisão humana."}
                </p>
              </section>
            )}
          </aside>
        </div>
        <footer className={styles.updated}>
          ↻ &nbsp; Última atualização: {data.updatedAt}
        </footer>
      </div>
    </PortalShell>
  );
}

function Summary({
  icon,
  label,
  value,
  green = false,
}: {
  icon: "document" | "help" | "calendar" | "money";
  label: string;
  value: string;
  green?: boolean;
}) {
  return (
    <div>
      <span className={green ? styles.green : styles.blue}>
        <Icon name={icon} />
      </span>
      <dl>
        <dt>{label}</dt>
        <dd>{value}</dd>
      </dl>
    </div>
  );
}

function DemoDocument({
  number,
  supplier,
  value,
}: {
  number: string;
  supplier: string;
  value: string;
}) {
  return (
    <div className={styles.demoDocument}>
      <header>
        <div>
          <strong>{supplier.toUpperCase()}</strong>
          <small>
            Rua das Indústrias, 123
            <br />
            São Paulo - SP
          </small>
        </div>
        <b>DANFE</b>
        <div>
          <small>CONTROLE DO FISCO</small>
          <span className={styles.barcode} />
        </div>
      </header>
      <section>
        <div>
          <small>Nº</small>
          <b>{number}</b>
          <small>SÉRIE 001 · FOLHA 1/1</small>
        </div>
        <div>
          <small>NATUREZA DA OPERAÇÃO</small>
          <strong>VENDA DE MERCADORIA</strong>
        </div>
      </section>
      <section className={styles.fiscalGrid}>
        {FISCAL_CELL_IDS.map((cellId) => (
          <span key={cellId} />
        ))}
      </section>
      <table>
        <thead>
          <tr>
            <th>CÓDIGO</th>
            <th>DESCRIÇÃO</th>
            <th>QTD.</th>
            <th>VLR. UNIT.</th>
            <th>VLR. TOTAL</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>000123</td>
            <td>CIMENTO CP IV 32</td>
            <td>200</td>
            <td>28,50</td>
            <td>5.700,00</td>
          </tr>
          <tr>
            <td>000124</td>
            <td>AREIA MÉDIA LAVADA</td>
            <td>310</td>
            <td>87,50</td>
            <td>10.500,00</td>
          </tr>
          <tr>
            <td>000125</td>
            <td>BRITA 1</td>
            <td>100</td>
            <td>95,00</td>
            <td>9.500,00</td>
          </tr>
          <tr>
            <td colSpan={4}>VALOR TOTAL DA NOTA</td>
            <td>
              <b>{value.replace("R$ ", "")}</b>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
