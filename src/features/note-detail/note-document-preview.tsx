"use client";

import Image from "next/image";
import { useState } from "react";

import type { NoteDetailItem } from "./data";
import { formatDecimal } from "./note-detail-format";
import styles from "./note-detail.module.css";

type NoteDocumentPreviewProps = {
  documentUrl: string | null;
  fileName: string;
  isImage: boolean;
  items: NoteDetailItem[];
  number: string;
  supplier: string;
  total: string;
};

export function NoteDocumentPreview({
  documentUrl,
  fileName,
  isImage,
  items,
  number,
  supplier,
  total,
}: NoteDocumentPreviewProps) {
  const [zoom, setZoom] = useState(100);

  return (
    <>
      <div className={styles.documentViewport}>
        <div
          className={styles.documentCanvas}
          style={{ transform: `scale(${zoom / 100})` }}
        >
          {documentUrl ? (
            isImage ? (
              <Image
                alt={`Nota fiscal ${number}`}
                fill
                sizes="(max-width: 760px) 100vw, 32vw"
                src={documentUrl}
                unoptimized
              />
            ) : (
              <iframe src={documentUrl} title={`Nota fiscal ${number}`} />
            )
          ) : (
            <DemoDanfe
              items={items}
              number={number}
              supplier={supplier}
              total={total}
            />
          )}
        </div>
      </div>
      <footer className={styles.documentToolbar}>
        <div className={styles.zoomControls} aria-label="Controle de zoom">
          <button
            type="button"
            aria-label="Diminuir zoom"
            onClick={() => setZoom((current) => Math.max(70, current - 10))}
          >
            −
          </button>
          <span>{zoom}%</span>
          <button
            type="button"
            aria-label="Aumentar zoom"
            onClick={() => setZoom((current) => Math.min(140, current + 10))}
          >
            +
          </button>
        </div>
        {documentUrl ? (
          <a href={documentUrl} target="_blank" rel="noreferrer">
            Baixar DANFE (PDF)
          </a>
        ) : (
          <span title={fileName}>{fileName}</span>
        )}
      </footer>
    </>
  );
}

function DemoDanfe({
  items,
  number,
  supplier,
  total,
}: {
  items: NoteDetailItem[];
  number: string;
  supplier: string;
  total: string;
}) {
  return (
    <article className={styles.demoDanfe} aria-label="DANFE de demonstração">
      <header>
        <div>
          <strong>{supplier.toUpperCase()}</strong>
          <small>Rua das Indústrias, 123 · São Paulo - SP</small>
          <small>CNPJ: 01.234.567/0001-99</small>
        </div>
        <div className={styles.danfeTitle}>
          <b>DANFE</b>
          <small>Documento Auxiliar da Nota Fiscal Eletrônica</small>
          <strong>Nº {number}</strong>
          <small>SÉRIE 001 · FOLHA 1/1</small>
        </div>
        <div>
          <small>CONTROLE DO FISCO</small>
          <span className={styles.barcode} />
          <small>CHAVE DE ACESSO</small>
        </div>
      </header>
      <dl className={styles.danfeIdentity}>
        <div>
          <dt>NATUREZA DA OPERAÇÃO</dt>
          <dd>VENDA DE MERCADORIA</dd>
        </div>
        <div>
          <dt>DESTINATÁRIO / REMETENTE</dt>
          <dd>HWN ENGENHARIA LTDA.</dd>
        </div>
        <div>
          <dt>DATA DA EMISSÃO</dt>
          <dd>02/06/2026</dd>
        </div>
      </dl>
      <section className={styles.taxGrid} aria-label="Cálculo do imposto">
        {[
          ["BASE DE CÁLCULO ICMS", "150.000,00"],
          ["VALOR DO ICMS", "27.000,00"],
          ["VALOR TOTAL DOS PRODUTOS", total],
          ["VALOR DO FRETE", "0,00"],
          ["DESCONTO", "0,00"],
          ["VALOR TOTAL DA NOTA", total],
        ].map(([label, value]) => (
          <div key={label}>
            <small>{label}</small>
            <b>{value}</b>
          </div>
        ))}
      </section>
      <table>
        <thead>
          <tr>
            <th>CÓDIGO</th>
            <th>DESCRIÇÃO DO PRODUTO / SERVIÇO</th>
            <th>UN</th>
            <th>QTD.</th>
            <th>VLR. UNIT.</th>
            <th>VLR. TOTAL</th>
          </tr>
        </thead>
        <tbody>
          {items.slice(0, 7).map((item) => (
            <tr key={item.id}>
              <td>{item.code ?? "—"}</td>
              <td>{item.description}</td>
              <td>{item.unit ?? "—"}</td>
              <td>{formatDecimal(item.quantity, 0)}</td>
              <td>{formatDecimal(item.unitPrice)}</td>
              <td>{formatDecimal(item.totalAmount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </article>
  );
}
