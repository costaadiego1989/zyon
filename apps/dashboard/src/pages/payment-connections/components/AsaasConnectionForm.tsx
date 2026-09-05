import React, { useState } from "react";
import { Button } from "../../../components/Button.js";
import { AsaasSubaccountForm, type AsaasSubaccountPayload, type CompanyPrefill } from "./AsaasSubaccountForm.js";

export interface AsaasExistingAccountPayload {
  api_key: string;
  sandbox: boolean;
}
export type AsaasConnectionPayload = AsaasSubaccountPayload | AsaasExistingAccountPayload;

interface Props {
  company: CompanyPrefill | null;
  defaultName?: string;
  saving: boolean;
  onSubmit: (payload: AsaasConnectionPayload) => void;
  onCancel: () => void;
}

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "10px 12px", marginTop: 6,
  border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)",
  background: "var(--surface-1)", color: "var(--color-text)", font: "inherit",
};

export function AsaasConnectionForm(props: Props) {
  const [mode, setMode] = useState<"existing" | "create">("existing");
  // Credentials stay in component memory and are discarded when the panel closes.
  const [apiKey, setApiKey] = useState("");
  const [sandbox, setSandbox] = useState(false);
  return <div style={{ display: "grid", gap: 20 }}>
    <div role="group" aria-label="Como conectar o Asaas" style={{ display: "flex", gap: 8 }}>
      <Button size="sm" variant={mode === "existing" ? "primary" : "ghost"} aria-pressed={mode === "existing"} disabled={props.saving} onClick={() => setMode("existing")}>Já tenho conta</Button>
      <Button size="sm" variant={mode === "create" ? "primary" : "ghost"} aria-pressed={mode === "create"} disabled={props.saving} onClick={() => { setApiKey(""); setMode("create"); }}>Criar conta Asaas</Button>
    </div>
    {mode === "create" ? <AsaasSubaccountForm {...props} /> : <form style={{ display: "grid", gap: 18 }} onSubmit={event => {
      event.preventDefault();
      if (!props.saving && apiKey.trim()) props.onSubmit({ api_key: apiKey.trim(), sandbox });
    }}>
      <p style={{ margin: 0, lineHeight: 1.6, color: "var(--color-text-muted)" }}>
        Conecte sua conta atual sem criar outro cadastro. No painel do Asaas, abra o menu do usuário → Integração → Chaves de API e gere uma chave para a Zyon.
      </p>
      <label>Ambiente
        <select style={inputStyle} value={sandbox ? "test" : "live"} disabled={props.saving} onChange={event => setSandbox(event.target.value === "test")}>
          <option value="live">Produção — pagamentos reais</option>
          <option value="test">Sandbox — testes</option>
        </select>
      </label>
      <label>Chave de API Asaas
        <input style={inputStyle} type="password" autoComplete="new-password" spellCheck={false} required value={apiKey} disabled={props.saving} onChange={event => setApiKey(event.target.value)} placeholder="Cole a chave do ambiente selecionado" />
      </label>
      <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: "var(--color-text-muted)" }}>Vamos verificar a chave e o status do cadastro. Contas em análise ficam pendentes até a aprovação pelo Asaas.</p>
      <div style={{ display: "flex", gap: 8 }}>
        <Button type="button" variant="ghost" size="sm" disabled={props.saving} onClick={props.onCancel}>Cancelar</Button>
        <Button type="submit" variant="primary" size="sm" loading={props.saving} disabled={props.saving || !apiKey.trim()}>Conectar conta existente</Button>
      </div>
    </form>}
  </div>;
}
