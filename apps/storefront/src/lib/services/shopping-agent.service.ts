import { apiCall } from "./http";
import type { ShoppingAgentAppearance } from "@zyon/shared-types";

export type ShoppingKind = "price_watch" | "restock" | "reorder" | "negotiate" | "basket_budget";
export interface ShoppingConfig {
  kind: ShoppingKind; title: string; items: Array<{ productId: string; variantId: string; quantity: number }>;
  targetCents?: number; includeShipping: boolean; destinationZip?: string; intervalDays?: number;
  maxDeliveryDays?: number; targetDiscountPercent: number; expiresAt?: string;
}
export interface AgentTask { id: string; revision: number; config: ShoppingConfig; status: string; nextRunAt: string; lastRunAt?: string; lastOutcome?: string }
export interface AgentSettings { enabled: boolean; email: boolean; whatsapp: boolean; quietStart: number; quietEnd: number; timeZone: string; maxDailyNotifications: number; appearance?: ShoppingAgentAppearance }
export interface AgentActivity {
  id: string; taskId: string; message: string; kind: string; decision: string; createdAt: string; readAt?: string;
  quote?: { items: Array<{ productId: string; variantId: string; quantity: number; name: string; unitPriceCents: number }>;
    subtotalCents: number; discountCents: number; serviceFeeCents: number; shippingCents: number | null; totalCents: number; expiresAt: string; available: boolean; shippingLabel?: string; deliveryDays?: number };
  deliveries: Partial<Record<"email" | "whatsapp", { status: string }>>;
}
export interface ShoppingAgentView {
  premium: boolean; profile: { name: string; personality: string } | null;
  state: { settings: AgentSettings; tasks: AgentTask[]; activities: AgentActivity[] } | null;
  capabilities: { automaticPayments: boolean; scope: string; maxActiveTasks: number };
}
export interface AgentProduct { id: string; name: string; type: string; variants: Array<{ id: string; label: string; priceCents: number; available: boolean }> }
export interface AgentSuggestion { productId: string; variantId: string; name: string; quantity: number; intervalDays: number; basedOnPurchases: number }
const messages: Record<string, string> = {
  agent_invalid_appearance: "Escolha um dos estilos, cores e expressões disponíveis para o agente.",
  agent_premium_required: "O agente pessoal está disponível nas lojas com o recurso premium ativo.",
  agent_consent_required: "Confirme a criação do agente para continuar.", agent_disabled: "Ative seu agente para criar ou retomar tarefas.",
  agent_invalid_title: "Dê um nome à tarefa, com até 120 caracteres.", agent_invalid_items: "Escolha ao menos um produto e sua variação.",
  agent_invalid_quantity: "Informe uma quantidade entre 1 e 100.", agent_invalid_budget: "Informe um limite válido em reais.",
  agent_budget_required: "Informe o valor que deseja acompanhar.", agent_destination_required: "Informe o CEP para incluir o frete.",
  agent_invalid_zip: "Confira o CEP informado.", agent_invalid_interval: "Escolha um intervalo entre 1 e 365 dias.",
  agent_invalid_expiry: "A validade precisa ser uma data futura.", agent_invalid_discount: "O desconto desejado deve estar entre 0% e 50%.",
  agent_product_unavailable: "Um produto ou variação deixou de estar disponível. Revise os itens.",
  agent_product_requires_options: "Este produto exige escolhas no atendimento da loja antes da compra.",
  agent_shipping_unavailable: "Não encontramos entrega para este CEP dentro das condições escolhidas.",
  agent_quote_changed: "As condições mudaram. Atualize a tarefa e revise a nova proposta.",
  agent_quote_expired: "Esta proposta expirou. Use Verificar agora na tarefa para consultar as condições atuais.",
  agent_approval_unavailable: "Esta proposta não está mais disponível. Consulte a tarefa.",
  agent_task_changed: "Esta tarefa mudou em outra janela. Os dados serão atualizados.",
  agent_concurrent_update: "Houve uma atualização simultânea. Tente novamente.", agent_task_limit: "Você atingiu o limite de tarefas. Cancele uma tarefa antes de criar outra.",
  agent_check_cooldown: "A consulta acabou de ser feita. Aguarde cinco minutos para verificar novamente.",
  agent_task_cancelled: "Esta tarefa foi encerrada.", agent_task_expired: "A validade terminou. Edite a data para retomar a tarefa.",
  agent_not_configured: "Crie seu agente para começar.", agent_currency_not_supported: "O acompanhamento está disponível para produtos em reais.",
};
function base(merchantId: string) { return `/buyer/me/stores/${encodeURIComponent(merchantId)}/shopping-agent`; }
async function request<T>(merchantId: string, path = "", init?: RequestInit): Promise<T> {
  try { return await apiCall<T>(`${base(merchantId)}${path}`, { ...init, cache: "no-store" }); }
  catch (error) { const code = error instanceof Error ? error.message : ""; throw new Error(messages[code] ?? (code.startsWith("agent_") ? "Não foi possível concluir. Atualize os dados e tente novamente." : code || "Não foi possível conectar. Tente novamente.")); }
}
export const shoppingAgent = {
  get: (merchantId: string) => request<ShoppingAgentView>(merchantId),
  configure: (merchantId: string, input: Partial<AgentSettings> & { name?: string; accepted?: boolean }) => request<ShoppingAgentView>(merchantId, "", { method: "PUT", body: JSON.stringify(input) }),
  catalog: (merchantId: string, query: string) => request<{ items: AgentProduct[] }>(merchantId, `/catalog?query=${encodeURIComponent(query)}`),
  suggestions: (merchantId: string) => request<{ items: AgentSuggestion[] }>(merchantId, "/suggestions"),
  create: (merchantId: string, config: ShoppingConfig, requestKey: string) => request<AgentTask>(merchantId, "/tasks", { method: "POST", body: JSON.stringify({ config, requestKey }) }),
  change: (merchantId: string, task: AgentTask, action: string, config?: ShoppingConfig) => request<ShoppingAgentView>(merchantId, `/tasks/${encodeURIComponent(task.id)}`, { method: "PATCH", body: JSON.stringify({ action, revision: task.revision, config }) }),
  decide: (merchantId: string, activityId: string, action: string) => request<{ embedToken?: string; cartRef?: string }>(merchantId, `/activities/${encodeURIComponent(activityId)}/${action}`, { method: "POST" }),
};
