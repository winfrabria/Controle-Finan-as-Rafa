"use client";

import { useState } from "react";

import { Icon } from "./ui-icons";
import styles from "./workspace-ui.module.css";

type DashboardFiltersProps = {
  role: "admin" | "reviewer";
};

const initialFilters = {
  work: "",
  startDate: "2024-05-01",
  endDate: "2024-05-31",
  reviewer: "",
};

export function DashboardFilters({ role }: DashboardFiltersProps) {
  const [filters, setFilters] = useState(initialFilters);

  function update(name: keyof typeof filters, value: string) {
    setFilters((current) => ({ ...current, [name]: value }));
  }

  function reset() {
    setFilters({ ...initialFilters, work: "", reviewer: "" });
  }

  return (
    <form
      className={`${styles.filterBar} ${styles.dashboardFilterBar}`}
      data-role={role}
      onSubmit={(event) => event.preventDefault()}
    >
      <label>
        Obra
        <select
          value={filters.work}
          onChange={(event) => update("work", event.target.value)}
        >
          <option value="">Todas as obras</option>
          <option value="piloto">Projeto Piloto HWN – Alphaville</option>
          <option value="aurora">Edifício Aurora</option>
          <option value="hospital">Hospital Central</option>
        </select>
      </label>
      <fieldset className={styles.periodFieldset}>
        <legend>Período</legend>
        <div>
          <Icon name="calendar" />
          <input
            aria-label="Data inicial"
            type="date"
            value={filters.startDate}
            onChange={(event) => update("startDate", event.target.value)}
          />
          <span>até</span>
          <input
            aria-label="Data final"
            type="date"
            value={filters.endDate}
            onChange={(event) => update("endDate", event.target.value)}
          />
        </div>
      </fieldset>
      {role === "admin" ? (
        <label>
          Responsável pela validação
          <select
            value={filters.reviewer}
            onChange={(event) => update("reviewer", event.target.value)}
          >
            <option value="">Todos os responsáveis</option>
            <option value="rafael">Rafael</option>
          </select>
        </label>
      ) : null}
      <button type="button" onClick={reset}>
        <Icon name="filter" /> Limpar filtros
      </button>
    </form>
  );
}
