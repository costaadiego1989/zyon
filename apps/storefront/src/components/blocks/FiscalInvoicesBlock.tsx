"use client";
import type { FiscalInvoicesBlock as Block } from "@/lib/types";
import {
  openFiscalBuyerHref,
  safeFiscalBuyerHref,
} from "@/lib/fiscal-navigation";
export default function FiscalInvoicesBlock({ block }: { block: Block }) {
  return (
    <section
      aria-label="Notas fiscais no assistente"
      style={{ display: "grid", gap: 12 }}
    >
      <strong>Nota fiscal do pedido {block.data.orderId}</strong>
      {block.data.invoices.map((note) => (
        <div key={note.intentId} style={{ display: "grid", gap: 8 }}>
          <p>
            {note.number ? `NF-e ${note.number} · ` : ""}
            {note.state === "authorized"
              ? "Autorizada"
              : note.state === "cancelled"
              ? "Cancelada"
              : "Aguardando resultado fiscal"}
            {note.environment === "homologation"
              ? " · Homologação, sem validade fiscal"
              : ""}
          </p>
          {note.options
            .filter(
              (option) =>
                option.action === "navigate" && safeFiscalBuyerHref(option.href)
            )
            .map((option) => (
              <a
                key={option.href}
                href={option.href}
                onClick={(event) => {
                  event.preventDefault();
                  openFiscalBuyerHref(option.href);
                }}
                data-neu="control"
                style={{
                  minHeight: 44,
                  display: "inline-flex",
                  alignItems: "center",
                  padding: "10px 14px",
                  border: "1px solid var(--aacp-line)",
                  borderRadius: 8,
                  color: "var(--aacp-fg)",
                  background: "var(--aacp-surface-2)",
                  textDecoration: "none",
                }}
              >
                {option.label}
              </a>
            ))}
        </div>
      ))}
    </section>
  );
}
