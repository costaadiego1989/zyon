import { useCallback, useEffect, useRef, useState } from "react";
import { useApi } from "../../hooks/useApi.js";
import { DashboardHttpError } from "../../api/http/error.js";
import { showToast } from "../../components/Toast.js";
import { reportError } from "../../hooks/useErrorReporter.js";
import type { MerchantProfile } from "../../api-client.js";
import type { PostSaleTemplate } from "./usePostSalePage.js";

/**
 * Campaign types that support a merchant-editable message template.
 * Matches the backend copywriter template keys.
 */
export const TEMPLATE_TYPES: Array<{ type: string; label: string; hasCoupon: boolean }> = [
  { type: "follow_up", label: "Acompanhamento da entrega", hasCoupon: false },
  { type: "review_request", label: "Pedido de avaliaÃ§Ã£o", hasCoupon: false },
  { type: "nps", label: "Pesquisa de satisfaÃ§Ã£o (NPS)", hasCoupon: false },
  { type: "cross_sell", label: "Produtos complementares", hasCoupon: true },
  { type: "win_back", label: "Retorno de clientes", hasCoupon: true },
  { type: "loyalty", label: "Fidelidade", hasCoupon: true },
  { type: "reorder", label: "Recompra", hasCoupon: true },
  { type: "cart_recovery", label: "RecuperaÃ§Ã£o de carrinho", hasCoupon: true },
  { type: "order_confirmation", label: "ConfirmaÃ§Ã£o do pedido", hasCoupon: false },
  { type: "order_shipped", label: "Pedido enviado", hasCoupon: false },
  { type: "order_delivered", label: "Pedido entregue", hasCoupon: false },
];

export const TEMPLATE_CHANNELS = ["whatsapp", "email"] as const;
export type TemplateChannel = (typeof TEMPLATE_CHANNELS)[number];

function keyOf(type: string, channel: string) {
  return `${type}:${channel}`;
}

export function usePostSaleTemplates(props: { me: MerchantProfile | null }) {
  const api = useApi();
  const [templates, setTemplates] = useState<Record<string, PostSaleTemplate>>({});
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [generatingKey, setGeneratingKey] = useState<string | null>(null);
  const [refreshingKey, setRefreshingKey] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [conflictKey, setConflictKey] = useState<string | null>(null);
  const working = useRef(false);
  const readVersion = useRef(0);

  const load = useCallback(async () => {
    if (!props.me) return;
    const version = ++readVersion.current;
    setLoading(true);
    try {
      const res = await api.listTemplates();
      const map: Record<string, PostSaleTemplate> = {};
      for (const t of res.templates ?? []) {
        map[keyOf(t.type, t.channel)] = t;
      }
      if (version === readVersion.current) { setTemplates(map); setLoadError(null); }
    } catch (e) {
      reportError({ source: "post-sale-templates.load", error: e });
      if (version === readVersion.current) setLoadError("NÃ£o foi possÃ­vel carregar as mensagens. Tente novamente antes de editar.");
    } finally {
      if (version === readVersion.current) setLoading(false);
    }
  }, [api, props.me]);

  useEffect(() => {
    setTemplates({});
    void load();
    return () => { readVersion.current += 1; };
  }, [load]);

  function get(type: string, channel: string): PostSaleTemplate | undefined {
    return templates[keyOf(type, channel)];
  }

  function receiveTemplate(template: PostSaleTemplate) {
    setTemplates(prev => Object.fromEntries(Object.entries({ ...prev, [keyOf(template.type, template.channel)]: template })
      .map(([key, value]) => [key, value.type === template.type ? { ...value, metaRevision: template.metaRevision } : value])));
  }

  async function save(
    type: string,
    channel: string,
    data: {
      revision?: number;
      name: string;
      body: string;
      subject?: string;
      metaCategory?: string;
      metaLanguage?: string;
      metaTemplateBody?: string;
      metaVariableMap?: Record<string, string>;
    }
  ): Promise<boolean> {
    if (working.current || loading || loadError) return false;
    working.current = true;
    readVersion.current += 1;
    setActionError(null);
    const k = keyOf(type, channel);
    setSavingKey(k);
    try {
      const res = await api.saveTemplate(type, channel, data);
      receiveTemplate(res.template);
      setConflictKey(null);
      showToast("success", "Mensagem salva");
      return true;
    } catch (e) {
      reportError({ source: "post-sale-templates.save", error: e });
      if (e instanceof DashboardHttpError && e.status === 409) { setConflictKey(k); await load(); }
      setActionError("NÃ£o foi possÃ­vel salvar. Seu rascunho foi preservado. Confira a versÃ£o atual antes de tentar novamente.");
      return false;
    } finally {
      setSavingKey(null);
      working.current = false;
    }
  }

  async function generate(
    type: string,
    channel: string,
    opts?: { tone?: string; storeName?: string }
  ): Promise<Awaited<ReturnType<typeof api.generateTemplate>> | null> {
    if (working.current || loading || loadError) return null;
    working.current = true;
    setActionError(null);
    const k = keyOf(type, channel);
    setGeneratingKey(k);
    try {
      const res = await api.generateTemplate({ type, channel, ...opts });
      showToast("success", "SugestÃ£o gerada pela IA");
      return res;
    } catch (e) {
      reportError({ source: "post-sale-templates.generate", error: e });
      setActionError("NÃ£o foi possÃ­vel gerar a sugestÃ£o. Seu texto foi mantido. Tente novamente.");
      return null;
    } finally {
      setGeneratingKey(null);
      working.current = false;
    }
  }

  async function submitMeta(type: string, channel: string): Promise<boolean> {
    if (working.current || loading || loadError) return false;
    working.current = true;
    setActionError(null);
    const k = keyOf(type, channel);
    setSavingKey(k);
    try {
      const res = await api.submitMetaTemplate(type, channel);
      receiveTemplate(res.template);
      showToast("success", "SolicitaÃ§Ã£o registrada. Acompanhe o estado da anÃ¡lise.");
      return true;
    } catch (e) {
      reportError({ source: "post-sale-templates.submitMeta", error: e });
      setActionError("NÃ£o foi possÃ­vel confirmar o envio para anÃ¡lise. Atualize o estado antes de tentar novamente.");
      return false;
    } finally {
      setSavingKey(null);
      working.current = false;
    }
  }

  async function refreshMetaStatus(type: string, channel: string): Promise<string | null> {
    if (working.current || loading) return null;
    working.current = true;
    setRefreshingKey(keyOf(type, channel));
    setActionError(null);
    try {
      const res = await api.getMetaTemplateStatus(type, channel);
      const k = keyOf(type, channel);
      setTemplates((prev) => {
        const existing = prev[k];
        if (!existing) return prev;
        return { ...prev, [k]: { ...existing, metaStatus: res.status, metaRejectionReason: res.rejectionReason ?? null } };
      });
      await load();
      return res.status;
    } catch (e) {
      reportError({ source: "post-sale-templates.refreshMetaStatus", error: e });
      setActionError("NÃ£o foi possÃ­vel atualizar a anÃ¡lise. O estado anterior foi mantido; tente novamente.");
      return null;
    } finally { working.current = false; setRefreshingKey(null); }
  }

  async function restore(type: string, revision: number, expectedRevision: number): Promise<boolean> {
    if (working.current || loading || loadError) return false;
    working.current = true;
    setActionError(null);
    const key = keyOf(type, "whatsapp");
    setSavingKey(key);
    try {
      const result = await api.restorePostSaleTemplate(type, revision, expectedRevision);
      receiveTemplate(result.template);
      showToast("success", "VersÃ£o restaurada apÃ³s confirmaÃ§Ã£o da Meta.");
      return true;
    } catch {
      setActionError("NÃ£o foi possÃ­vel restaurar. A versÃ£o precisa continuar aprovada na conta conectada. Atualize o estado e tente novamente.");
      return false;
    } finally { setSavingKey(null); working.current = false; }
  }

  return {
    restore,
    templates,
    loading,
    savingKey,
    generatingKey,
    refreshingKey,
    loadError,
    actionError,
    conflictKey,
    clearFeedback: () => { setActionError(null); setConflictKey(null); },
    get,
    save,
    generate,
    submitMeta,
    refreshMetaStatus,
    reload: load,
  };
}
