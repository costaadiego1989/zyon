import { z } from "zod";
import { serviceBookingArgumentSchemas, serviceBookingResultSchema, parseCanonicalServiceResult, type ServiceBookingToolName } from "../contracts/service-booking-tool.schemas.js";
import type { ServiceBookingHandlers } from "../ports/service-booking-tools.port.js";
import type { ExecutableTool, ToolDefinition, ToolResult } from "./types.js";

const methods = { get_service_professionals: "getServiceProfessionals", get_service_dates: "getServiceDates",
  get_service_slots: "getServiceSlots", resolve_service_selection: "resolveServiceSelection" } as const;
const descriptions: Record<ServiceBookingToolName, string> = {
  get_service_professionals: "List current eligible professionals for a service, including source completeness. This does not assert availability.",
  get_service_dates: "Read current dates from the canonical booking reader for the chosen professional. Never infer dates from embeddings.",
  get_service_slots: "Read current canonical dated slots, current prices and versions. A slot is not reserved or confirmed.",
  resolve_service_selection: "Resolve the buyer's professional-name/date/time hints using the complete current roster and canonical slots. Ask when ambiguous. Returns a review proposal only; cannot prepare, confirm or pay.",
};
/** Separate optional registry keeps the legacy product definitions/contracts
 * unchanged. A private service binding is required before advertisement. */
export function serviceBookingDefinitions(handlers?: ServiceBookingHandlers): ToolDefinition[] {
  if (!handlers) return [];
  return (Object.keys(methods) as ServiceBookingToolName[]).map(name => {
    const schema = z.toJSONSchema(serviceBookingArgumentSchemas[name], { target: "draft-7" });
    return { name, description: descriptions[name], parameters: { ...schema, type: "object", additionalProperties: false,
      properties: schema.properties ?? {} } } as ToolDefinition;
  });
}
export function createServiceBookingTools(handlers?: ServiceBookingHandlers): ExecutableTool[] {
  if (!handlers) return [];
  return (Object.keys(methods) as ServiceBookingToolName[]).map(name => ({ name, execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const parsed = serviceBookingArgumentSchemas[name].safeParse(args);
    if (!parsed.success) return { ok: false, error: "invalid_tool_arguments", code: "invalid_tool_arguments" };
    try {
      const raw = await handlers[methods[name]](parsed.data);
      return { ok: true, data: parseCanonicalServiceResult(serviceBookingResultSchema, raw) };
    } catch { return { ok: false, error: "service_booking_unconfirmed", code: "service_booking_unconfirmed" }; }
  } }));
}
