export class ReturnRequestedEvent {
  readonly type = "return.requested" as const;

  constructor(
    public readonly returnId: string,
    public readonly merchantId: string,
    public readonly orderId: string,
    public readonly buyerId: string,
    public readonly reason: string,
    public readonly occurredAt: Date = new Date(),
  ) {}
}
