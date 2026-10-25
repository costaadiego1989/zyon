import React, { useState } from "react";
import type { AgentRules } from "../api-client.js";

export interface AgentRulesFormProps {
  rules: AgentRules | null;
  onChange: (rules: AgentRules) => void;
  mode: "form" | "json";
  onModeChange: (mode: "form" | "json") => void;
  disabled?: boolean;
  loading?: boolean;
}

const KNOWN_KEYS = new Set(["id", "merchant_id", "capabilities", "guardrails", "enabled"]);

export function AgentRulesForm({
  rules,
  onChange,
  mode,
  onModeChange,
  disabled,
  loading,
}: AgentRulesFormProps): React.ReactElement {
  const [jsonDraft, setJsonDraft] = useState(() =>
    rules ? JSON.stringify(rules, null, 2) : "",
  );

  if (!rules) {
    return <p className="page-lead">Nenhuma regra carregada</p>;
  }

  const unknownKeys = Object.keys(rules).filter((k) => !KNOWN_KEYS.has(k));

  function handleJsonChange(value: string) {
    setJsonDraft(value);
    try {
      const parsed = JSON.parse(value) as AgentRules;
      onChange(parsed);
    } catch {
      // invalid JSON — wait for user to fix
    }
  }

  function toArray(val: unknown): string[] {
    if (Array.isArray(val)) return val;
    if (typeof val === "string") return val ? val.split(",").map(s => s.trim()) : [];
    return [];
  }

  function handleCapabilityRemove(index: number) {
    const caps = [...toArray(rules!.capabilities)];
    caps.splice(index, 1);
    onChange({ ...rules!, capabilities: caps });
  }

  function handleGuardrailChange(index: number, value: string) {
    const guardrails = [...toArray(rules!.guardrails)];
    guardrails[index] = value;
    onChange({ ...rules!, guardrails });
  }

  return (
    <div>
      <div className="mode-toggle">
        <button
          type="button"
          className={mode === "form" ? "active" : ""}
          onClick={() => onModeChange("form")}
          disabled={disabled || loading}
        >
          Formulário
        </button>
        <button
          type="button"
          className={mode === "json" ? "active" : ""}
          onClick={() => {
            setJsonDraft(JSON.stringify(rules, null, 2));
            onModeChange("json");
          }}
          disabled={disabled || loading}
        >
          JSON
        </button>
      </div>

      {mode === "json" ? (
        <textarea
          className="mono-textarea"
          value={jsonDraft}
          onChange={(e) => handleJsonChange(e.target.value)}
          disabled={disabled || loading}
          rows={12}
          spellCheck={false}
          aria-label="JSON das regras do agente"
        />
      ) : (
        <div className="rules-section-gap">
          <div className="form-row">
            <label>
              ID do Agente
              <input type="text" value={(rules.id as string) ?? ""} readOnly disabled />
            </label>
          </div>

          <h3>Capacidades</h3>
          <div className="chip-list">
            {toArray(rules.capabilities).map((cap: string, i: number) => (
              <span key={i} className="chip">
                {cap}
                <button
                  type="button"
                  className="chip-remove"
                  onClick={() => handleCapabilityRemove(i)}
                  disabled={disabled}
                  aria-label={`Remover ${cap}`}
                >
                  ×
                </button>
              </span>
            ))}
          </div>

          <h3>Guardrails</h3>
          {toArray(rules.guardrails).map((g: string, i: number) => (
            <div key={i} className="form-row" style={{ marginBottom: 8 }}>
              <textarea
                value={g}
                onChange={(e) => handleGuardrailChange(i, e.target.value)}
                disabled={disabled}
                rows={2}
                aria-label={`Guardrail ${i + 1}`}
              />
            </div>
          ))}

          {unknownKeys.length > 0 && (
            <>
              <h3>Campos adicionais (somente leitura)</h3>
              <pre className="mono-pre">
                {JSON.stringify(
                  Object.fromEntries(unknownKeys.map((k) => [k, rules[k]])),
                  null,
                  2,
                )}
              </pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}
