"use client";

import { ListError } from "@/features/internal-notes/list-error";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return <ListError reset={reset} />;
}
