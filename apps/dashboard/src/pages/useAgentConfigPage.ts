import { useEffect, useMemo, useState } from "react";
import { useApi } from "../hooks/useApi.js";
import { showToast } from "../components/Toast.js";
import type { StageQuickReplies, AgentTone } from "@zyon/shared-types";
import type { MerchantProfile } from "../api-client.js";

export interface AgentConfigForm {
  agentName: string;
  persona: string;
  tone: AgentTone;
  language: string;
  greeting: string;
  maxDiscountPercent: string;
  minimumMarginPercent: string;
  quickReplies: StageQuickReplies | undefined;
}

const DEFAULT_FORM: AgentConfigForm = {
  agentName: "Assistente",
  persona: "",
  tone: "consultative",
  language: "pt-BR",
  greeting: "Olá! Como posso ajudá-lo?",
  maxDiscountPercent: "10",
  minimumMarginPercent: "15",
  quickReplies: undefined,
};

export function validateAgentConfig(form: AgentConfigForm): Record<string, string> {
  const errors: Record<string, string> = {};
  if (form.agentName.trim().length > 100) errors.agentName = "Máximo 100 caracteres";
  if (form.persona.length > 200) errors.persona = "Máximo 200 caracteres";
  if (form.greeting.length > 500) errors.greeting = "Máximo 500 caracteres";
  const maxDiscount = Number(form.maxDiscountPercent);
  if (Number.isNaN(maxDiscount) || maxDiscount < 0 || maxDiscount > 100) errors.maxDiscountPercent = "Informe um valor entre 0 e 100";
  const minMargin = Number(form.minimumMarginPercent);
  if (Number.isNaN(minMargin) || minMargin < 0 || minMargin > 100) errors.minimumMarginPercent = "Informe um valor entre 0 e 100";
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

export function useAgentConfigPage(props: { me: MerchantProfile | null }) {
  const api = useApi();
  const [form, setForm] = useState<AgentConfigForm>(DEFAULT_FORM);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [activeTab, setActiveTab] = useState<"identity" | "negotiation" | "quick-replies">("identity");
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

        setForm({
          agentName: String(identity.agentName ?? "Assistente"),
          persona: String(identity.persona ?? ""),
          tone: isValidTone(identity.tone) ? identity.tone : "consultative",
          language: String(identity.language ?? "pt-BR"),
          greeting: String(identity.greeting ?? ""),
          maxDiscountPercent: String(rulesUnknown.maxDiscountPercent ?? 10),
          minimumMarginPercent: String(rulesUnknown.minimumMarginPercent ?? 15),
          quickReplies: (rulesUnknown.quickReplies as unknown as StageQuickReplies | undefined) ?? undefined,
        });
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
        quickReplies: form.quickReplies,
      } as never);

      await api.putAgentRules({
        identity: {
          agentName: form.agentName,
          persona: form.persona,
          tone: form.tone,
          language: form.language,
          greeting: form.greeting,
        },
      } as never);

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
