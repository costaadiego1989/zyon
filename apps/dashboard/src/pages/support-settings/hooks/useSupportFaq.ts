import { useCallback, useEffect, useRef, useState } from "react";
import type { SupportFaqItem, SupportSettings } from "@zyon/shared-types";
import { showToast } from "../../../components/Toast.js";
import { reportError } from "../../../hooks/useErrorReporter.js";
type DashboardApi = ReturnType<typeof import("../../../api-client.js").createDashboardApi>;
export function useSupportFaq(api: DashboardApi) {
  const [items, setItems] = useState<SupportFaqItem[]>([]);
  const [settings, setSettings] = useState<SupportSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; kind: "ok" | "error" } | null>(null);
  const inFlight = useRef(false);
  const load = useCallback(async () => {
    setLoading(true); setLoadError(null); setMessage(null);
    try { const result = await api.getSupportSettings(); setSettings(result); setItems(result?.faqItems ?? []); }
    catch (error) { setLoadError("Não foi possível carregar as perguntas frequentes. Tente novamente para continuar."); reportError({ source: "useSupportFaq.load", error }); }
    finally { setLoading(false); }
  }, [api]);
  useEffect(() => { void load(); }, [load]);
  const dirty = JSON.stringify(items) !== JSON.stringify(settings?.faqItems ?? []);
  const valid = items.every(item => item.question.trim() && item.answer.trim());
  async function save() {
    if (inFlight.current || loading || loadError || !dirty || !valid) return;
    inFlight.current = true; setSaving(true); setMessage(null);
    try { const saved = await api.putSupportSettings({ faqItems: items }); setSettings(saved); setItems(saved.faqItems); showToast("success", "Perguntas frequentes salvas."); }
    catch (error) { setMessage({ text: "Não foi possível salvar. Suas alterações foram preservadas para você tentar novamente.", kind: "error" }); reportError({ source: "useSupportFaq.save", error }); }
    finally { inFlight.current = false; setSaving(false); }
  }
  const updateItem = useCallback((id: string, field: "question" | "answer", value: string) => { setItems(current => current.map(item => item.id === id ? { ...item, [field]: value } : item)); setMessage(null); }, []);
  const removeItem = useCallback((id: string) => { setItems(current => current.filter(item => item.id !== id)); setMessage(null); }, []);
  const addItem = useCallback(() => { setItems(current => current.length < 20 ? [...current, { id: crypto.randomUUID(), question: "", answer: "" }] : current); setMessage(null); }, []);
  return { items, settings, loading, saving, loadError, message, dirty, valid, updateItem, removeItem, addItem, save, reload: load };
}
