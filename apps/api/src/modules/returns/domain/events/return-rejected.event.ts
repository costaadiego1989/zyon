export class ReturnRejectedEvent {
  readonly type = "return.rejected" as const;

  constructor(
    public readonly returnId: string,
    public readonly merchantId: string,
    public readonly reason: string,
    public readonly occurredAt: Date = new Date(),
  ) {}
}
