"use client";

import { useState } from "react";

import { Icon } from "./ui-icons";

type ReportRole = "admin" | "reviewer";

export function ReportExportButton({ role }: { role: ReportRole }) {
  const [exported, setExported] = useState(false);

  function markExported() {
    setExported(true);
    window.setTimeout(() => setExported(false), 2500);
  }

  return (
    <a
      download={`relatorio-${role}.csv`}
      href={`/api/reports/dashboard?role=${role}`}
      onClick={markExported}
      aria-live="polite"
    >
      <Icon name={exported ? "check" : "download"} />
      {exported ? "Relatório exportado" : "Exportar relatório"}
    </a>
  );
}
