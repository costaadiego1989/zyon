import React, { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";

export interface ServiceNamesFieldProps {
  businessMode: "products" | "services";
  value: string[];
  onChange: (value: string[]) => void;
  disabled?: boolean;
}

const nameKey = (name: string) => name.trim().normalize("NFKC").toLocaleLowerCase("pt-BR");

export function ServiceNamesField({ businessMode, value, onChange, disabled = false }: ServiceNamesFieldProps) {
  const id = useId(), draftRef = useRef<HTMLInputElement>(null), rows = useRef<Array<HTMLInputElement | null>>([]);
  const pendingFocus = useRef<number | null>(null);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<{ index: number; text: string } | null>(null);
  const [error, setError] = useState<{ index: number | "draft"; message: string } | null>(null);
  useEffect(() => {
    if (businessMode !== "services") { setDraft(""); setEditing(null); setError(null); }
  }, [businessMode]);
  useLayoutEffect(() => {
    if (pendingFocus.current === null) return;
    const target = pendingFocus.current; pendingFocus.current = null;
    if (target < 0) draftRef.current?.focus(); else rows.current[target]?.focus();
  }, [value]);

  if (businessMode !== "services") return null;

  function validate(raw: string, index: number | "draft") {
    const name = raw.trim();
    const message = !name ? "Digite o nome do serviço."
      : name.length > 160 ? "Use até 160 caracteres por nome."
        : value.some((existing, position) => position !== index && nameKey(existing) === nameKey(name)) ? "Este serviço já está na lista." : null;
    if (message) { setError({ index, message }); return null; }
    return name;
  }
  function add() {
    if (disabled) return;
    if (value.length >= 100) { setError({ index: "draft", message: "Limite de 100 serviços atingido." }); return; }
    const name = validate(draft, "draft");
    if (name === null) { draftRef.current?.focus(); return; }
    onChange([...value, name]); setDraft(""); setError(null); draftRef.current?.focus();
  }
  function commitEdit(index: number) {
    if (disabled || editing?.index !== index) return;
    const name = validate(editing.text, index);
    // Invalid edits visibly return to the saved form value; they never replace
    // it with an empty/duplicate name or silently become submitted context.
    setEditing(null);
    if (name === null) return;
    setError(null);
    if (name !== value[index]) onChange(value.map((existing, position) => position === index ? name : existing));
  }
  function remove(index: number) {
    if (disabled) return;
    setEditing(null); setError(null);
    pendingFocus.current = Math.min(index, value.length - 2);
    onChange(value.filter((_, position) => position !== index));
  }
  const helpId = id + "-help", errorId = id + "-error", atLimit = value.length >= 100;
  return <fieldset className="store-settings-fieldset" disabled={disabled} aria-describedby={helpId}>
    <legend style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Serviços da empresa</legend>
    <p id={helpId} className="admin-help" style={{ margin: 0, maxWidth: "70ch" }}>
      Os nomes ajudam o assistente a apresentar os serviços da sua empresa. Inclua somente informações públicas.
    </p>
    {value.length === 0 ? <p className="admin-help" style={{ margin: "12px 0" }}>Adicione o primeiro serviço no campo abaixo.</p> : null}
    <ul style={{ listStyle: "none", padding: 0, margin: "16px 0", display: "grid", gap: 12 }}>
      {value.map((name, index) => <li key={index} style={{ display: "flex", alignItems: "flex-end", gap: 12 }}>
        <div className="form-field" style={{ flex: 1, minWidth: 0, margin: 0 }}>
          <label htmlFor={id + "-service-" + index}>Serviço {index + 1}</label>
          <input id={id + "-service-" + index} ref={node => { rows.current[index] = node; }} type="text" maxLength={160}
            disabled={disabled} value={editing?.index === index ? editing.text : name}
            aria-invalid={error?.index === index} aria-describedby={error?.index === index ? `${helpId} ${errorId}` : helpId}
            onChange={event => { if (!disabled) { setEditing({ index, text: event.target.value }); setError(null); } }}
            onBlur={() => commitEdit(index)} onKeyDown={event => {
              if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); commitEdit(index); }
              if (event.key === "Escape") { event.preventDefault(); setEditing(null); setError(null); }
            }} />
        </div>
        <button type="button" className="btn-secondary" disabled={disabled} aria-label={`Remover ${name}`}
          onClick={() => remove(index)} style={{ minHeight: 44, flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Trash2 size={16} aria-hidden="true" /><span>Remover</span>
        </button>
      </li>)}
    </ul>
    <div style={{ display: "flex", flexDirection: "column", gap: 12, alignItems: "flex-start" }}>
      <div className="form-field" style={{ width: "100%", minWidth: 0, margin: 0 }}>
        <label htmlFor={id + "-draft"}>Novo serviço</label>
        <input id={id + "-draft"} ref={draftRef} type="text" value={draft} maxLength={160} disabled={disabled || atLimit}
          placeholder="Nome do serviço" aria-invalid={error?.index === "draft"}
          aria-describedby={error?.index === "draft" ? `${helpId} ${id}-count ${errorId}` : `${helpId} ${id}-count`}
          onChange={event => { if (!disabled && !atLimit) { setDraft(event.target.value); setError(null); } }}
          onKeyDown={event => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); add(); } }} />
      </div>
      <button type="button" className="btn-secondary" disabled={disabled || atLimit} onClick={add}
        style={{ minHeight: 44, display: "inline-flex", alignItems: "center", gap: 6 }}>
        <Plus size={16} aria-hidden="true" />Adicionar serviço
      </button>
    </div>
    <p id={id + "-count"} className="admin-help" aria-live="polite" aria-atomic="true" style={{ margin: "8px 0 0" }}>
      {value.length}/100 serviços{atLimit ? ". Remova um nome para adicionar outro." : ". Até 160 caracteres por nome."}
    </p>
    {error ? <p id={errorId} className="field-error" role="alert" style={{ margin: "8px 0 0" }}>{error.message}</p> : null}
  </fieldset>;
}
