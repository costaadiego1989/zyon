import React, { useState } from "react";
import { Plus, X, Zap } from "lucide-react";
import { EmptyState } from "../../../components/EmptyState.js";

interface BlockedMerchantFormProps {
  blockedIds: string[];
  saving: boolean;
  onAdd: (merchantId: string) => void;
  onRemove: (merchantId: string) => void;
}

export function BlockedMerchantForm({
  blockedIds,
  saving,
  onAdd,
  onRemove,
}: BlockedMerchantFormProps) {
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  function handleAdd() {
    const trimmed = input.trim();
    if (!trimmed) {
      setError("Informe o ID do merchant");
      return;
    }
    if (blockedIds.includes(trimmed)) {
      setError("Este merchant já está bloqueado");
      return;
    }
    setError(null);
    onAdd(trimmed);
    setInput("");
  }

  function handleRemove(id: string) {
    if (window.confirm(`Desbloquear merchant "${id}"?`)) {
      onRemove(id);
    }
  }

  return (
    <div className="blocked-merchant-form">
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <input
          type="text"
          className="marketplace-config__input"
          placeholder="merchant_id (ex: mrc_marketplace_05)"
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            if (error) setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleAdd();
            }
          }}
          disabled={saving}
          style={{ flex: 1 }}
        />
        <button
          type="button"
          className="marketplace-page__button marketplace-page__button--primary"
          onClick={handleAdd}
          disabled={saving || !input.trim()}
        >
          <Plus size={14} />
          Bloquear
        </button>
      </div>

      {error && (
        <div
          style={{
            padding: "8px 12px",
            background: "oklch(60% 0.18 25 / 0.15)",
            border: "1px solid var(--color-error)",
            borderRadius: 6,
            color: "var(--color-error)",
            fontSize: 12,
            marginBottom: 12,
          }}
        >
          {error}
        </div>
      )}

      {blockedIds.length === 0 ? (
        <EmptyState
          icon={Zap}
          title="Nenhuma loja bloqueada"
          description="You can add merchants to the blocklist as needed"
        />
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
          {blockedIds.map((id) => (
            <li
              key={id}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "10px 14px",
                background: "var(--color-surface-alt)",
                borderRadius: 6,
                font: "400 13px var(--font-mono)",
                color: "var(--color-text)",
              }}
            >
              <span>{id}</span>
              <button
                type="button"
                onClick={() => handleRemove(id)}
                disabled={saving}
                style={{
                  background: "transparent",
                  border: "none",
                  cursor: saving ? "not-allowed" : "pointer",
                  color: "var(--color-error)",
                  padding: 4,
                  borderRadius: 4,
                  display: "flex",
                  alignItems: "center",
                  opacity: saving ? 0.5 : 1,
                }}
                aria-label={`Desbloquear ${id}`}
              >
                <X size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}