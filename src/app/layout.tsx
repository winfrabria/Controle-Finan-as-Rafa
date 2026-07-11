import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Auditoria de Gastos HWN",
  description: "MVP para envio e auditoria de notas fiscais.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
