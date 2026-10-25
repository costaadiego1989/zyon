export class InventoryRestockedEvent {
  readonly type = "return.inventory_restocked" as const;

  constructor(
    public readonly returnId: string,
    public readonly merchantId: string,
    public readonly items: Array<{ variantId: string; quantity: number }>,
    public readonly occurredAt: Date = new Date(),
  ) {}
}
