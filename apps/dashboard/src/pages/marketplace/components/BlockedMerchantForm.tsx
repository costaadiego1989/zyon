import React, { useState } from "react";
import { Store } from "lucide-react";
import { EmptyState } from "../../../components/EmptyState.js";
import { FormField } from "../../../components/FormField.js";
import { Button } from "../../../components/Button.js";
interface Props {
  blockedIds: string[];
  saving: boolean;
  onAdd: (merchantId: string) => void;
  onRemove: (merchantId: string) => void;
}
export function BlockedMerchantForm({ blockedIds, saving, onAdd, onRemove }: Props) {
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const add = () => {
    const id = input.trim();
    if (!id) return;
    if (blockedIds.includes(id)) {
      setError("Esta loja já está na lista.");
      return;
    }
    onAdd(id);
    setInput("");
    setError(null);
  };
  return (
    <div className="blocked-merchant-form">
      <div className="marketplace-block-row">
        <FormField
          label="Código da loja"
          value={input}
          onChange={(value) => {
            setInput(value);
            setError(null);
          }}
          disabled={saving}
          placeholder="Cole o código disponível na aba Lojas"
          error={error ?? undefined}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              add();
            }
          }}
        />
        <Button variant="outline" disabled={saving || !input.trim()} onClick={add}>
          Adicionar à lista
        </Button>
      </div>
      {blockedIds.length ? (
        <ul className="marketplace-block-list">
          {blockedIds.map((id) => (
            <li key={id}>
              <code>{id}</code>
              <Button
                variant="ghost"
                disabled={saving}
                onClick={() => onRemove(id)}
                aria-label={`Remover bloqueio de ${id}`}
              >
                Remover
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          icon={Store}
          title="Nenhuma loja bloqueada"
          description="Adicione uma loja à lista quando precisar restringir essa parceria."
        />
      )}
    </div>
  );
}
