import React from "react";
import type { StageQuickReplies } from "@aacp/shared-types";

type SubStage = { label: string; key: string };

const DATA_COLLECTION_SUBSTAGES: SubStage[] = [
  { label: "Nome", key: "nome" },
  { label: "Email", key: "email" },
  { label: "CPF", key: "CPF" },
  { label: "Telefone", key: "telefone" },
  { label: "Padrão", key: "default" },
];

const SHIPPING_SUBSTAGES: SubStage[] = [
  { label: "CEP", key: "CEP" },
  { label: "Confirmar", key: "confirmar" },
  { label: "Nº / Complemento", key: "numero_complemento" },
  { label: "Frete", key: "frete" },
  { label: "Padrão", key: "default" },
];

function toText(arr: string[] | undefined): string {
  return (arr ?? []).join(", ");
}

function fromText(text: string): string[] | undefined {
  const parts = text.split(",").map((s) => s.trim()).filter(Boolean);
  return parts.length > 0 ? parts : undefined;
}

function isEmptyStageReplies(r: StageQuickReplies): boolean {
  return (
    !r.data_collection &&
    !r.shipping &&
    (!r.payment || r.payment.length === 0) &&
    (!r.completed || r.completed.length === 0)
  );
}

export function QuickRepliesSection({
  value,
  onChange,
}: {
  value: StageQuickReplies | undefined;
  onChange: (next: StageQuickReplies | undefined) => void;
}) {
  function patchDataCollection(subKey: string, text: string) {
    const next: StageQuickReplies = { ...value };
    const dc = { ...(next.data_collection ?? {}) } as Record<string, string[] | undefined>;
    const arr = fromText(text);
    if (arr) dc[subKey] = arr;
    else delete dc[subKey];
    next.data_collection = Object.keys(dc).length > 0
      ? (dc as StageQuickReplies["data_collection"])
      : undefined;
    onChange(isEmptyStageReplies(next) ? undefined : next);
  }

  function patchShipping(subKey: string, text: string) {
    const next: StageQuickReplies = { ...value };
    const sh = { ...(next.shipping ?? {}) } as Record<string, string[] | undefined>;
    const arr = fromText(text);
    if (arr) sh[subKey] = arr;
    else delete sh[subKey];
    next.shipping = Object.keys(sh).length > 0
      ? (sh as StageQuickReplies["shipping"])
      : undefined;
    onChange(isEmptyStageReplies(next) ? undefined : next);
  }

  function patchSimple(stage: "payment" | "completed", text: string) {
    const next: StageQuickReplies = { ...value };
    next[stage] = fromText(text);
    onChange(isEmptyStageReplies(next) ? undefined : next);
  }

  return (
    <section>
      <h3 style={{ marginBottom: 4 }}>Quick Replies por Etapa</h3>
      <p className="page-lead" style={{ marginBottom: 12, marginTop: 0 }}>
        Separe as opções por vírgula. Vazio = fallback do sistema.
      </p>

      <details open>
        <summary style={{ fontWeight: 600, cursor: "pointer", marginBottom: 8 }}>
          Coleta de dados
        </summary>
        <div className="panel stacked" style={{ marginTop: 8 }}>
          {DATA_COLLECTION_SUBSTAGES.map((sub) => (
            <label key={sub.key}>
              {sub.label}
              <input
                type="text"
                placeholder="ex: Sim, Não, Voltar"
                value={toText(
                  value?.data_collection?.[sub.key as keyof NonNullable<StageQuickReplies["data_collection"]>]
                )}
                onChange={(e) => patchDataCollection(sub.key, e.target.value)}
              />
            </label>
          ))}
        </div>
      </details>

      <details open style={{ marginTop: 12 }}>
        <summary style={{ fontWeight: 600, cursor: "pointer", marginBottom: 8 }}>
          Frete
        </summary>
        <div className="panel stacked" style={{ marginTop: 8 }}>
          {SHIPPING_SUBSTAGES.map((sub) => (
            <label key={sub.key}>
              {sub.label}
              <input
                type="text"
                placeholder="ex: Sim, Não, Voltar"
                value={toText(
                  value?.shipping?.[sub.key as keyof NonNullable<StageQuickReplies["shipping"]>]
                )}
                onChange={(e) => patchShipping(sub.key, e.target.value)}
              />
            </label>
          ))}
        </div>
      </details>

      <details open style={{ marginTop: 12 }}>
        <summary style={{ fontWeight: 600, cursor: "pointer", marginBottom: 8 }}>
          Pagamento
        </summary>
        <div className="panel stacked" style={{ marginTop: 8 }}>
          <label>
            Respostas rápidas
            <input
              type="text"
              placeholder="ex: Pagar agora, Ver resumo"
              value={toText(value?.payment)}
              onChange={(e) => patchSimple("payment", e.target.value)}
            />
          </label>
        </div>
      </details>

      <details open style={{ marginTop: 12 }}>
        <summary style={{ fontWeight: 600, cursor: "pointer", marginBottom: 8 }}>
          Pedido confirmado
        </summary>
        <div className="panel stacked" style={{ marginTop: 8 }}>
          <label>
            Respostas rápidas
            <input
              type="text"
              placeholder="ex: Ver pedido, Continuar comprando"
              value={toText(value?.completed)}
              onChange={(e) => patchSimple("completed", e.target.value)}
            />
          </label>
        </div>
      </details>
    </section>
  );
}
