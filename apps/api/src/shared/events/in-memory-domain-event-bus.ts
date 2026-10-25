import { Injectable } from "@nestjs/common";
import type {
  DomainEvent,
  DomainEventBus,
  DomainEventHandler,
  DomainEventHandlerRegistration
} from "./domain-event-bus.port.js";

@Injectable()
export class InMemoryDomainEventBus implements DomainEventBus {
  private readonly handlers = new Map<string, DomainEventHandlerRegistration[]>();

  async publish(event: DomainEvent): Promise<void> {
    const list = this.handlers.get(event.eventType) ?? [];
    await Promise.all(list.map((registration) => registration.handle(event)));
  }

  subscribe(eventType: string, handler: DomainEventHandler, handlerId?: string): void {
    const existing = this.handlers.get(eventType) ?? [];
    const id = handlerId ?? `${eventType}#${existing.length}`;
    this.handlers.set(eventType, [...existing, { handlerId: id, handle: handler }]);
  }

  handlersFor(eventType: string): DomainEventHandlerRegistration[] {
    return [...(this.handlers.get(eventType) ?? [])];
  }
}
