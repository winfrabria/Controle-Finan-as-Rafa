import pg from "pg";

const { Client } = pg;

const EXPECTED_PROJECT_REF = "uvxpmcwwflvrathttxcy";
const BACKUP_SCHEMA = "notes_reset_backup_20260920_01";
const LOCK_NAME = "winfrabr:notes-reset:20260920:01";
const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("Notes maintenance requires DIRECT_URL or DATABASE_URL.");
}

if (!connectionString.includes(EXPECTED_PROJECT_REF)) {
  throw new Error("Notes maintenance refused an unexpected database target.");
}

const client = new Client({
  application_name: "winfrabr-notes-reset-20260920",
  connectionString,
});

const backup = async (table, predicate) => {
  await client.query(
    `CREATE TABLE "${BACKUP_SCHEMA}"."${table}" AS
       SELECT source.* FROM public."${table}" source WHERE ${predicate}`,
  );
};

const count = async (sql) => Number((await client.query(sql)).rows[0].count);

try {
  await client.connect();
  await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
  await client.query("SET LOCAL lock_timeout = '15s'");
  await client.query("SET LOCAL statement_timeout = '180s'");
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [LOCK_NAME]);

  const completed = await client.query(
    `SELECT EXISTS (
       SELECT 1
       FROM information_schema.tables
       WHERE table_schema = $1 AND table_name = 'manifest'
     ) AS exists`,
    [BACKUP_SCHEMA],
  );

  if (completed.rows[0].exists) {
    const manifest = await client.query(
      `SELECT note_count, completed_at FROM "${BACKUP_SCHEMA}".manifest LIMIT 1`,
    );
    if (manifest.rows[0]?.completed_at) {
      await client.query("COMMIT");
      console.log(
        "NOTES_RESET_ALREADY_COMPLETE",
        JSON.stringify({ backupSchema: BACKUP_SCHEMA, noteCount: manifest.rows[0].note_count }),
      );
      process.exit(0);
    }
    throw new Error("Notes maintenance found an incomplete backup manifest.");
  }

  const preservedBefore = (
    await client.query(`SELECT
      (SELECT count(*)::int FROM public.profiles) AS profiles,
      (SELECT count(*)::int FROM public.works) AS works,
      (SELECT count(*)::int FROM public.audit_rules) AS audit_rules,
      (SELECT count(*)::int FROM public.audit_parameters) AS audit_parameters`)
  ).rows[0];

  await client.query(`CREATE SCHEMA "${BACKUP_SCHEMA}"`);
  await client.query(`REVOKE ALL ON SCHEMA "${BACKUP_SCHEMA}" FROM PUBLIC`);
  await client.query(`CREATE TABLE "${BACKUP_SCHEMA}".manifest (
    backup_id text PRIMARY KEY,
    created_at timestamptz NOT NULL DEFAULT now(),
    cutoff timestamptz NOT NULL,
    note_count integer NOT NULL,
    completed_at timestamptz,
    reason text NOT NULL
  )`);
  await client.query(
    `CREATE TABLE "${BACKUP_SCHEMA}".target_note_ids AS SELECT id FROM public.notes`,
  );

  const targetCount = await count(
    `SELECT count(*)::int AS count FROM "${BACKUP_SCHEMA}".target_note_ids`,
  );
  const active = (
    await client.query(`SELECT
      (SELECT count(*)::int FROM public.processing_jobs j
        JOIN "${BACKUP_SCHEMA}".target_note_ids t ON t.id = j.note_id
        WHERE j.status = 'RUNNING') AS processing_jobs,
      (SELECT count(*)::int FROM public.ai_runs r
        JOIN "${BACKUP_SCHEMA}".target_note_ids t ON t.id = r.note_id
        WHERE r.status = 'RUNNING') AS ai_runs`)
  ).rows[0];
  if (active.processing_jobs > 0 || active.ai_runs > 0) {
    throw new Error("Notes maintenance refused to delete notes with active processing.");
  }

  await client.query(
    `INSERT INTO "${BACKUP_SCHEMA}".manifest
       (backup_id, cutoff, note_count, reason)
     VALUES ($1, transaction_timestamp(), $2, $3)`,
    [BACKUP_SCHEMA, targetCount, "User-requested clean production test baseline"],
  );

  await backup("notes", `source.id IN (SELECT id FROM "${BACKUP_SCHEMA}".target_note_ids)`);
  await backup("note_items", `source.note_id IN (SELECT id FROM "${BACKUP_SCHEMA}".target_note_ids)`);
  await backup("findings", `source.note_id IN (SELECT id FROM "${BACKUP_SCHEMA}".target_note_ids)`);
  await backup("validations", `source.note_id IN (SELECT id FROM "${BACKUP_SCHEMA}".target_note_ids)`);
  await backup("processing_jobs", `source.note_id IN (SELECT id FROM "${BACKUP_SCHEMA}".target_note_ids)`);
  await backup("note_context_questions", `source.note_id IN (SELECT id FROM "${BACKUP_SCHEMA}".target_note_ids)`);
  await backup("note_context_submissions", `source.note_id IN (SELECT id FROM "${BACKUP_SCHEMA}".target_note_ids)`);
  await backup("note_context_answers", `source.submission_id IN (SELECT id FROM "${BACKUP_SCHEMA}".note_context_submissions)`);
  await backup("ai_runs", `source.note_id IN (SELECT id FROM "${BACKUP_SCHEMA}".target_note_ids)`);
  await backup("audit_feedbacks", `source.note_id IN (SELECT id FROM "${BACKUP_SCHEMA}".target_note_ids)`);
  await backup("note_events", `source.note_id IN (SELECT id FROM "${BACKUP_SCHEMA}".target_note_ids)`);
  await backup("notifications", `source.note_id IN (SELECT id FROM "${BACKUP_SCHEMA}".target_note_ids)
    OR source.finding_id IN (SELECT id FROM "${BACKUP_SCHEMA}".findings)`);
  await backup("note_reads", `source.note_id IN (SELECT id FROM "${BACKUP_SCHEMA}".target_note_ids)`);
  await backup("push_deliveries", `source.notification_id IN (SELECT id FROM "${BACKUP_SCHEMA}".notifications)`);
  await client.query(`REVOKE ALL ON ALL TABLES IN SCHEMA "${BACKUP_SCHEMA}" FROM PUBLIC`);

  const backedUpNotes = await count(
    `SELECT count(*)::int AS count FROM "${BACKUP_SCHEMA}".notes`,
  );
  if (backedUpNotes !== targetCount) {
    throw new Error("Notes maintenance backup count did not match its target count.");
  }

  const deleted = await client.query(
    `DELETE FROM public.notes n
      USING "${BACKUP_SCHEMA}".target_note_ids t
      WHERE n.id = t.id
      RETURNING n.id`,
  );
  if (deleted.rowCount !== targetCount) {
    throw new Error("Notes maintenance deletion count did not match its target count.");
  }

  const remainingTargets = await count(
    `SELECT count(*)::int AS count
       FROM public.notes n
       JOIN "${BACKUP_SCHEMA}".target_note_ids t ON t.id = n.id`,
  );
  if (remainingTargets !== 0) {
    throw new Error("Notes maintenance verification found undeleted targets.");
  }

  const preservedAfter = (
    await client.query(`SELECT
      (SELECT count(*)::int FROM public.profiles) AS profiles,
      (SELECT count(*)::int FROM public.works) AS works,
      (SELECT count(*)::int FROM public.audit_rules) AS audit_rules,
      (SELECT count(*)::int FROM public.audit_parameters) AS audit_parameters`)
  ).rows[0];
  if (JSON.stringify(preservedAfter) !== JSON.stringify(preservedBefore)) {
    throw new Error("Notes maintenance detected an unexpected preserved-data change.");
  }

  await client.query(
    `UPDATE "${BACKUP_SCHEMA}".manifest SET completed_at = now() WHERE backup_id = $1`,
    [BACKUP_SCHEMA],
  );
  await client.query("COMMIT");

  const current = (
    await client.query(`SELECT
      (SELECT count(*)::int FROM public.notes) AS notes,
      (SELECT count(*)::int FROM public.findings) AS findings,
      (SELECT count(*)::int FROM public.processing_jobs) AS processing_jobs,
      (SELECT count(*)::int FROM public.note_reads) AS note_reads`)
  ).rows[0];
  console.log(
    "NOTES_RESET_COMPLETE",
    JSON.stringify({ backupSchema: BACKUP_SCHEMA, deletedNotes: targetCount, current, preserved: preservedAfter }),
  );
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  const code = typeof error === "object" && error && "code" in error ? String(error.code) : "UNKNOWN";
  console.error("NOTES_RESET_FAILED", code, error instanceof Error ? error.message : "Unknown error");
  process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}
