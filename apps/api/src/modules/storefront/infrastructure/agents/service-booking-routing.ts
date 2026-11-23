import type { ServiceBookingHandlers } from "../../domain/ports/service-booking-tools.port.js";
import { serviceBookingResultSchema, type ServiceBookingResult } from "../../domain/contracts/service-booking-tool.schemas.js";
import type { ToolResult } from "../../domain/tools/types.js";

/** Classification routes read/proposal tools only. The private bridge still
 * verifies actual credentials per call; this hint grants no business authority. */
export function operationalServiceTurn(classification: { domain: string; requiresTool: boolean; needsProductDiscovery: boolean;
  serviceRequest?: string | null; serviceAction?: "browse" | "select" | null }, handlers: ServiceBookingHandlers | undefined): boolean {
  return handlers !== undefined && classification.domain === "STORE_COMMERCE" && classification.requiresTool
    && !classification.needsProductDiscovery && classification.serviceRequest !== "professional_decision"
    && (classification.serviceAction === "browse" || classification.serviceAction === "select");
}
const serviceNames = new Set(["get_service_professionals", "get_service_dates", "get_service_slots", "resolve_service_selection"]);
const allowedReads = new Set([...serviceNames, "search_products", "get_product_details", "list_categories"]);
export const isServiceBookingTool = (name: string) => serviceNames.has(name);
export function serviceOperationalTools<T extends { name: string }>(tools: T[]): T[] { return tools.filter(tool => allowedReads.has(tool.name)); }

/** Deterministic presentation ends the service turn. A model may not narrate a
 * proposed slot as a confirmed appointment or a successful payment. T45 renders
 * the typed data and invokes the existing gesture endpoints separately. */
export function presentServiceBookingResult(result: ToolResult): { message: string; data?: ServiceBookingResult } {
  const parsed = result.ok ? serviceBookingResultSchema.safeParse(result.data) : undefined;
  if (!parsed?.success) return { message: "Ainda não consegui confirmar os horários. Tente consultar as opções novamente." };
  const data = parsed.data;
  if (data.kind === "authentication_required") return { message: "Entre na sua conta para consultar os horários e continuar o agendamento.", data };
  if (data.kind === "professionals") return { message: "Escolha o profissional que deseja consultar.", data };
  if (data.kind === "dates") return { message: "Escolha uma das datas disponíveis.", data };
  if (data.kind === "slots") return { message: "Veja os horários disponíveis. Sua escolha será conferida antes da confirmação.", data };
  if (data.kind === "selection") return { message: "Confira o serviço, o profissional, a data, o horário e o valor antes de continuar. O agendamento ainda não foi confirmado.", data };
  const reason = data.resolution.kind === "clarification" ? data.resolution.reason : undefined;
  const message = reason === "choose_professional" ? "Encontrei profissionais com esse nome. Escolha a pessoa que deseja consultar."
    : reason === "choose_date" ? "Para continuar, escolha uma data entre as opções atuais."
      : reason === "choose_time" ? "Para continuar, escolha o horário que deseja."
        : reason === "more_current_professionals" ? "A lista de profissionais ainda está incompleta. Escolha uma opção atual para continuar."
          : reason === "more_current_options" ? "Há mais opções. Informe a data ou o horário para refinar a escolha."
            : reason === "no_current_match" ? "Não encontrei um horário atual que corresponda a essa escolha. Podemos consultar outras opções."
              : "Confira as opções atuais antes de continuar o agendamento.";
  return { message, data };
}
