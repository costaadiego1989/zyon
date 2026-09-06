import { useCallback, useEffect, useRef, useState } from "react";
import { getRecoveryTemplates, saveRecoveryTemplates, type RecoveryTemplatesUpdate } from "../../api/endpoints/cart-recovery-templates.js";
import { DashboardHttpError } from "../../api/http/error.js";
import { EMPTY_TEMPLATES_EDITOR, hasTemplateChanges, receiveTemplates, templateDraft, validateTemplates } from "./recovery-templates-model.js";

export function useRecoveryTemplates(apiBaseUrl: string) {
  const [editor, setEditor] = useState(EMPTY_TEMPLATES_EDITOR);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const generation = useRef(0);
  const busy = useRef<number | null>(null);
  const reading = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    if (busy.current !== null || reading.current === generation.current) return;
    const current = generation.current;
    reading.current = current;
    try {
      const saved = await getRecoveryTemplates(apiBaseUrl);
      if (current !== generation.current) return;
      setEditor((state) => receiveTemplates(state, saved));
      setError(null);
    } catch {
      if (current === generation.current) setError("Não foi possível atualizar o estado. Suas alterações continuam aqui; tentaremos novamente automaticamente.");
    } finally {
      if (reading.current === current) reading.current = null;
      if (current === generation.current) setLoading(false);
    }
  }, [apiBaseUrl]);

  useEffect(() => {
    generation.current += 1;
    busy.current = null;
    setEditor(EMPTY_TEMPLATES_EDITOR);
    setLoading(true);
    setSaving(false);
    setError(null);
    setNotice(null);
    void refresh();
    const timer = setInterval(() => { void refresh(); }, 15_000);
    return () => { generation.current += 1; clearInterval(timer); };
  }, [refresh]);

  const edit = (draft: RecoveryTemplatesUpdate) => {
    if (busy.current !== null) return;
    setEditor((state) => ({ ...state, draft }));
    setNotice(null);
  };

  const save = async () => {
    if (!editor.draft || busy.current !== null || editor.conflict || !hasTemplateChanges(editor)) return;
    const validation = validateTemplates(editor.draft);
    if (validation) { setError(validation); return; }
    const current = ++generation.current; // Ignore a GET started before this save.
    busy.current = current;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const saved = await saveRecoveryTemplates(apiBaseUrl, editor.draft);
      if (current !== generation.current) return;
      setEditor({ saved, draft: templateDraft(saved), conflict: false });
      setNotice("Mensagens salvas. Acompanhe abaixo o estado do WhatsApp.");
    } catch (cause) {
      if (current !== generation.current) return;
      if (cause instanceof DashboardHttpError && cause.status === 409 && cause.responseBody.includes("template_submission_in_progress")) {
        setError("O envio para análise está em andamento. Seu texto foi preservado; aguarde a atualização do estado e tente salvar novamente.");
      } else if (cause instanceof DashboardHttpError && cause.status === 409) {
        setEditor((state) => ({ ...state, conflict: true }));
        setError("A versão salva mudou em outra sessão. Atualize o estado e compare os textos antes de continuar.");
        try {
          const saved = await getRecoveryTemplates(apiBaseUrl);
          if (current === generation.current) setEditor((state) => receiveTemplates(state, saved));
        } catch {
          // Keep the draft and conflict visible until the next successful refresh.
        }
      } else {
        setError("Não foi possível confirmar o salvamento. Seu texto foi preservado; atualize o estado antes de tentar novamente.");
      }
    } finally {
      if (busy.current === current) busy.current = null;
      if (current === generation.current) setSaving(false);
    }
  };

  const discard = () => {
    if (busy.current !== null) return;
    setEditor((state) => state.saved ? { saved: state.saved, draft: templateDraft(state.saved), conflict: false } : state);
    setError(null);
    setNotice(null);
  };

  return { ...editor, loading, saving, error, notice, edit, save, refresh, discard, dirty: hasTemplateChanges(editor) };
}
