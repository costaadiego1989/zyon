import { providerShippingCommandSchema, providerShippingEnvelopeSchema, providerShippingResultSchema,
  providerShippingScopeSchema } from "../../domain/contracts/widget-checkout-provider-shipping.schemas.js";
import type { WidgetCheckoutProviderShippingRepository } from "../../domain/ports/widget-checkout-provider-shipping.port.js";
import type { ReadonlyCheckoutShippingSupplier } from "../../../shipping/domain/ports/readonly-checkout-shipping-supplier.port.js";

/** No retries, detached writes, network-under-tx callbacks or public prices.
 * Repository owns durable SQL authority; these ports/doubles are not SQL proof. */
export class WidgetCheckoutProviderShippingCoordinator {
  constructor(private readonly repository: WidgetCheckoutProviderShippingRepository,
    private readonly supplier: ReadonlyCheckoutShippingSupplier) {}

  async execute(rawScope: unknown, rawCommand: unknown) {
    const scope = providerShippingScopeSchema.parse(rawScope), command = providerShippingCommandSchema.parse(rawCommand);
    // A lost begin ACK MUST escape before supplier dispatch; never catch/retry it.
    const started = await this.repository.begin(scope, command);
    const pending = providerShippingEnvelopeSchema.parse(started.pending);
    if (pending.state !== "pending" || pending.sources.merchantId !== scope.merchantId
      || pending.sources.sessionId !== scope.sessionId || pending.persistenceVersion !== command.expectedVersion + 1
      || pending.requestId !== started.dispatch.requestId || pending.sources.mode !== started.dispatch.mode
      || pending.sources.merchantId !== started.dispatch.merchantId || pending.expiresAt !== started.dispatch.expiresAt
      || pending.sources.originZip !== started.dispatch.originZip || pending.sources.destinationZip !== started.dispatch.destinationZip
      || pending.sources.metadataHash !== started.dispatch.metadataHash) throw Error("widget_checkout_provider_shipping_review_required");
    let result;
    try {
      result = providerShippingResultSchema.parse(await this.supplier.quote(structuredClone(started.dispatch)));
      if (result.requestId !== pending.requestId || result.mode !== pending.sources.mode) throw Error("provider_result_mismatch");
    } catch {
      // Repository rereads sources/state and CASes this exact pending UUID only.
      // Unknown is durable, no callback/late completion can promote it afterward.
      const unknown = providerShippingEnvelopeSchema.parse(await this.repository.markUnknown(scope, pending.requestId));
      if (unknown.state !== "unknown" || unknown.requestId !== pending.requestId) throw Error("widget_checkout_provider_shipping_review_required");
      return unknown;
    }
    // Lost completion ACK propagates. It must never cause redispatch/compensation.
    const completed = providerShippingEnvelopeSchema.parse(await this.repository.complete(scope, pending.requestId, result));
    if (completed.state !== "completed" || completed.requestId !== pending.requestId) throw Error("widget_checkout_provider_shipping_review_required");
    return completed;
  }
}
