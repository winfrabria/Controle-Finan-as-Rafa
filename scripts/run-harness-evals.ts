import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  formatReadableSummary,
  goldenCasesFileSchema,
  runGoldenCases,
} from "../src/lib/audit-harness/evals";

function parseArgs(argv: string[]) {
  const args: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    if (flag !== "--cases" && flag !== "--out") {
      printUsageAndExit();
    }
    args[flag.slice(2)] = argv[index + 1];
  }
  return args;
}

function printUsageAndExit(): never {
  console.error(
    "Uso: tsx scripts/run-harness-evals.ts [--cases <caminho>] [--out <relatorio.json>]",
  );
  process.exit(2);
}

const args = parseArgs(process.argv.slice(2));
const casesPath =
  args.cases ?? "src/lib/audit-harness/evals/__fixtures__/golden-cases.v1.json";

let raw: unknown;
try {
  raw = JSON.parse(readFileSync(path.resolve(casesPath), "utf8"));
} catch (error) {
  console.error(`Não foi possível ler os casos dourados em ${casesPath}.`, error);
  process.exit(2);
}

const parsed = goldenCasesFileSchema.safeParse(raw);
if (!parsed.success) {
  console.error("Casos dourados fora do contrato versionado:", parsed.error.message);
  process.exit(2);
}

// Modo offline determinístico: nenhum provedor é chamado e nenhum segredo é lido.
const report = runGoldenCases(parsed.data.cases);
console.log(formatReadableSummary(report));

if (args.out) {
  const outputPath = path.resolve(args.out);
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`\nRelatório JSON gravado em ${outputPath}`);
}

process.exit(report.totals.failed > 0 ? 1 : 0);
