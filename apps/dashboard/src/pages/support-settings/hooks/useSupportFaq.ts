import { useCallback, useEffect, useState } from "react";
import type { SupportFaqItem, SupportSettings } from "@zyon/shared-types";
import { DashboardHttpError } from "../../../api-client.js";
import { showToast } from "../../../components/Toast.js";
import { reportError } from "../../../hooks/useErrorReporter.js";

type DashboardApi = ReturnType<typeof import("../../../api-client.js").createDashboardApi>;

function newItem(): SupportFaqItem {
  return { id: crypto.randomUUID(), question: "", answer: "" };
}

export function useSupportFaq(api: DashboardApi) {
  const [items, setItems] = useState<SupportFaqItem[]>([]);
  const [settings, setSettings] = useState<SupportSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; kind: "ok" | "error" } | null>(null);

  useEffect(() => {
    void load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    setLoading(true);
    setMessage(null);
    try {
      const s = await api.getSupportSettings();
      const parsed = s && typeof s === "object" && !Array.isArray(s) ? s : null;
      setSettings(parsed);
      setItems(parsed?.faqItems ?? []);
    } catch (e) {
      const text = e instanceof DashboardHttpError
        ? e.responseBody.slice(0, 160)
        : e instanceof Error ? e.message : String(e);
      setMessage({ text: `Erro ao carregar FAQ: ${text}`, kind: "error" });
      reportError({ source: "useSupportFaq.load", error: e });
    } finally {
      setLoading(false);
    }
  }

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const saved = await api.putSupportSettings({ faqItems: items });
      setSettings(saved);
      setItems(saved.faqItems);
      showToast("success", "FAQ salvo com sucesso");
    } catch (e) {
      const text = e instanceof DashboardHttpError
        ? e.responseBody.slice(0, 160)
        : e instanceof Error ? e.message : String(e);
      showToast("error", `Erro ao salvar: ${text}`);
      reportError({ source: "useSupportFaq.save", error: e });
    } finally {
      setSaving(false);
    }
  }

  const updateItem = useCallback((id: string, field: "question" | "answer", val: string) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, [field]: val } : it)));
  }, []);

  const removeItem = useCallback((id: string) => {
    setItems((prev) => prev.filter((it) => it.id !== id));
  }, []);

  const addItem = useCallback(() => {
    setItems((prev) => [...prev, newItem()]);
  }, []);

  return {
    items,
    settings,
    loading,
    saving,
    message,
    updateItem,
    removeItem,
    addItem,
    save,
    reload: load,
  };
}
