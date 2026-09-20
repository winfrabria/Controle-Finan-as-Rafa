import "dotenv/config";

import pg from "pg";

const { Client } = pg;

const BACKUP_SCHEMA = "release_backup_20260920_3ce8da3";
const LOCK_NAME = "winfrabr:release-backup:20260920:3ce8da3";

const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("Release database snapshot requires DIRECT_URL or DATABASE_URL.");
}

const protocol = new URL(connectionString).protocol;
if (protocol !== "postgres:" && protocol !== "postgresql:") {
  throw new Error("Release database snapshot requires a PostgreSQL connection.");
}

const client = new Client({
  application_name: "winfrabr-release-backup-20260920",
  connectionString,
});

try {
  await client.connect();
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [LOCK_NAME]);
  await client.query(`CREATE SCHEMA IF NOT EXISTS "${BACKUP_SCHEMA}"`);
  await client.query(
    `CREATE TABLE IF NOT EXISTS "${BACKUP_SCHEMA}"."notes" AS TABLE public."notes"`,
  );
  await client.query(
    `CREATE TABLE IF NOT EXISTS "${BACKUP_SCHEMA}"."_prisma_migrations" AS TABLE public."_prisma_migrations"`,
  );

  const [{ rows: noteRows }, { rows: migrationRows }] = await Promise.all([
    client.query(`SELECT COUNT(*)::int AS count FROM "${BACKUP_SCHEMA}"."notes"`),
    client.query(
      `SELECT COUNT(*)::int AS count FROM "${BACKUP_SCHEMA}"."_prisma_migrations"`,
    ),
  ]);

  await client.query("COMMIT");
  console.log(
    `Release database snapshot ready (${noteRows[0].count} notes, ${migrationRows[0].count} migrations).`,
  );
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  const code =
    typeof error === "object" && error && "code" in error
      ? String(error.code)
      : "UNKNOWN";
  throw new Error(`Release database snapshot failed (${code}).`);
} finally {
  await client.end().catch(() => undefined);
}
