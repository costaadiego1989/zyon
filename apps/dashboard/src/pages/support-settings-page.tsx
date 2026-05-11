import React, { useEffect, useMemo, useState } from "react";
import { Plus, Save, Trash2 } from "lucide-react";
import type { SupportFaqItem, SupportSettings } from "@aacp/shared-types";
import { createDashboardApi, DashboardHttpError, type MerchantProfile as MerchantMeProfile } from "../api-client.js";

function newItem(): SupportFaqItem {
  return { id: crypto.randomUUID(), question: "", answer: "" };
}

export function SupportSettingsPage(props: { apiBaseUrl: string; me: MerchantMeProfile | null }) {
  const api = useMemo(() => createDashboardApi({ baseUrl: props.apiBaseUrl }), [props.apiBaseUrl]);
  const [settings, setSettings] = useState<SupportSettings | null>(null);
  const [items, setItems] = useState<SupportFaqItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!props.me) {
      setSettings(null);
      setItems([]);
      return;
    }
    void load();
  }, [props.me]); // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    setMessage(null);
    try {
      const s = await api.getSupportSettings();
      setSettings(s);
      setItems(s.faqItems);
    } catch (e) {
      const text = e instanceof DashboardHttpError ? e.responseBody.slice(0, 160) : e instanceof Error ? e.message : String(e);
      setMessage(`Erro ao carregar: ${text}`);
    }
  }

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      const saved = await api.putSupportSettings({ faqItems: items });
      setSettings(saved);
      setItems(saved.faqItems);
      setMessage("Salvo com sucesso.");
    } catch (e) {
      const text = e instanceof DashboardHttpError ? e.responseBody.slice(0, 160) : e instanceof Error ? e.message : String(e);
      setMessage(`Erro ao salvar: ${text}`);
    } finally {
      setBusy(false);
    }
  }

  function updateItem(id: string, field: "question" | "answer", val: string) {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, [field]: val } : it)));
  }

  function removeItem(id: string) {
    setItems((prev) => prev.filter((it) => it.id !== id));
  }

  if (!props.me) {
    return (
      <>
        <h1>Suporte — FAQ</h1>
        <p className="page-lead">Login necessário para gerenciar FAQ do suporte.</p>
      </>
    );
  }

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Suporte — FAQ</h1>
          <p className="page-lead">Perguntas frequentes exibidas no painel de suporte do widget.</p>
        </div>
        <button type="button" disabled={busy || !settings} onClick={() => void save()}>
          <Save size={16} />
          Salvar
        </button>
      </header>
      {message ? <p className="panel panel-info">{message}</p> : null}
      {!settings && !message ? <p>Carregando…</p> : null}
      {settings ? (
        <div className="panel stacked">
          {items.length === 0 ? (
            <p style={{ color: "var(--text-muted, #888)" }}>Nenhuma pergunta cadastrada.</p>
          ) : null}
          {items.map((item, idx) => (
            <div key={item.id} className="panel stacked">
              <strong style={{ fontSize: "0.8rem", color: "var(--text-muted, #888)" }}>#{idx + 1}</strong>
              <label>
                Pergunta
                <input
                  type="text"
                  value={item.question}
                  maxLength={200}
                  disabled={busy}
                  placeholder="ex: Qual o prazo de entrega?"
                  onChange={(e) => updateItem(item.id, "question", e.target.value)}
                />
              </label>
              <label>
                Resposta
                <textarea
                  value={item.answer}
                  maxLength={1000}
                  rows={3}
                  disabled={busy}
                  placeholder="ex: Entregamos em 5-10 dias úteis para todo Brasil."
                  onChange={(e) => updateItem(item.id, "answer", e.target.value)}
                />
              </label>
              <button
                type="button"
                style={{ alignSelf: "flex-start" }}
                disabled={busy}
                onClick={() => removeItem(item.id)}
              >
                <Trash2 size={14} />
                Remover
              </button>
            </div>
          ))}
          <button
            type="button"
            disabled={busy || items.length >= 20}
            onClick={() => setItems((prev) => [...prev, newItem()])}
          >
            <Plus size={14} />
            Adicionar pergunta {items.length >= 20 ? "(máx. 20)" : ""}
          </button>
          {settings.updatedAt ? (
            <p className="mono-small">Atualizado em {settings.updatedAt}</p>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
