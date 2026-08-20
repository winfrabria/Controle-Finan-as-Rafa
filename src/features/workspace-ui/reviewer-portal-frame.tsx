"use client";

import { usePathname, useRouter } from "next/navigation";
import { PrefetchKind } from "next/dist/client/components/router-reducer/router-reducer-types";
import { type ReactNode, useEffect } from "react";

import { PortalShell, type PortalSection } from "./portal-shell";

function activeSection(pathname: string): PortalSection {
  if (pathname.startsWith("/revisao/historico")) return "historico";
  if (pathname.startsWith("/revisao/notas")) return "notas";
  return "dashboard";
}

export function ReviewerPortalFrame({
  children,
  userEmail,
}: {
  children: ReactNode;
  userEmail: string;
}) {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    const routes = ["/revisao", "/revisao/notas", "/revisao/historico"].filter(
      (route) => route !== pathname,
    );
    const timers: number[] = [];
    const warmup = window.setTimeout(() => {
      routes.forEach((route, index) => {
        timers.push(
          window.setTimeout(
            () => router.prefetch(route, { kind: PrefetchKind.FULL }),
            index * 160,
          ),
        );
      });
    }, 120);

    return () => {
      window.clearTimeout(warmup);
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [pathname, router]);

  return (
    <PortalShell
      active={activeSection(pathname)}
      role="reviewer"
      userEmail={userEmail}
    >
      {children}
    </PortalShell>
  );
}
