export const DOMAIN_EVENT_BUS = Symbol("DOMAIN_EVENT_BUS");

export interface DomainEvent {
  readonly eventType: string;
  readonly merchantId: string;
  readonly payload: unknown;
}

export type DomainEventHandler<T extends DomainEvent = DomainEvent> = (event: T) => Promise<void>;

export interface DomainEventHandlerRegistration {
  readonly handlerId: string;
  readonly handle: DomainEventHandler;
}

export interface DomainEventBus {
  publish(event: DomainEvent): Promise<void>;
  subscribe(eventType: string, handler: DomainEventHandler, handlerId?: string): void;
  handlersFor(eventType: string): DomainEventHandlerRegistration[];
}
