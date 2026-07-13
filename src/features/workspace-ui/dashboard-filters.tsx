"use client";

import { useState } from "react";

import { Icon } from "./ui-icons";
import styles from "./workspace-ui.module.css";

type DashboardFiltersProps = {
  role: "admin" | "reviewer";
  works?: { id: string; name: string }[];
};

const initialFilters = {
  work: "",
  period: "maio",
};

export function DashboardFilters({ role, works = [] }: DashboardFiltersProps) {
  const [filters, setFilters] = useState(initialFilters);

  function update(name: keyof typeof filters, value: string) {
    setFilters((current) => ({ ...current, [name]: value }));
  }

  function reset() {
    setFilters(initialFilters);
  }

  return (
    <form
      className={`${styles.filterBar} ${styles.dashboardFilterBar}`}
      data-role={role}
      onSubmit={(event) => event.preventDefault()}
    >
      <label className={styles.filterLabel}>
        <span>Obra</span>
        <div className={styles.selectWrapper}>
          <Icon name="building" className={styles.leftIcon} />
          <select
            value={filters.work}
            onChange={(event) => update("work", event.target.value)}
            className={styles.hasLeftIcon}
          >
            <option value="">Todas as obras</option>
            {works.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
          <Icon name="chevron" className={styles.rightChevron} />
        </div>
      </label>

      <label className={styles.filterLabel}>
        <span>Período</span>
        <div className={styles.selectWrapper}>
          <Icon name="calendar" className={styles.leftIcon} />
          <select
            value={filters.period}
            onChange={(event) => update("period", event.target.value)}
            className={styles.hasLeftIcon}
          >
            <option value="maio">01/05/2024 - 31/05/2024</option>
            <option value="abril">01/04/2024 - 30/04/2024</option>
            <option value="março">01/03/2024 - 31/03/2024</option>
          </select>
          <Icon name="chevron" className={styles.rightChevron} />
        </div>
      </label>

      <div className={styles.filterAction}>
        <button type="button" onClick={reset} className={styles.btnOutlineBlue}>
          <Icon name="filter" /> Limpar filtros
        </button>
      </div>
    </form>
  );
}
