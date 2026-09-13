import { useCallback, useEffect, useState } from "react";
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
  { type: "follow_up", label: "Follow-up de Entrega", hasCoupon: false },
  { type: "review_request", label: "Pedido de Review", hasCoupon: false },
  { type: "nps", label: "NPS", hasCoupon: false },
  { type: "cross_sell", label: "Cross-sell", hasCoupon: true },
  { type: "win_back", label: "Win-back", hasCoupon: true },
  { type: "loyalty", label: "Fidelidade", hasCoupon: true },
  { type: "reorder", label: "Recompra", hasCoupon: true },
  { type: "cart_recovery", label: "Recuperação de Carrinho", hasCoupon: true },
  { type: "order_confirmation", label: "Confirmação de Pedido", hasCoupon: false },
  { type: "order_shipped", label: "Pedido Enviado", hasCoupon: false },
  { type: "order_delivered", label: "Pedido Entregue", hasCoupon: false },
];

export const TEMPLATE_CHANNELS = ["whatsapp", "email"] as const;
export type TemplateChannel = (typeof TEMPLATE_CHANNELS)[number];

function keyOf(type: string, channel: string) {
  return `${type}:${channel}`;
}

export function usePostSaleTemplates(props: { me: MerchantProfile | null }) {
  const api = useApi();
  const [templates, setTemplates] = useState<Record<string, PostSaleTemplate>>({});
  const [loading, setLoading] = useState(false);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [generatingKey, setGeneratingKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!props.me) return;
    setLoading(true);
    try {
      const res = await api.listTemplates();
      const map: Record<string, PostSaleTemplate> = {};
      for (const t of res.templates ?? []) {
        map[keyOf(t.type, t.channel)] = t;
      }
      setTemplates(map);
    } catch (e) {
      reportError({ source: "post-sale-templates.load", error: e });
      showToast("error", "Não foi possível carregar as mensagens. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }, [api, props.me]);

  useEffect(() => {
    void load();
  }, [load]);

  function get(type: string, channel: string): PostSaleTemplate | undefined {
    return templates[keyOf(type, channel)];
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
    const k = keyOf(type, channel);
    setSavingKey(k);
    try {
      const res = await api.saveTemplate(type, channel, data);
      setTemplates((prev) => ({ ...prev, [k]: res.template }));
      await load();
      showToast("success", "Template salvo");
      return true;
    } catch (e) {
      reportError({ source: "post-sale-templates.save", error: e });
      if (e instanceof DashboardHttpError && e.status === 409) await load();
      showToast("error", "Não foi possível salvar. Seu rascunho foi preservado. Confira a versão atual antes de tentar novamente.");
      return false;
    } finally {
      setSavingKey(null);
    }
  }

  async function generate(
    type: string,
    channel: string,
    opts?: { tone?: string; storeName?: string }
  ): Promise<Awaited<ReturnType<typeof api.generateTemplate>> | null> {
    const k = keyOf(type, channel);
    setGeneratingKey(k);
    try {
      const res = await api.generateTemplate({ type, channel, ...opts });
      showToast("success", "Sugestão gerada pela IA");
      return res;
    } catch (e) {
      reportError({ source: "post-sale-templates.generate", error: e });
      showToast("error", "Não foi possível gerar a sugestão. Tente novamente.");
      return null;
    } finally {
      setGeneratingKey(null);
    }
  }

  async function submitMeta(type: string, channel: string): Promise<boolean> {
    const k = keyOf(type, channel);
    setSavingKey(k);
    try {
      const res = await api.submitMetaTemplate(type, channel);
      setTemplates((prev) => ({ ...prev, [k]: res.template }));
      showToast("success", `Enviado à Meta (status: ${res.submission.status})`);
      return true;
    } catch (e) {
      reportError({ source: "post-sale-templates.submitMeta", error: e });
      showToast("error", e instanceof Error ? e.message : "Erro ao enviar à Meta");
      return false;
    } finally {
      setSavingKey(null);
    }
  }

  async function refreshMetaStatus(type: string, channel: string): Promise<string | null> {
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
      return null;
    }
  }

  async function restore(type: string, revision: number, expectedRevision: number): Promise<boolean> {
    const key = keyOf(type, "whatsapp");
    setSavingKey(key);
    try {
      const result = await api.restorePostSaleTemplate(type, revision, expectedRevision);
      setTemplates(prev => ({ ...prev, [key]: result.template }));
      await load();
      showToast("success", "Versão restaurada após confirmação da Meta.");
      return true;
    } catch {
      showToast("error", "Não foi possível restaurar. A versão precisa continuar aprovada na conta conectada. Atualize o status e tente novamente.");
      return false;
    } finally { setSavingKey(null); }
  }

  return {
    restore,
    templates,
    loading,
    savingKey,
    generatingKey,
    get,
    save,
    generate,
    submitMeta,
    refreshMetaStatus,
    reload: load,
  };
}
