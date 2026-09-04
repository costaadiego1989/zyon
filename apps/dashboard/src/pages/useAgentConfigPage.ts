import { useEffect, useMemo, useState } from "react";
import { useApi } from "../hooks/useApi.js";
import { showToast } from "../components/Toast.js";
import type { StageQuickReplies, AgentTone, AgentMode } from "@zyon/shared-types";
import type { MerchantProfile } from "../api-client.js";

export interface AgentConfigForm {
  agentName: string;
  persona: string;
  tone: AgentTone;
  language: string;
  greeting: string;
  emptyCartGreeting: string;
  maxDiscountPercent: string;
  minimumMarginPercent: string;
  allowFreeShipping: boolean;
  allowShippingDiscount: boolean;
  freeShippingMinCartValue: string;
  maxPartialShippingDiscount: string;
  offerExpirationMinutes: string;
  quickReplies: StageQuickReplies | undefined;
  agentMode: AgentMode;
}

const DEFAULT_FORM: AgentConfigForm = {
  agentName: "Assistente",
  persona: "",
  tone: "consultative",
  language: "pt-BR",
  greeting: "Olá! Como posso ajudá-lo?",
  emptyCartGreeting: "O que você deseja comprar? Digite aqui que encontro para você.",
  maxDiscountPercent: "10",
  minimumMarginPercent: "15",
  allowFreeShipping: false,
  allowShippingDiscount: true,
  freeShippingMinCartValue: "250",
  maxPartialShippingDiscount: "20",
  offerExpirationMinutes: "15",
  quickReplies: undefined,
  agentMode: "silent_until_trigger",
};

export function validateAgentConfig(form: AgentConfigForm): Record<string, string> {
  const errors: Record<string, string> = {};
  if (form.agentName.trim().length > 100) errors.agentName = "Máximo 100 caracteres";
  if (form.persona.length > 200) errors.persona = "Máximo 200 caracteres";
  if (form.greeting.length > 500) errors.greeting = "Máximo 500 caracteres";
  if (form.emptyCartGreeting.length > 500) errors.emptyCartGreeting = "Máximo 500 caracteres";
  const maxDiscount = Number(form.maxDiscountPercent);
  if (Number.isNaN(maxDiscount) || maxDiscount < 0 || maxDiscount > 50) errors.maxDiscountPercent = "Informe um valor entre 0 e 50";
  const minMargin = Number(form.minimumMarginPercent);
  if (Number.isNaN(minMargin) || minMargin < 5 || minMargin > 80) errors.minimumMarginPercent = "Informe um valor entre 5 e 80";
  const freeMin = Number(form.freeShippingMinCartValue);
  if (form.allowFreeShipping && (Number.isNaN(freeMin) || freeMin < 0)) errors.freeShippingMinCartValue = "Valor inválido";
  const partialMax = Number(form.maxPartialShippingDiscount);
  if (form.allowShippingDiscount && (Number.isNaN(partialMax) || partialMax < 0 || partialMax > 100)) errors.maxPartialShippingDiscount = "Entre 0 e 100";
  const expMin = Number(form.offerExpirationMinutes);
  if (Number.isNaN(expMin) || expMin < 1 || expMin > 1440) errors.offerExpirationMinutes = "Entre 1 e 1440 minutos";
  return errors;
}

const VALID_TONES: AgentTone[] = ["consultative", "premium", "direct", "friendly", "technical"];

function isValidTone(value: unknown): value is AgentTone {
  return typeof value === "string" && VALID_TONES.includes(value as AgentTone);
}

export type StageQrStage = { stage: string; label: string; replies: string[] };
export type StageQrConfig = { stages: StageQrStage[]; fallback: string[] };

export const DEFAULT_STAGE_QR: StageQrConfig = {
  stages: [
    { stage: "welcome", label: "Início", replies: ["Ver Produtos", "Encontrar Produto", "Categorias", "Prazo de Entrega", "Trocas e Devoluções", "Rastrear Pedido", "Meus Dados", "Ofertas"] },
    { stage: "browsing", label: "Navegação", replies: ["Selecionar Produto", "Filtrar Produtos", "Categorias", "Ofertas do Dia", "Voltar ao Início"] },
    { stage: "filter", label: "Filtros", replies: ["Por Preço", "Por Avaliação", "Mais Vendidos", "Novidades", "Frete Grátis", "Por Desconto", "Limpar Filtros"] },
    { stage: "categories", label: "Categorias", replies: ["Ver Todas", "Filtrar Categoria", "Voltar"] },
    { stage: "product_detail", label: "Detalhe do Produto", replies: ["Adicionar ao Carrinho", "Mais Informações", "Ver Avaliações", "Tirar Dúvidas", "Comparar", "Lista de Desejos", "Produtos Semelhantes", "Voltar"] },
    { stage: "more_info", label: "Informações", replies: ["Especificações Técnicas", "Dimensões e Peso", "Material", "Garantia", "Prazo de Entrega", "Voltar ao Produto"] },
    { stage: "reviews", label: "Avaliações", replies: ["Escrever Avaliação", "Positivas", "Negativas", "Ordenar por Recentes", "Voltar ao Produto"] },
    { stage: "review_card", label: "Avaliação Selecionada", replies: ["Curtir", "Responder", "Reportar", "Voltar às Avaliações"] },
    { stage: "questions", label: "Dúvidas", replies: ["Fazer Pergunta", "Ver Respondidas", "Minhas Perguntas", "Voltar ao Produto"] },
    { stage: "compare", label: "Comparação", replies: ["Ver Tabela Comparativa", "Escolher Outro", "Adicionar ao Carrinho", "Voltar ao Produto"] },
    { stage: "wishlist", label: "Lista de Desejos", replies: ["Ver Lista", "Compartilhar", "Mover para Carrinho", "Remover Item", "Voltar"] },
    { stage: "added_to_cart", label: "Adicionado ao Carrinho", replies: ["Ver Carrinho", "Continuar Comprando", "Produtos Similares", "Aplicar Cupom", "Finalizar Compra"] },
    { stage: "post_purchase", label: "Pós-compra", replies: ["Rastrear Pedido", "Nota Fiscal", "Alterar Endereço", "Cancelar Pedido", "Avaliar Produto", "Suporte"] },
    { stage: "support", label: "Suporte", replies: ["FAQ", "Falar com Humano", "Reportar Problema", "Status do Pedido", "Voltar ao Início"] },
  ],
  fallback: ["Ver Produtos", "Categorias", "Meus Dados", "Suporte"],
};

export const TONE_PT_TO_EN: Record<string, AgentTone> = {
  "Consultivo": "consultative",
  "Premium": "premium",
  "Direto": "direct",
  "Amigável": "friendly",
  "Técnico": "technical",
};

// Backend stores quick replies as a stage→replies map ({ welcome: [...], browsing: [...] }).
// The editor works on DEFAULT_STAGE_QR's ordered/labelled stages. These bridge the two:
// merge the saved map over the default stages (preserving labels/order), and flatten back.
function stageConfigFromMap(saved: Record<string, string[]> | undefined): StageQrConfig {
  if (!saved || typeof saved !== "object") return DEFAULT_STAGE_QR;
  return {
    stages: DEFAULT_STAGE_QR.stages.map((s) =>
      Array.isArray(saved[s.stage]) ? { ...s, replies: saved[s.stage] } : s
    ),
    fallback: Array.isArray(saved.fallback) ? saved.fallback : DEFAULT_STAGE_QR.fallback,
  };
}

function stageConfigToMap(config: StageQrConfig): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  for (const s of config.stages) map[s.stage] = s.replies;
  map.fallback = config.fallback;
  return map;
}

export function useAgentConfigPage(props: { me: MerchantProfile | null }) {
  const api = useApi();
  const [form, setForm] = useState<AgentConfigForm>(DEFAULT_FORM);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [activeTab, setActiveTab] = useState<"identity" | "quick-replies">("identity");
  const [stageQrConfig, setStageQrConfig] = useState<StageQrConfig>(DEFAULT_STAGE_QR);

  const errors = useMemo(() => validateAgentConfig(form), [form]);
  const hasErrors = Object.keys(errors).length > 0;

  useEffect(() => {
    if (!props.me) { setLoaded(true); return; }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const rules = await api.getMerchantRules();
        const ar = await api.getAgentRules();
        if (cancelled) return;

        const arUnknown = ar as unknown as Record<string, unknown>;
        const rulesUnknown = rules as unknown as Record<string, unknown>;
        const identity = (arUnknown.identity ?? {}) as Record<string, unknown>;
        const checkoutSettings = (arUnknown.checkoutSettings ?? {}) as Record<string, unknown>;
        const rawMode = checkoutSettings.agentMode;
        const agentMode: AgentMode =
          rawMode === "proactive" || rawMode === "manual_only" || rawMode === "silent_until_trigger"
            ? rawMode
            : "silent_until_trigger";

        setForm({
          agentName: String(identity.agentName ?? "Assistente"),
          persona: String(identity.persona ?? ""),
          tone: isValidTone(identity.tone) ? identity.tone : "consultative",
          language: String(identity.language ?? "pt-BR"),
          greeting: String(identity.greeting ?? ""),
          emptyCartGreeting: String(identity.emptyCartGreeting ?? ""),
          maxDiscountPercent: String(rulesUnknown.maxDiscountPercent ?? 10),
          minimumMarginPercent: String(rulesUnknown.minimumMarginPercent ?? 15),
          allowFreeShipping: Boolean(rulesUnknown.allowFreeShipping ?? false),
          allowShippingDiscount: Boolean(rulesUnknown.allowShippingDiscount ?? true),
          freeShippingMinCartValue: String(rulesUnknown.freeShippingMinCartValue ?? 250),
          maxPartialShippingDiscount: String(rulesUnknown.maxPartialShippingDiscount ?? 20),
          offerExpirationMinutes: String(rulesUnknown.offerExpirationMinutes ?? 15),
          quickReplies: (rulesUnknown.quickReplies as unknown as StageQuickReplies | undefined) ?? undefined,
          agentMode,
        });
        setStageQrConfig(stageConfigFromMap(rulesUnknown.quickReplies as Record<string, string[]> | undefined));
      } catch {
        // silent — form stays at defaults
      } finally {
        setLoading(false);
        setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [api, props.me]);

  function patch(p: Partial<AgentConfigForm>) {
    setForm((prev) => ({ ...prev, ...p }));
  }

  async function handleSave() {
    if (hasErrors) {
      showToast("error", "Corrija os erros antes de salvar");
      return;
    }
    setSaving(true);
    try {
      await api.putMerchantRules({
        maxDiscountPercent: Number(form.maxDiscountPercent),
        minimumMarginPercent: Number(form.minimumMarginPercent),
        allowFreeShipping: form.allowFreeShipping,
        allowShippingDiscount: form.allowShippingDiscount,
        freeShippingMinCartValue: Number(form.freeShippingMinCartValue),
        maxPartialShippingDiscount: Number(form.maxPartialShippingDiscount),
        offerExpirationMinutes: Number(form.offerExpirationMinutes),
        quickReplies: stageConfigToMap(stageQrConfig),
      } as never);

      await api.putAgentRules({
        identity: {
          agentName: form.agentName,
          persona: form.persona,
          tone: form.tone,
          language: form.language,
          greeting: form.greeting,
          emptyCartGreeting: form.emptyCartGreeting,
        },
        checkoutSettings: {
          agentMode: form.agentMode,
        },
      } as never);

      // Sync agentName to merchant theme for backward compat (storefront reads theme too)
      try {
        const currentTheme = await api.getMerchantTheme();
        await api.putMerchantTheme({ ...currentTheme, agentName: form.agentName, agentGreeting: form.greeting } as never);
      } catch { /* non-critical sync */ }

      showToast("success", "Configurações do agente salvas com sucesso");
    } catch (e) {
      showToast("error", e instanceof Error ? e.message : "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  }

  return {
    form,
    patch,
    errors,
    hasErrors,
    loading,
    saving,
    loaded,
    activeTab,
    setActiveTab,
    stageQrConfig,
    setStageQrConfig,
    handleSave,
  };
}
