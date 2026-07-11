import "dotenv/config";

import pg from "pg";

const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DIRECT_URL or DATABASE_URL is required to seed works.");
}

// Temporary fixtures for the MVP demonstration. Keep the stable codes and
// replace only name/location when the real works are provided.
const fixtures = [
  {
    code: "MVP-OBRA-01",
    name: "[DEMO] Obra 01",
    location: "Local a confirmar",
  },
  {
    code: "MVP-OBRA-02",
    name: "[DEMO] Obra 02",
    location: "Local a confirmar",
  },
  {
    code: "MVP-OBRA-03",
    name: "[DEMO] Obra 03",
    location: "Local a confirmar",
  },
];

const client = new pg.Client({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

try {
  await client.connect();
  await client.query("BEGIN");

  for (const fixture of fixtures) {
    await client.query(
      `INSERT INTO works (code, name, location, active, updated_at)
       VALUES ($1, $2, $3, true, CURRENT_TIMESTAMP)
       ON CONFLICT (code) DO NOTHING`,
      [fixture.code, fixture.name, fixture.location],
    );
  }

  await client.query("COMMIT");
  console.log(`Seed complete: ${fixtures.length} work fixtures available.`);
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}
