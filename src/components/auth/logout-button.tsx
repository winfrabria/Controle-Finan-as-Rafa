"use client";

import { FormEvent, useRef, useState } from "react";

import { unregisterCurrentPushDevice } from "@/lib/push/push-client";

export function LogoutButton({ className }: { className?: string }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [submitting, setSubmitting] = useState(false);

  async function signOut(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    await Promise.race([
      unregisterCurrentPushDevice(),
      new Promise((resolve) => window.setTimeout(resolve, 1_500)),
    ]).catch(() => undefined);
    formRef.current?.submit();
  }

  return (
    <form action="/auth/signout" method="post" onSubmit={signOut} ref={formRef}>
      <button className={className} disabled={submitting} type="submit">
        {submitting ? "Saindo…" : "Sair"}
      </button>
    </form>
  );
}
