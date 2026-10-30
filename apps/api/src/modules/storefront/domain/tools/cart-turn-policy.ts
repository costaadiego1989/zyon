import type { ExecutableTool, ToolResult } from "./types.js";
import { allowsSalesDiscovery, isUnspecifiedShoppingRequest } from "../services/sales-discovery.js";
import { storefrontToolArgumentSchemas } from "../contracts/storefront-tool.schemas.js";
import { storefrontToolOutputSchemas, validateStorefrontToolOutput } from "../contracts/storefront-tool-output.schemas.js";
import { explicitCartQuantityTarget } from "../services/cart-quantity-input.js";
import { cartQuantitySelectionSchema, type CartQuantitySelection } from "../contracts/cart-quantity-inspection.schemas.js";

const CART_WRITES = new Set([
  "add_item_to_cart", "update_cart_item", "remove_cart_item", "clear_cart",
  "apply_coupon", "remove_coupon", "create_checkout_session",
]);
const ADMISSION_ERRORS = new Set([
  "variant_out_of_stock", "stock_validation_unavailable", "variant_not_resolved",
  "variant_selection_required", "product_unavailable", "digital_content_unavailable",
  "cart_quantity_invalid", "cart_option_line_selection_required", "cart_item_limit",
  "marketplace_variant_selection_required", "marketplace_tool_binding_invalid",
  "marketplace_catalog_unavailable", "marketplace_cart_unavailable", "marketplace_insufficient_stock",
  "marketplace_product_options_required", "food_option_required", "food_option_unknown",
  "food_option_single_selection", "food_option_invalid", "option_required", "unknown_option_item",
  "single_selection_exceeded", "required_group_missing", "single_group_multiple_selected",
]);

export interface CartAddOutcome {
  variantId: string;
  status: "succeeded" | "rejected" | "unknown";
  code?: string;
  serviceSlotId?: string;
}
type TerminalMutation = "update_cart_item" | "remove_cart_item";
export interface CartMutationOutcome { tool: TerminalMutation; status: "succeeded" | "unknown" | "rejected"; code?: "variant_out_of_stock" }
const terminalMutation = (name: string): name is TerminalMutation => name === "update_cart_item" || name === "remove_cart_item";
/** The returned cart is a canonical handler projection, not proof of its prior
 * contents. Correlate the exact commanded line without asserting sibling history. */
function confirmsMutation(name: TerminalMutation, args: Record<string, unknown>, result: ToolResult, cartId: string): boolean {
  if (!result.ok || errorCode(result)) return false;
  const validated = validateStorefrontToolOutput(name, result.data, { cartId });
  if (!validated.ok) return false;
  const parsed = storefrontToolOutputSchemas[name].safeParse(validated.data);
  if (!parsed.success || parsed.data.cartId !== cartId) return false;
  const matches = [];
  for (const item of parsed.data.items) {
    if (item.variantId !== args.variantId) continue;
    const nestedOptions = item.selectedOptions?.map(option => option.itemId);
    if (nestedOptions?.some(id => id === undefined)) return false;
    const optionIds = item.optionItemIds ?? nestedOptions ?? [];
    if (new Set(optionIds).size !== optionIds.length) return false;
    const optionKey = JSON.stringify([...optionIds].sort());
    if (item.optionItemIds && nestedOptions && optionKey !== JSON.stringify([...nestedOptions].sort())) return false;
    if (Array.isArray(args.optionItemIds) && optionKey !== JSON.stringify([...args.optionItemIds].sort())) continue;
    if (item.serviceSlotId !== undefined && item.selectedServiceSlot && item.serviceSlotId !== item.selectedServiceSlot.slotId) return false;
    const slotId = item.serviceSlotId ?? item.selectedServiceSlot?.slotId ?? null;
    if (args.serviceSlotId !== undefined && slotId !== args.serviceSlotId) continue;
    matches.push(item);
  }
  return name === "remove_cart_item" || args.quantity === 0 ? matches.length === 0
    : matches.length === 1 && matches[0]!.quantity === args.quantity;
}

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

const addCommand = /^(?:adicionar|adicione|adiciona|colocar|coloque|coloca|incluir|inclua|inclui|botar|bota)\b/;
const commandPrefix = /^(?:por favor[,\s]+|(?:voce\s+)?(?:pode|poderia)\s+(?:por favor\s+)?|(?:eu\s+)?(?:quero|desejo)\s+|(?:eu\s+)?gostaria de\s+)/;
const cartMutationVerb = /\b(?:adicionar|adicione|adiciona|colocar|coloque|coloca|incluir|inclua|inclui|botar|bota|remover|remova|retirar|retire|excluir|exclua|limpar|limpe|esvaziar|esvazie|alterar|altere|mudar|mude|atualizar|atualize|aumentar|aumente|diminuir|diminua|aplicar|aplique|usar|use|mexer|mexa)\b/;

/** A checkout/payment prohibition does not revoke a separate explicit add.
 * This narrow grammar grants only add, never checkout or another cart write.
 * Unknown negation, conditions and attachment-derived text still fail closed. */
function explicitAdd(message: string): { quantity?: number } | undefined {
  const normalized = normalize(message.replace(/\[(?:variantId|optionItemIds|crossSellPromoId|serviceSlotId):[^\]]*\]/gi, ""));
  if (/```|(?:^|\n)\s*[>"`]|\b(?:exemplo|hipotetic\w*|traduza|traduzir|repita|cite|copie|diga)\b/.test(normalized)) return undefined;
  const clauses = normalized.split(/(?<=[.!?;])\s+|\n+|\s*,?\s+\b(?:mas|porem|contudo)\b\s*|\s+(?:e\s+)?(?=(?:nao|nem|nunca|jamais)\b)|\s+(?=sem\s+(?:finalizar|concluir|cobrar|pagar|gerar|abrir|iniciar)\b)/)
    .map(clause => clause.trim()).filter(Boolean);
  let selected: { quantity?: number } | undefined;
  for (let clause of clauses) {
    if (/\b(?:nao|nem|nunca|jamais)\b/.test(clause) || /^sem\b/.test(clause)) {
      if (!/^(?:nao|nem|nunca|jamais|sem)\s+(?:finaliz(?:ar|e)|conclu(?:ir|a)|cobr(?:ar|e)|pag(?:ar|ue)|ger(?:ar|e)|abr(?:ir|a)|inici(?:ar|e))\b/.test(clause)
        || cartMutationVerb.test(clause)) return undefined;
      continue;
    }
    if (/\b(?:talvez|depois|antes|caso|se|pesquisando|comparando)\b/.test(clause)
      || /\blista de desejos\b/.test(clause) || isUnspecifiedShoppingRequest(clause)) return undefined;
    // Politeness can precede the actual command; a product statement alone
    // never reaches this match and cannot supply write authority.
    for (let prefix = 0; prefix < 2; prefix++) clause = clause.replace(commandPrefix, "");
    if (!addCommand.test(clause) || !/\bcarrinho\b/.test(clause)) continue;
    if (selected) return undefined; // Multiple adds need a new reviewed choice.
    const count = clause.match(/(?:^|\s)(-?\d+(?:[.,]\d+)?|um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez)\s+(?:unidades?|itens?|produtos?|pecas?)\b/);
    const words: Record<string, number> = { um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10 };
    selected = count ? { quantity: words[count[1]!] ?? Number(count[1]) } : {};
    if (selected.quantity !== undefined && (!Number.isSafeInteger(selected.quantity) || selected.quantity < 1 || selected.quantity > 99)) return undefined;
  }
  return selected;
}

/** This is deliberately a bounded command grammar, not model classification.
 * History, attachment text, product mentions and a bare "sim" never grant a write.
 * Unclear requests can still search/read; the buyer must make a new explicit choice.
 */
function authorizedWrites(message: string, attachmentContext?: string): Set<string> {
  const allowed = new Set<string>();
  if (attachmentContext) return allowed; // Extracted lists require item-by-item review.
  if (isUnspecifiedShoppingRequest(message)) return allowed; // No product has been chosen.
  // "Quero comprar um tênis de corrida verde" describes a need, not a selected
  // item. Searching it must not authorize buying a substituted color/profile.
  if (allowsSalesDiscovery(message)) return allowed;
  if (/\b(?:nao|nunca|jamais|nem|sem)\b[^.!?;\n]{0,80}\b(?:adicionar|adicione|adiciona|colocar|coloque|coloca|incluir|inclua|inclui|botar|bota|comprar|compre|mexer|mexa)\b/.test(normalize(message))) return allowed;
  if (explicitAdd(message)) { allowed.add("add_item_to_cart"); return allowed; }
  let command = normalize(message.replace(/\[(?:variantId|optionItemIds|crossSellPromoId|serviceSlotId):[^\]]*\]/gi, ""));
  command = command.replace(/^(?:por favor[,\s]+|(?:voce\s+)?(?:pode|poderia)\s+(?:por favor\s+)?|(?:eu\s+)?(?:quero|desejo)\s+|(?:eu\s+)?gostaria de\s+)/, "");
  if (/\b(?:nao|nunca|jamais|nem|sem|talvez|depois|antes|caso|se|pesquisando|comparando)\b/.test(command) || /\blista de desejos\b/.test(command)) return allowed;
  if (/^(?:comprar|compre)\b/.test(command)) {
    allowed.add("add_item_to_cart"); allowed.add("create_checkout_session");
  } else if (/^(?:remover|remova|remove|retirar|retire|tira|excluir|exclua)\b/.test(command) && /\bcupom\b/.test(command)) allowed.add("remove_coupon");
  else if (/^(?:remover|remova|remove|retirar|retire|tira|excluir|exclua)\b/.test(command) && /\bcarrinho\b/.test(command)) allowed.add("remove_cart_item");
  else if (/^(?:limpar|limpe|esvaziar|esvazie)\b.*\bcarrinho\b/.test(command)) allowed.add("clear_cart");
  else if (/^(?:alterar|altere|mudar|mude|atualizar|atualize|aumentar|aumente|diminuir|diminua)\b/.test(command)
    && /\b(?:quantidade|unidades|carrinho)\b/.test(command)) allowed.add("update_cart_item");
  else if (/^(?:aplicar|aplique|usar|use)\b.*\bcupom\b/.test(command)) allowed.add("apply_coupon");
  else if (/^(?:finalizar|finalize|concluir|conclua)\b.*\b(?:compra|pedido)\b/.test(command)
    || /^(?:ir para (?:o )?|abrir (?:o )?)?checkout[.!?]*$/.test(command)) allowed.add("create_checkout_session");
  return allowed;
}

function errorCode(result: ToolResult): string | undefined {
  if (!result.ok) return result.code ?? result.error;
  if (result.data && typeof result.data === "object" && "error" in result.data) return String(result.data.error);
  return undefined;
}

export function createCartTurnPolicy(message: string, attachmentContext?: string, cartId?: string, inspectedSelection?: CartQuantitySelection) {
  const allowed = authorizedWrites(message, attachmentContext);
  const requestedAdd = explicitAdd(message);
  const requestedQuantity = explicitCartQuantityTarget(message);
  const inspected = inspectedSelection === undefined ? undefined : cartQuantitySelectionSchema.safeParse(inspectedSelection);
  const bindings = [...message.matchAll(/\[variantId:([A-Za-z0-9_-]{1,191})\]/g)].map(match => match[1]);
  const optionTag = message.match(/\[optionItemIds:([^\]]*)\]/);
  const options = optionTag ? optionTag[1].split(",").filter(Boolean).sort() : [];
  const promoTag = message.match(/\[crossSellPromoId:([A-Za-z0-9_-]{1,191})\]/)?.[1];
  const serviceSlotTag = message.match(/\[serviceSlotId:([A-Za-z0-9_-]{1,191})\]/)?.[1];
  const attempts = new Map<string, { key: string; result: Promise<ToolResult> }>();
  const completed = new Map<string, ToolResult>();
  const deniedTools = new Set<string>();
  const addOutcomes: CartAddOutcome[] = [];
  let terminal = false;
  let refused = false;
  let mutationOutcome: CartMutationOutcome | undefined;

  function denied(name: string, code: string): ToolResult {
    refused = terminal = true;
    deniedTools.add(name);
    if (terminalMutation(name) && !mutationOutcome) mutationOutcome = { tool: name, status: "rejected" };
    if (name === "add_item_to_cart" && allowed.has(name) && bindings.length === 1 && !attempts.has(name) && !addOutcomes.length) {
      addOutcomes.push({ variantId: bindings[0]!, status: "rejected", code, ...(serviceSlotTag ? { serviceSlotId: serviceSlotTag } : {}) });
    }
    return { ok: false, error: code, code };
  }

  return {
    get terminal() { return terminal; },
    get refused() { return refused; },
    get addOutcomes() { return addOutcomes; },
    get mutationOutcome() { return mutationOutcome; },
    /** Read only actual completed attempts, never requested/denied tool names.
     * Unknown transport/output failures cannot become success through copy. */
    get hasUnknownWrite() {
      for (const result of completed.values()) {
        const code = errorCode(result);
        if (code && code !== "invalid_tool_arguments" && !ADMISSION_ERRORS.has(code)
          && !code.startsWith("food_option_") && !code.startsWith("service_slot_") && !code.startsWith("service_schedule_")) return true;
      }
      return false;
    },
    sanitizeResults(results: Record<string, unknown>) {
      // A denied add must not hide otherwise valid catalog search cards.
      const copy = { ...results };
      for (const name of deniedTools) if (!attempts.has(name)) delete copy[name];
      for (const [name, value] of completed) copy[name] = value.ok ? value.data : { error: value.error, code: value.code };
      return copy;
    },
    wrap(tools: ExecutableTool[]): ExecutableTool[] {
      return tools.map(tool => !CART_WRITES.has(tool.name) ? tool : {
        name: tool.name,
        execute: async (args): Promise<ToolResult> => {
          if (!allowed.has(tool.name)) return denied(tool.name, "cart_action_requires_explicit_request");
          if (terminal) return denied(tool.name, "cart_action_requires_review");
          if (tool.name === "add_item_to_cart" && requestedAdd?.quantity !== undefined
            && (requestedAdd.quantity < 1 || requestedAdd.quantity > 99 || (args.quantity ?? 1) !== requestedAdd.quantity))
            return denied(tool.name, "cart_selection_binding_mismatch");
          // Capture validated detached arguments before execution. No model cart
          // alias or mutable argument object can authorize a different scope.
          if (terminalMutation(tool.name)) {
            const parsed = storefrontToolArgumentSchemas[tool.name].safeParse(args);
            if (!parsed.success || !cartId || parsed.data.cartId !== cartId) return denied(tool.name, "invalid_tool_arguments");
            args = structuredClone(parsed.data);
            if (tool.name === "update_cart_item" && requestedQuantity !== undefined && args.quantity !== requestedQuantity)
              return denied(tool.name, "cart_selection_binding_mismatch");
            if (tool.name === "update_cart_item" && inspected !== undefined && (!inspected.success
              || inspected.data.cartId !== cartId || inspected.data.quantity !== requestedQuantity
              || args.variantId !== inspected.data.variantId || args.quantity !== inspected.data.quantity
              || JSON.stringify([...(Array.isArray(args.optionItemIds) ? args.optionItemIds : [])].sort()) !== JSON.stringify(inspected.data.optionItemIds)
              || (args.serviceSlotId ?? null) !== inspected.data.serviceSlotId)) return denied(tool.name, "cart_selection_binding_mismatch");
            if (optionTag && (!Array.isArray(args.optionItemIds) || JSON.stringify([...args.optionItemIds].sort()) !== JSON.stringify(options))
              || serviceSlotTag && args.serviceSlotId !== serviceSlotTag) return denied(tool.name, "cart_selection_binding_mismatch");
            if (tool.name === "update_cart_item" && inspected?.success) {
              // Absence is a legacy unique-variant selector, not the inspected
              // empty selection. Carry []/null into the locked writer so a
              // changed options/slot line cannot replace the admitted line.
              args = { ...args, optionItemIds: [...inspected.data.optionItemIds], serviceSlotId: inspected.data.serviceSlotId };
            }
          }
          if (tool.name === "create_checkout_session" && allowed.has("add_item_to_cart")
            && !addOutcomes.some(outcome => outcome.status === "succeeded")) return denied(tool.name, "cart_action_requires_review");
          if (bindings.length && (["add_item_to_cart", "update_cart_item", "remove_cart_item"].includes(tool.name))
            && (bindings.length !== 1 || args.variantId !== bindings[0])) return denied(tool.name, "cart_variant_binding_mismatch");
          if (tool.name === "add_item_to_cart" && bindings.length) {
            const suppliedOptions = Array.isArray(args.selectedOptionItemIds) ? [...args.selectedOptionItemIds].sort() : [];
            if (JSON.stringify(suppliedOptions) !== JSON.stringify(options) || (args.crossSellPromoId ?? undefined) !== promoTag
              || (args.quantity ?? 1) !== 1 || (args.selectedServiceSlotId ?? undefined) !== serviceSlotTag) return denied(tool.name, "cart_selection_binding_mismatch");
          }
          if (tool.name === "add_item_to_cart" && args.selectedServiceSlotId && args.selectedServiceSlotId !== serviceSlotTag)
            return denied(tool.name, "cart_selection_binding_mismatch");
          // Cache one attempt per operation across all provider loops. Different
          // arguments need a fresh buyer turn; a fallback cannot add another item.
          const key = JSON.stringify(Object.entries(args).sort(([a], [b]) => a.localeCompare(b)));
          const previous = attempts.get(tool.name);
          if (previous) return previous.key === key ? previous.result : denied(tool.name, "cart_action_requires_review");
          const command = terminalMutation(tool.name) ? structuredClone(args) : args;
          const result = Promise.resolve().then(() => tool.execute(args)).catch(error => {
            if (!terminalMutation(tool.name)) throw error;
            return { ok: false as const, error: "cart_outcome_unknown", code: "cart_outcome_unknown" };
          }).then(value => {
            if (terminalMutation(tool.name)) {
              let confirmed = false, knownNotApplied = false;
              try {
                const rejected = tool.name === "update_cart_item" && value.ok
                  ? validateStorefrontToolOutput(tool.name, value.data, cartId ? { cartId } : undefined) : undefined;
                const refusal = rejected?.ok ? rejected.data as { error?: unknown; notApplied?: { cartId?: unknown; variantId?: unknown; quantity?: unknown } } : undefined;
                knownNotApplied = !!cartId && refusal?.error === "variant_out_of_stock"
                  && refusal.notApplied?.cartId === cartId && refusal.notApplied.variantId === command.variantId
                  && refusal.notApplied.quantity === command.quantity;
                confirmed = !!cartId && confirmsMutation(tool.name, command, value, cartId);
              } catch { confirmed = knownNotApplied = false; /* A malformed result or post-write validation error cannot authorize retry. */ }
              mutationOutcome = { tool: tool.name, status: confirmed ? "succeeded" : knownNotApplied ? "rejected" : "unknown",
                ...(knownNotApplied ? { code: "variant_out_of_stock" as const } : {}) };
              terminal = true;
              if (!confirmed && !knownNotApplied) value = { ok: false, error: "cart_outcome_unknown", code: "cart_outcome_unknown" };
            }
            completed.set(tool.name, value);
            const code = errorCode(value);
            if (code) terminal = true;
            if (tool.name === "add_item_to_cart") {
              const cart = value.ok ? value.data as { cartId?: unknown; items?: unknown } | null : null;
              const confirmed = !code && typeof cart?.cartId === "string" && (!cartId || cart.cartId === cartId)
                && Array.isArray(cart.items) && cart.items.length > 0 && (!bindings.length || cart.items.some(item =>
                  item?.variantId === bindings[0] && Number.isSafeInteger(item.quantity) && item.quantity >= (Number(args.quantity) || 1)
                  && (!serviceSlotTag || item.selectedServiceSlot?.slotId === serviceSlotTag)));
              if (!code && !confirmed) terminal = true;
              addOutcomes.push({ variantId: String(args.variantId ?? ""),
                status: confirmed ? "succeeded" : code && (ADMISSION_ERRORS.has(code) || code.startsWith("food_option_") || code.startsWith("service_slot_") || code.startsWith("service_schedule_")) ? "rejected" : "unknown",
                ...(serviceSlotTag ? { serviceSlotId: serviceSlotTag } : {}),
                ...(code ? { code } : {}) });
            }
            return value;
          });
          attempts.set(tool.name, { key, result });
          return result;
        },
      });
    },
  };
}
