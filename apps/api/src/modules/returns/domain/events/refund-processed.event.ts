export class RefundProcessedEvent {
  readonly type = "return.refund_processed" as const;

  constructor(
    public readonly returnId: string,
    public readonly merchantId: string,
    public readonly amountInCents: number,
    public readonly occurredAt: Date = new Date(),
  ) {}
}
