import { Injectable } from "@nestjs/common";
import type { DomainEvent, DomainEventBus, DomainEventHandler } from "./domain-event-bus.port.js";

@Injectable()
export class InMemoryDomainEventBus implements DomainEventBus {
  private readonly handlers = new Map<string, DomainEventHandler[]>();

  async publish(event: DomainEvent): Promise<void> {
    const list = this.handlers.get(event.eventType) ?? [];
    await Promise.all(list.map((h) => h(event)));
  }

  subscribe(eventType: string, handler: DomainEventHandler): void {
    const existing = this.handlers.get(eventType) ?? [];
    this.handlers.set(eventType, [...existing, handler]);
  }
}
