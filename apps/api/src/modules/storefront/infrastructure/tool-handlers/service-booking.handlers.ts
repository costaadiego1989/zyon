import { BadRequestException } from "@nestjs/common";
import { isDeepStrictEqual } from "node:util";
import type { z } from "zod";
import { addBusinessDays, businessDateKey } from "../../../../shared/analytics/business-period.js";
import { validateAvailabilityWindow } from "../../../catalog/domain/services/professional-availability.js";
import { resolveServiceSelection, type CurrentServiceSelectionOption, type CurrentServiceSelectionSnapshot } from "../../../catalog/domain/services/service-selection.js";
import { serviceBookingArgumentSchemas, serviceBookingResultSchema, canonicalServiceProfessionalsSchema, canonicalServiceDatesSchema,
  canonicalServiceSlotsSchema, canonicalServiceReviewSchema, canonicalServiceSelectionSchema, parseCanonicalServiceResult, type ServiceBookingResult } from "../../domain/contracts/service-booking-tool.schemas.js";
import type { ScopedServiceBookingReader, ServiceBookingHandlers } from "../../domain/ports/service-booking-tools.port.js";

const authenticate = { kind: "authentication_required", action: "authenticate" } as const;
function argumentsFor<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input); if (!parsed.success) throw new BadRequestException("invalid_service_booking_arguments"); return parsed.data;
}
const projected = (value: unknown): ServiceBookingResult => parseCanonicalServiceResult(serviceBookingResultSchema, value);
/** Bound readers come only from the private verified transport bridge. None of
 * these tools creates a hold, checkout, token, appointment or payment. */
export function createServiceBookingHandlers(merchantId: string, getReader: () => Promise<ScopedServiceBookingReader | undefined>, clock = () => new Date()): ServiceBookingHandlers {
  return {
    async getServiceProfessionals(input) {
      const args = argumentsFor(serviceBookingArgumentSchemas.get_service_professionals, input), reader = await getReader(); if (!reader) return authenticate;
      const data = parseCanonicalServiceResult(canonicalServiceProfessionalsSchema, await reader.professionals(args));
      const context = { productId: args.productId, variantId: args.variantId, serviceName: await reader.offerName(args) };
      return projected({ kind: "professionals", ...data, context });
    },
    async getServiceDates(input) {
      const args = argumentsFor(serviceBookingArgumentSchemas.get_service_dates, input), reader = await getReader(); if (!reader) return authenticate;
      validateAvailabilityWindow({ fromDate: args.fromDate, toDate: args.toDate, now: clock() });
      const data = parseCanonicalServiceResult(canonicalServiceDatesSchema, await reader.dates(args));
      const context = { productId: args.productId, variantId: args.variantId, serviceName: await reader.offerName(args),
        professional: { id: args.professionalId, version: data.professional_version } };
      return projected({ kind: "dates", ...data, context });
    },
    async getServiceSlots(input) {
      const args = argumentsFor(serviceBookingArgumentSchemas.get_service_slots, input), reader = await getReader(); if (!reader) return authenticate;
      const data = parseCanonicalServiceResult(canonicalServiceSlotsSchema, await reader.slots(args));
      const context = { productId: args.productId, variantId: args.variantId, serviceName: await reader.offerName(args),
        ...(data.selections[0] ? { professional: { id: data.selections[0].professionalId, version: data.selections[0].professionalVersion } } : {}) };
      return projected({ kind: "slots", context, selections: data.selections.slice(0, 100), has_more: data.selections.length > 100 });
    },
    async resolveServiceSelection(input) {
      const args = argumentsFor(serviceBookingArgumentSchemas.resolve_service_selection, input), reader = await getReader(); if (!reader) return authenticate;
      const started = clock();
      if (!(started instanceof Date) || !Number.isFinite(started.getTime())) throw new Error("service_selection_clock_invalid");
      const hints = { kind: "selection" as const, professionalName: args.professionalName, ...(args.date ? { date: args.date } : {}), ...(args.time ? { time: args.time } : {}) };
      const source = parseCanonicalServiceResult(canonicalServiceProfessionalsSchema, await reader.professionals({ productId: args.productId, variantId: args.variantId }));
      const context = { productId: args.productId, variantId: args.variantId, serviceName: await reader.offerName(args) };
      const professionalRoster = { complete: !source.has_more, professionals: source.professionals.map(person => ({ merchantId, productId: args.productId,
        variantId: args.variantId, professionalId: person.id, professionalName: person.name, professionalVersion: person.version })) };
      const snapshot = (options: CurrentServiceSelectionOption[], complete: boolean, at: Date): CurrentServiceSelectionSnapshot => ({ merchantId,
        asOf: at.toISOString(), professionalRoster, complete, options });
      // Professional-name disambiguation precedes any availability lookup. A
      // no-slot professional remains in this canonical roster.
      const preflight = resolveServiceSelection({ merchantId, channel: "text", now: started, interpretation: hints, current: snapshot([], false, started) });
      if (preflight.kind !== "clarification" || !["more_current_options", "choose_date", "choose_time"].includes(preflight.reason) || preflight.professionals.length !== 1)
        return projected({ kind: "selection_resolution", context, resolution: preflight });
      const person = preflight.professionals[0]!;
      const dates = args.date?.kind === "absolute" ? [args.date.value] : args.date?.kind === "relative"
        ? [addBusinessDays(businessDateKey(started), ({ today: 0, tomorrow: 1, day_after_tomorrow: 2 } as const)[args.date.value])]
        : args.date?.kind === "ambiguous" && args.date.values?.length ? [...args.date.values].sort() : undefined;
      const fromDate = dates?.[0] ?? businessDateKey(started), toDate = dates?.at(-1) ?? addBusinessDays(fromDate, 30);
      validateAvailabilityWindow({ fromDate, toDate, now: started });
      const query = { productId: args.productId, variantId: args.variantId, professionalId: person.professionalId };
      const dated = parseCanonicalServiceResult(canonicalServiceDatesSchema, await reader.dates({ ...query, fromDate, toDate }));
      if (dated.professional_version !== person.professionalVersion) throw new Error("service_selection_stale");
      if (!args.date) return projected({ kind: "dates", ...dated, context: { ...context, professional: { id: person.professionalId, version: dated.professional_version, name: person.professionalName } } });
      const selectedDates = dates ? dated.dates.filter(date => dates.includes(date)) : dated.dates;
      const all: z.infer<typeof canonicalServiceSlotsSchema>["selections"] = [];
      for (const date of selectedDates) {
        const slots = parseCanonicalServiceResult(canonicalServiceSlotsSchema, await reader.slots({ ...query, date }));
        all.push(...slots.selections);
      }
      const finished = clock();
      if (args.date.kind === "relative" && businessDateKey(started) !== businessDateKey(finished))
        return projected({ kind: "selection_resolution", context, resolution: resolveServiceSelection({ merchantId, channel: "text", now: finished, interpretation: hints, current: null }) });
      const productName = all.length ? await reader.offerName({ productId: args.productId, variantId: args.variantId }) : "";
      const matching: CurrentServiceSelectionOption[] = [];
      // Complete raw backend reads may exceed one displayed page. Reuse T42's
      // bounded filter in chunks no larger than its20-option projection, then
      // preserve completeness honestly rather than guessing from a page.
      for (let offset = 0; offset < all.length; offset += 20) {
        const options = all.slice(offset, offset + 20).map(value => ({ ...value, merchantId, productName, professionalName: person.professionalName }));
        const part = resolveServiceSelection({ merchantId, channel: "text", now: finished, interpretation: hints, current: snapshot(options, false, finished) });
        if (part.kind !== "clarification" || part.reason === "refresh_current_options") throw new Error("invalid_service_booking_output");
        matching.push(...part.options);
      }
      const resolution = resolveServiceSelection({ merchantId, channel: "text", now: finished, interpretation: hints,
        current: snapshot(matching.slice(0, 100), matching.length <= 100, finished) });
      if (resolution.kind !== "resolved") return projected({ kind: "selection_resolution", context, resolution });
      const selected = parseCanonicalServiceResult(canonicalServiceSelectionSchema, resolution.selection);
      // Public selection remains a local choice. Only an upgraded buyer-bound
      // reader may obtain the private review and parent-cart fingerprint.
      if (!reader.select) return projected({ kind: "slots", context: { ...context,
        professional: { id: person.professionalId, version: person.professionalVersion, name: person.professionalName } },
        selections: [selected], has_more: false });
      const review = parseCanonicalServiceResult(canonicalServiceReviewSchema, await reader.select({ selection: selected }));
      // The canonical select must revalidate the identical current tuple. Its
      // private parent fingerprint never enters the model result.
      if (!isDeepStrictEqual(review.selection, selected)) throw new Error("service_selection_stale");
      return projected({ kind: "selection", selection: review.selection, serviceName: review.service.name, professionalName: review.professional.name,
        context: { productId: review.selection.productId, variantId: review.selection.variantId, serviceName: review.service.name,
          professional: { id: review.selection.professionalId, version: review.selection.professionalVersion, name: review.professional.name } },
        policy: review.policy, action: "review_service_booking", requiresRevalidation: true, authorizesPayment: false, authorizesConfirmation: false });
    },
  };
}
