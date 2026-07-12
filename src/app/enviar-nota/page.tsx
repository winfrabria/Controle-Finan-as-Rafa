import type { Metadata } from "next";

import { PublicUploadFlow } from "@/features/public-upload/public-upload-flow";

export const metadata: Metadata = {
  title: "Enviar nota | WinfraBR",
  description: "Envie uma nota fiscal para auditoria de forma rápida e segura.",
};

export default function EnviarNotaPage() {
  return <PublicUploadFlow />;
}
