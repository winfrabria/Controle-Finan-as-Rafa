import "dotenv/config";

import crypto from "node:crypto";
import pg from "pg";

const { Client } = pg;
const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
const DEMO_SEED = "winfra-demo-v1";
const DEMO_PREFIX = "DEMO-";

if (!connectionString) {
  throw new Error("DIRECT_URL or DATABASE_URL is required to seed demo data.");
}

const resetReads = process.argv.includes("--reset-reads");
const client = new Client({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function dateOnlyFromOffset(offsetDays) {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - offsetDays);
  return date.toISOString().slice(0, 10);
}

function timestamp(dateOnly, hours = 10, minutes = 0) {
  return new Date(`${dateOnly}T${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:00-03:00`);
}

function addMinutes(value, minutes) {
  return new Date(value.getTime() + minutes * 60_000);
}

function money(value) {
  return value === null || value === undefined ? null : Number(value).toFixed(2);
}

const workFixtures = [
  { code: "MVP-OBRA-01", name: "[DEMO] Obra 01", location: "Goiânia - GO", responsibleName: "Naldo" },
  { code: "MVP-OBRA-02", name: "[DEMO] Obra 02", location: "Rio Branco - AC", responsibleName: "Naldo" },
  { code: "MVP-OBRA-03", name: "[DEMO] Obra 03", location: "Sorriso - MT", responsibleName: "Naldo" },
];

const fixtureDefinitions = [
  {
    key: "ok-001",
    offsetDays: 2,
    status: "OK",
    stage: "COMPLETED",
    classification: "OK",
    auditResult: "OK",
    documentNumber: "DEMO-OK-001",
    fileName: "DEMO_NF_Construtora_Horizonte.pdf",
    supplier: "Construtora Horizonte Ltda.",
    taxId: "12.345.678/0001-90",
    amount: 18450,
    workIndex: 0,
    confidence: 0.98,
    extraction: {
      serie: "001",
      tipoOperacao: "Venda de mercadoria",
      naturezaOperacao: "Venda de materiais",
      inscricaoEstadual: "123.456.789.112",
      valorProdutos: "18450.00",
      baseCalculoIcms: "18450.00",
      valorIcms: "3321.00",
    },
    items: [
      ["000101", "Cimento CP IV 32 - saco 50kg", "SC", 100, 28.5, 2850],
      ["000102", "Areia média lavada", "M3", 60, 87.5, 5250],
      ["000103", "Vergalhão CA-50 10mm", "KG", 900, 11.5, 10350],
    ],
  },
  {
    key: "suspicious-001",
    offsetDays: 2,
    status: "PENDING_VALIDATION",
    stage: "COMPLETED",
    classification: "SUSPICIOUS",
    auditResult: "SUSPICIOUS",
    documentNumber: "DEMO-SUS-001",
    fileName: "DEMO_NF_Transportes_Ideal.pdf",
    supplier: "Transportes Ideal",
    taxId: "23.456.789/0001-01",
    amount: 18900,
    workIndex: 1,
    confidence: 0.94,
    extraction: {
      serie: "003",
      tipoOperacao: "Prestação de serviço",
      naturezaOperacao: "Transporte de materiais",
      inscricaoEstadual: "223.456.789.002",
      valorProdutos: "18900.00",
      baseCalculoIcms: "18900.00",
      valorIcms: "3402.00",
    },
    items: [["TR-001", "Transporte de material", "SV", 1, 18900, 18900]],
    findings: [
      {
        code: "PRICE_ABOVE_REFERENCE",
        title: "Preço acima da referência",
        description: "O valor unitário está acima do histórico da obra.",
        category: "Preço",
        severity: "WARNING",
        confidence: 0.94,
        source: "WORK_RULE",
        evidence: { text: "R$ 18.900,00 contra referência média de R$ 15.500,00." },
        expectedValue: { amount: "15500.00", source: "Histórico da Obra 02" },
        actualValue: { amount: "18900.00", source: "DEMO-SUS-001" },
        justification: "A diferença supera o limite de variação configurado para a obra.",
        noteItem: 0,
      },
      {
        code: "DATE_OUTSIDE_PERIOD",
        title: "Data fora do período informado",
        description: "A data de emissão diverge do período de execução indicado.",
        category: "Data",
        severity: "INFO",
        confidence: 0.87,
        source: "AI_DISCOVERY",
        evidence: { text: "Emissão em período diferente do relatório operacional." },
        expectedValue: { period: "Período vigente da obra" },
        actualValue: { issuedAt: "Data do documento" },
        justification: "O achado precisa ser confirmado com o contexto operacional da obra.",
        noteItem: null,
        isNovel: true,
      },
    ],
    validation: {
      decision: "SUSPICION_CONFIRMED",
      reason: "Preço acima do histórico da obra",
      comment: "Demonstração: divergência confirmada pelo responsável financeiro.",
    },
  },
  {
    key: "suspicious-002",
    offsetDays: 3,
    status: "PENDING_VALIDATION",
    stage: "COMPLETED",
    classification: "SUSPICIOUS",
    auditResult: "SUSPICIOUS",
    documentNumber: "DEMO-SUS-002",
    fileName: "DEMO_NF_MegaParafusos.pdf",
    supplier: "MegaParafusos",
    taxId: "34.567.890/0001-12",
    amount: 3420,
    workIndex: 0,
    confidence: 0.91,
    extraction: {
      serie: "001",
      tipoOperacao: "Venda de mercadoria",
      naturezaOperacao: "Material de obra",
      inscricaoEstadual: "334.567.890.112",
      valorProdutos: "3420.00",
      baseCalculoIcms: "3420.00",
      valorIcms: "615.60",
    },
    items: [["MP-220", "Kit de parafusos estruturais", "CX", 12, 285, 3420]],
    findings: [
      {
        code: "ITEM_NOT_IN_CONTRACT",
        title: "Item não previsto no contrato",
        description: "O item não aparece na relação de materiais autorizados.",
        category: "Compatibilidade",
        severity: "CRITICAL",
        confidence: 0.91,
        source: "WORK_RULE",
        evidence: { text: "Kit de parafusos estruturais não encontrado na lista da Obra 01." },
        expectedValue: { contract: "Item autorizado na obra" },
        actualValue: { item: "Kit de parafusos estruturais" },
        justification: "A IA sinalizou o item para revisão antes do lançamento financeiro.",
        noteItem: 0,
      },
    ],
    validation: {
      decision: "FALSE_POSITIVE",
      reason: "Material autorizado em aditivo contratual",
      comment: "Demonstração: falso positivo após conferência do aditivo.",
    },
  },
  {
    key: "context-001",
    offsetDays: 3,
    status: "PROCESSING",
    stage: "ANALYZING",
    classification: "NO_PARAMETER",
    auditResult: "NEEDS_CONTEXT",
    documentNumber: "DEMO-CONTEXTO-001",
    fileName: "DEMO_NF_Alimentacao_Obra.pdf",
    supplier: "Refeições da Obra",
    taxId: "45.678.901/0001-23",
    amount: 1260,
    workIndex: 2,
    confidence: 0.79,
    contextSummary: "A nota foi lida, mas faltam informações operacionais para concluir a análise.",
    extraction: {
      serie: "004",
      tipoOperacao: "Fornecimento de refeições",
      naturezaOperacao: "Alimentação da equipe",
      inscricaoEstadual: "445.678.901.223",
      valorProdutos: "1260.00",
      baseCalculoIcms: "1260.00",
      valorIcms: "0.00",
    },
    items: [["AL-040", "Refeição completa", "UN", 40, 31.5, 1260]],
    questions: [
      {
        code: "WORK_HEADCOUNT",
        position: 1,
        prompt: "Quantos funcionários estavam trabalhando na obra na data da compra?",
        type: "NUMBER",
        options: [],
        rationale: "A quantidade de refeições precisa ser comparada com a equipe presente.",
      },
      {
        code: "MEAL_FOR_TEAM",
        position: 2,
        prompt: "As refeições foram destinadas à equipe da obra selecionada?",
        type: "BOOLEAN",
        options: ["Sim", "Não"],
        rationale: "A IA não conseguiu confirmar o destinatário apenas pelo documento.",
      },
    ],
  },
  {
    key: "read-failed-001",
    offsetDays: 4,
    status: "READ_FAILED",
    stage: "FAILED",
    classification: "INCOMPATIBLE",
    auditResult: "READ_FAILED",
    documentNumber: null,
    fileName: "DEMO_DOCUMENTO_ILEGIVEL.pdf",
    supplier: "Fornecedor não identificado",
    taxId: null,
    amount: null,
    workIndex: 1,
    confidence: 0.18,
    failureCode: "READ_FAILED",
    failureMessage: "Não foi possível obter dados mínimos confiáveis do documento de demonstração.",
    extraction: { warnings: ["Imagem com baixa resolução", "Campos essenciais não identificados"] },
    items: [],
  },
  {
    key: "processing-001",
    offsetDays: 5,
    status: "PROCESSING",
    stage: "EXTRACTING",
    classification: null,
    auditResult: null,
    documentNumber: "DEMO-ANALISE-001",
    fileName: "DEMO_NOTA_EM_ANALISE.pdf",
    supplier: "Materiais Horizonte",
    taxId: "56.789.012/0001-34",
    amount: 7500,
    workIndex: 2,
    confidence: null,
    extraction: null,
    items: [],
  },
  {
    key: "failed-001",
    offsetDays: 6,
    status: "FAILED",
    stage: "FAILED",
    classification: null,
    auditResult: null,
    documentNumber: "DEMO-FALHA-001",
    fileName: "DEMO_FALHA_TECNICA.pdf",
    supplier: "Serviços Gerais Ltda.",
    taxId: "67.890.123/0001-45",
    amount: 980,
    workIndex: 0,
    confidence: null,
    failureCode: "AI_TIMEOUT",
    failureMessage: "A análise de demonstração excedeu o tempo de processamento.",
    extraction: { warnings: ["Tempo limite simulado para apresentação"] },
    items: [],
  },
  {
    key: "ok-002",
    offsetDays: 8,
    status: "OK",
    stage: "COMPLETED",
    classification: "OK",
    auditResult: "OK",
    documentNumber: "DEMO-OK-002",
    fileName: "DEMO_NF_Hospedagem_Central.pdf",
    supplier: "Hospedagem Central",
    taxId: "78.901.234/0001-56",
    amount: 2190,
    workIndex: 2,
    confidence: 0.96,
    extraction: {
      serie: "001",
      tipoOperacao: "Serviço de hospedagem",
      naturezaOperacao: "Hospedagem de equipe",
      inscricaoEstadual: "Não aplicável",
      valorProdutos: "2190.00",
      baseCalculoIcms: "0.00",
      valorIcms: "0.00",
    },
    items: [["HOT-010", "Diárias de hospedagem", "UN", 10, 219, 2190]],
  },
];

async function ensureWorks() {
  const result = [];
  for (const fixture of workFixtures) {
    await client.query(
      `INSERT INTO works (code, name, location, responsible_name, active, updated_at)
       VALUES ($1, $2, $3, $4, true, CURRENT_TIMESTAMP)
       ON CONFLICT (code) DO UPDATE SET
         responsible_name = EXCLUDED.responsible_name,
         updated_at = CURRENT_TIMESTAMP`,
      [fixture.code, fixture.name, fixture.location, fixture.responsibleName],
    );
    const row = await client.query(
      `SELECT id, name, location FROM works WHERE code = $1`,
      [fixture.code],
    );
    if (!row.rows[0]) throw new Error(`Work fixture ${fixture.code} was not found.`);
    result.push(row.rows[0]);
  }
  return result;
}

async function getProfiles() {
  const result = await client.query(
    `SELECT id, email, full_name, role
       FROM profiles
      WHERE active = true
      ORDER BY role, email`,
  );
  const admin = result.rows.find((profile) => profile.role === "ADMIN");
  const reviewer = result.rows.find((profile) => profile.role === "REVIEWER");
  if (!admin || !reviewer) {
    throw new Error("An active ADMIN and REVIEWER profile are required to seed demo data.");
  }
  return { admin, reviewer };
}

async function upsertNote(fixture, work, dateOnly) {
  const createdAt = timestamp(dateOnly, 9, 15);
  const processedAt = fixture.stage === "COMPLETED" ? addMinutes(createdAt, 2) : null;
  const protocol = `${DEMO_PREFIX}2026-${fixture.key.toUpperCase()}`;
  const tokenHash = sha256(`demo-capability:${protocol}`);
  const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
  const result = await client.query(
    `INSERT INTO notes (
       work_id, submitted_by_id, public_protocol, public_token_hash, public_token_expires_at,
       original_file_path, original_file_name, original_mime_type, original_size_bytes,
       extracted_data, extraction_markdown, document_number, supplier_name, supplier_tax_id,
       issued_at, total_amount, status, processing_stage, classification, audit_result,
       read_confidence, failure_code, failure_message, version, context_round,
       context_submitted_at, context_summary, received_at, processed_at, created_at, updated_at
     ) VALUES (
       $1, NULL, $2, $3, $4,
       $5, $6, 'application/pdf', $7,
       $8, $9, $10, $11, $12,
       $13, $14, $15::"NoteStatus", $16::"ProcessingStage", $17::"NoteClassification", $18::"AuditResult",
       $19, $20, $21, 1, $22,
       NULL, $23, $24, $25, $26, $26
     )
     ON CONFLICT (public_protocol) DO UPDATE SET
       work_id = EXCLUDED.work_id,
       public_token_hash = EXCLUDED.public_token_hash,
       public_token_expires_at = EXCLUDED.public_token_expires_at,
       original_file_path = EXCLUDED.original_file_path,
       original_file_name = EXCLUDED.original_file_name,
       extracted_data = EXCLUDED.extracted_data,
       extraction_markdown = EXCLUDED.extraction_markdown,
       document_number = EXCLUDED.document_number,
       supplier_name = EXCLUDED.supplier_name,
       supplier_tax_id = EXCLUDED.supplier_tax_id,
       issued_at = EXCLUDED.issued_at,
       total_amount = EXCLUDED.total_amount,
       status = EXCLUDED.status,
       processing_stage = EXCLUDED.processing_stage,
       classification = EXCLUDED.classification,
       audit_result = EXCLUDED.audit_result,
       read_confidence = EXCLUDED.read_confidence,
       failure_code = EXCLUDED.failure_code,
       failure_message = EXCLUDED.failure_message,
       version = EXCLUDED.version,
       context_round = EXCLUDED.context_round,
       context_submitted_at = EXCLUDED.context_submitted_at,
       context_summary = EXCLUDED.context_summary,
       received_at = EXCLUDED.received_at,
       processed_at = EXCLUDED.processed_at,
       updated_at = EXCLUDED.updated_at
     RETURNING id`,
    [
      work.id,
      protocol,
      tokenHash,
      expiresAt,
      `demo/${protocol}.pdf`,
      fixture.fileName,
      Math.max(1024, Math.round((fixture.amount ?? 1800) * 17)),
      fixture.extraction,
      fixture.extraction
        ? `Demonstração WinfraBR: extração estruturada concluída para ${fixture.fileName}.`
        : null,
      fixture.documentNumber,
      fixture.supplier,
      fixture.taxId,
      new Date(`${dateOnly}T00:00:00Z`),
      money(fixture.amount),
      fixture.status,
      fixture.stage,
      fixture.classification,
      fixture.auditResult,
      fixture.confidence,
      fixture.failureCode ?? null,
      fixture.failureMessage ?? null,
      fixture.auditResult === "NEEDS_CONTEXT" ? 1 : 0,
      fixture.contextSummary ?? null,
      new Date(`${dateOnly}T08:45:00-03:00`),
      processedAt,
      createdAt,
    ],
  );
  return { id: result.rows[0].id, protocol, createdAt, processedAt };
}

async function clearDemoChildren(noteId) {
  await client.query(`DELETE FROM notifications WHERE note_id = $1`, [noteId]);
  await client.query(`DELETE FROM validations WHERE note_id = $1`, [noteId]);
  await client.query(`DELETE FROM note_context_submissions WHERE note_id = $1`, [noteId]);
  await client.query(`DELETE FROM note_context_questions WHERE note_id = $1`, [noteId]);
  await client.query(`DELETE FROM processing_jobs WHERE note_id = $1`, [noteId]);
  await client.query(`DELETE FROM findings WHERE note_id = $1`, [noteId]);
  await client.query(`DELETE FROM ai_runs WHERE note_id = $1`, [noteId]);
  await client.query(`DELETE FROM note_events WHERE note_id = $1`, [noteId]);
  await client.query(`DELETE FROM note_items WHERE note_id = $1`, [noteId]);
  await client.query(
    `DELETE FROM admin_audit_logs
      WHERE entity_id = $1 AND data->>'demoSeed' = $2`,
    [noteId, DEMO_SEED],
  );
  if (resetReads) await client.query(`DELETE FROM note_reads WHERE note_id = $1`, [noteId]);
}

async function insertAiRun({ noteId, protocol, kind, status, createdAt, structuredResponse, errorCode }) {
  const startedAt = addMinutes(createdAt, kind === "EXTRACTION" ? 1 : 2);
  const completedAt = status === "SUCCEEDED" ? addMinutes(startedAt, kind === "EXTRACTION" ? 1 : 2) : null;
  const result = await client.query(
    `INSERT INTO ai_runs (
       note_id, kind, status, idempotency_key, request_fingerprint, policy_version,
       prompt_version, schema_version, model, provider, reasoning_effort, attempts,
       prompt_tokens, completion_tokens, total_tokens, cost_usd, latency_ms,
       structured_response, error_code, error_message, started_at, completed_at, created_at
     ) VALUES (
       $1, $2::"AiRunKind", $3::"AiRunStatus", $4, $5, 'demo-policy-v1',
       'demo-prompt-v1', 'demo-schema-v1', 'openai/gpt-5.6-terra', 'openrouter', 'MAX'::"ReasoningEffort", 1,
       $6, $7, $8, 0, $9, $10, $11, $12, $13, $14, $13
     ) RETURNING id`,
    [
      noteId,
      kind,
      status,
      `${protocol}:${kind}:v1`,
      sha256(`${protocol}:${kind}:v1`),
      status === "SUCCEEDED" ? (kind === "EXTRACTION" ? 820 : 1240) : null,
      status === "SUCCEEDED" ? (kind === "EXTRACTION" ? 410 : 690) : null,
      status === "SUCCEEDED" ? (kind === "EXTRACTION" ? 1230 : 1930) : null,
      status === "SUCCEEDED" ? (kind === "EXTRACTION" ? 1450 : 2480) : null,
      structuredResponse,
      errorCode ?? null,
      errorCode ? `Demonstração: ${errorCode}` : null,
      startedAt,
      completedAt,
    ],
  );
  return result.rows[0].id;
}

async function insertItems(noteId, items) {
  const ids = [];
  for (let index = 0; index < items.length; index += 1) {
    const [code, description, unit, quantity, unitPrice, totalAmount] = items[index];
    const result = await client.query(
      `INSERT INTO note_items (note_id, line_number, code, description, quantity, unit, unit_price, total_amount, raw_data)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        noteId,
        index + 1,
        code,
        description,
        quantity,
        unit,
        money(unitPrice),
        money(totalAmount),
        { ncm: "00000000", origem: "fixture de demonstração" },
      ],
    );
    ids.push(result.rows[0].id);
  }
  return ids;
}

async function insertFindings(noteId, aiRunId, fixture, itemIds) {
  const findings = [];
  for (const definition of fixture.findings ?? []) {
    const result = await client.query(
      `INSERT INTO findings (
         note_id, note_item_id, code, title, description, category, severity, status,
         needs_validation, source, confidence, justification, "references", rule_version,
         is_novel, policy_version, ai_run_id, evidence, expected_value, actual_value, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7::"FindingSeverity", 'OPEN'::"FindingStatus",
         true, $8::"FindingSource", $9, $10, $11, 'demo-v1', $12, 'demo-policy-v1', $13, $14, $15, $16, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       RETURNING id`,
      [
        noteId,
        definition.noteItem === null || definition.noteItem === undefined
          ? null
          : itemIds[definition.noteItem] ?? null,
        definition.code,
        definition.title,
        definition.description,
        definition.category,
        definition.severity,
        definition.source,
        definition.confidence,
        definition.justification,
        { demoSeed: DEMO_SEED, source: "fixture" },
        definition.isNovel ?? false,
        aiRunId,
        definition.evidence,
        definition.expectedValue,
        definition.actualValue,
      ],
    );
    findings.push(result.rows[0].id);
  }
  return findings;
}

async function insertQuestions(noteId, auditRunId, fixture) {
  for (const question of fixture.questions ?? []) {
    await client.query(
      `INSERT INTO note_context_questions (
         note_id, ai_run_id, round, position, code, prompt, type, options, required, rationale
       ) VALUES ($1, $2, 1, $3, $4, $5, $6::"ContextQuestionType", $7, true, $8)`,
      [
        noteId,
        auditRunId,
        question.position,
        question.code,
        question.prompt,
        question.type,
        JSON.stringify(question.options),
        question.rationale,
      ],
    );
  }
}

async function insertValidation(noteId, findingId, aiRunId, fixture, reviewer, createdAt) {
  if (!fixture.validation) return;
  await client.query(
    `INSERT INTO validations (
       note_id, finding_id, validator_id, decision, reason, comment, note_version,
       policy_version, finding_snapshot, ai_run_id, created_at
     ) VALUES ($1, $2, $3, $4::"ValidationDecision", $5, $6, 1, 'demo-policy-v1', $7, $8, $9)`,
    [
      noteId,
      findingId ?? null,
      reviewer.id,
      fixture.validation.decision,
      fixture.validation.reason,
      fixture.validation.comment,
      findingId ? { demoSeed: DEMO_SEED, decision: fixture.validation.decision } : null,
      aiRunId,
      addMinutes(createdAt, 8),
    ],
  );
}

async function insertEvents(noteId, fixture, admin, createdAt) {
  const events = [
    ["UPLOAD_RECEIVED", null, "RECEIVED", "O anexo foi recebido para demonstração."],
    ["EXTRACTION_STARTED", "RECEIVED", "PROCESSING", "O Harness iniciou a leitura estruturada."],
  ];
  if (fixture.stage === "COMPLETED") {
    events.push(["EXTRACTION_COMPLETED", "PROCESSING", "PROCESSING", "Os campos e itens foram extraídos."], ["ANALYSIS_COMPLETED", "PROCESSING", fixture.status, "O diagnóstico da IA foi registrado."]);
  } else if (fixture.auditResult === "READ_FAILED") {
    events.push(["EXTRACTION_FAILED", "PROCESSING", "READ_FAILED", fixture.failureMessage ?? "Falha de leitura simulada."]);
  } else if (fixture.status === "FAILED") {
    events.push(["AUDIT_FAILED", "PROCESSING", "FAILED", fixture.failureMessage ?? "Falha técnica simulada."]);
  }
  for (let index = 0; index < events.length; index += 1) {
    const [type, fromStatus, toStatus, message] = events[index];
    await client.query(
      `INSERT INTO note_events (note_id, actor_id, type, from_status, to_status, data, created_at)
       VALUES ($1, $2, $3, $4::"NoteStatus", $5::"NoteStatus", $6, $7)`,
      [
        noteId,
        index === 0 ? null : admin.id,
        type,
        fromStatus,
        toStatus,
        { demoSeed: DEMO_SEED, message },
        addMinutes(createdAt, index),
      ],
    );
  }
}

async function insertNotifications(noteId, findingId, fixture, profiles, dateOnly) {
  let type = "NOTE_PROCESSED";
  let title = "Anexo processado";
  let body = "Um anexo de demonstração foi processado e está disponível para consulta.";
  if (fixture.auditResult === "SUSPICIOUS") {
    type = "VALIDATION_REQUIRED";
    title = "Anexo com suspeita";
    body = "A IA encontrou um ou mais pontos para acompanhamento no anexo de demonstração.";
  } else if (fixture.auditResult === "READ_FAILED" || fixture.status === "FAILED") {
    type = "PROCESSING_FAILED";
    title = "Falha no processamento";
    body = "O anexo de demonstração precisa ser revisado ou reprocessado.";
  } else if (fixture.auditResult === "NEEDS_CONTEXT") {
    title = "Informação necessária";
    body = "O anexo de demonstração precisa de contexto para concluir a análise.";
  }
  for (const profile of [profiles.reviewer, profiles.admin]) {
    await client.query(
      `INSERT INTO notifications (recipient_id, note_id, finding_id, type, title, body, data, created_at)
       VALUES ($1, $2, $3, $4::"NotificationType", $5, $6, $7, $8)`,
      [
        profile.id,
        noteId,
        findingId ?? null,
        type,
        title,
        body,
        { demoSeed: DEMO_SEED, fixture: fixture.key, status: fixture.auditResult ?? fixture.status },
        timestamp(dateOnly, 16, 30),
      ],
    );
  }
}

async function insertAdminLog(noteId, fixture, admin, dateOnly) {
  await client.query(
    `INSERT INTO admin_audit_logs (actor_id, actor_email, action, entity_type, entity_id, data, created_at)
     VALUES ($1, $2, $3, 'note', $4, $5, $6)`,
    [
      admin.id,
      admin.email,
      "DEMO_SEED_NOTE",
      noteId,
      {
        demoSeed: DEMO_SEED,
        fixture: fixture.key,
        summary: `Fixture de demonstração ${fixture.fileName} preparada para apresentação.`,
        result: fixture.auditResult ?? fixture.status,
        model: "openai/gpt-5.6-terra",
        reasoningEffort: "MAX",
        costUsd: "0.00000000",
      },
      timestamp(dateOnly, 16, 35),
    ],
  );
}

async function seedFixture(fixture, works, profiles) {
  const dateOnly = dateOnlyFromOffset(fixture.offsetDays);
  const note = await upsertNote(fixture, works[fixture.workIndex], dateOnly);
  await clearDemoChildren(note.id);
  const itemIds = await insertItems(note.id, fixture.items ?? []);

  if (fixture.extraction) {
    await insertAiRun({
      noteId: note.id,
      protocol: note.protocol,
      kind: "EXTRACTION",
      status: fixture.auditResult === "READ_FAILED" ? "FAILED" : "SUCCEEDED",
      createdAt: note.createdAt,
      structuredResponse: fixture.extraction,
      errorCode: fixture.auditResult === "READ_FAILED" ? "READ_FAILED" : null,
    });
  }

  let auditRunId = null;
  if (fixture.auditResult && fixture.auditResult !== "READ_FAILED") {
    auditRunId = await insertAiRun({
      noteId: note.id,
      protocol: note.protocol,
      kind: "AUDIT",
      status: "SUCCEEDED",
      createdAt: note.createdAt,
      structuredResponse: {
        auditResult: fixture.auditResult,
        classification: fixture.classification,
        findings: (fixture.findings ?? []).map((finding) => ({
          code: finding.code,
          title: finding.title,
          confidence: finding.confidence,
        })),
      },
      errorCode: null,
    });
  }
  if (fixture.status === "PROCESSING" && !fixture.auditResult) {
    await insertAiRun({
      noteId: note.id,
      protocol: note.protocol,
      kind: "EXTRACTION",
      status: "RUNNING",
      createdAt: note.createdAt,
      structuredResponse: null,
      errorCode: null,
    });
  }
  if (fixture.status === "FAILED") {
    auditRunId = await insertAiRun({
      noteId: note.id,
      protocol: note.protocol,
      kind: "AUDIT",
      status: "FAILED",
      createdAt: note.createdAt,
      structuredResponse: null,
      errorCode: fixture.failureCode ?? "PROCESSING_FAILED",
    });
  }

  const findingIds = await insertFindings(note.id, auditRunId, fixture, itemIds);
  await insertQuestions(note.id, auditRunId, fixture);
  await insertValidation(note.id, findingIds[0] ?? null, auditRunId, fixture, profiles.reviewer, note.createdAt);
  await insertEvents(note.id, fixture, profiles.admin, note.createdAt);
  await insertNotifications(note.id, findingIds[0] ?? null, fixture, profiles, dateOnly);
  await insertAdminLog(note.id, fixture, profiles.admin, dateOnly);
  return { protocol: note.protocol, status: fixture.auditResult ?? fixture.status, findingCount: findingIds.length };
}

try {
  await client.connect();
  await client.query("BEGIN");
  const [works, profiles] = await Promise.all([ensureWorks(), getProfiles()]);
  const seeded = [];
  for (const fixture of fixtureDefinitions) {
    seeded.push(await seedFixture(fixture, works, profiles));
  }
  await client.query("COMMIT");
  console.log(`Demo seed complete: ${seeded.length} attachments, ${seeded.filter((item) => item.findingCount > 0).length} with findings.`);
  console.log(`Demo protocols: ${seeded.map((item) => item.protocol).join(", ")}`);
  if (resetReads) console.log("Existing demo read marks were reset.");
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  await client.end();
}
