import { Inject, Injectable } from "@nestjs/common";
import { DOMAIN_EVENT_BUS, type DomainEventBus } from "../events/domain-event-bus.port.js";
import { INFORMATIONAL_EVENT_REDRIVE, INFORMATIONAL_EVENT_AUDIT_HANDLERS,
  informationalEventRedriveInputSchema, type InformationalEventRedriveInput,
  type InformationalEventRedrivePort, type InformationalEventRedriveResult } from "./ports/informational-event-redrive.port.js";

/** Invoked explicitly by privileged operational code after application init.
 * No HTTP/model tool, direct event publish, handler invocation or payment replay. */
@Injectable()
export class RedriveInformationalEventUseCase {
  constructor(@Inject(INFORMATIONAL_EVENT_REDRIVE) private readonly repository: InformationalEventRedrivePort,
    @Inject(DOMAIN_EVENT_BUS) private readonly bus: DomainEventBus) {}

  async execute(raw: InformationalEventRedriveInput): Promise<InformationalEventRedriveResult> {
    const input = informationalEventRedriveInputSchema.parse(raw);
    const handlers = this.bus.handlersFor(input.expectedEventType);
    if (handlers.length !== 1 || handlers[0]!.handlerId !== INFORMATIONAL_EVENT_AUDIT_HANDLERS[input.expectedEventType]
      || typeof handlers[0]!.handle !== "function") throw Error("informational_redrive_handlers_unconfirmed");
    return this.repository.redrive(input, handlers.map(handler => handler.handlerId));
  }
}
