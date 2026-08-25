import test from "node:test";
import assert from "node:assert/strict";
import type {
  InventoryRepositoryPort,
  InventoryItemRow,
  InventoryListFilter,
  InventorySummary,
} from "../domain/ports/inventory-repository.port.js";
import type {
  InventoryMovementRepositoryPort,
  MovementRow,
  MovementListFilter,
} from "../domain/ports/inventory-movement-repository.port.js";
import type {
  InventoryAlertRepositoryPort,
  AlertRow,
} from "../domain/ports/inventory-alert-repository.port.js";
import type {
  InventoryLocationRepositoryPort,
  LocationRow,
} from "../domain/ports/inventory-location-repository.port.js";
import { computeStockStatus } from "../domain/values/stock-status.js";

// ─── In-Memory Repos (test doubles) ─────────────────────────────────────────

class InMemoryInventoryRepository implements InventoryRepositoryPort {
  private items: InventoryItemRow[] = [];

  async list(filter: InventoryListFilter) {
    let result = this.items.filter((i) => i.merchantId === filter.merchantId);
    if (filter.locationId) result = result.filter((i) => i.locationId === filter.locationId);
    if (filter.search) {
      const q = filter.search.toLowerCase();
      result = result.filter((i) => i.sku.toLowerCase().includes(q) || i.productName.toLowerCase().includes(q));
    }
    if (filter.status) {
      result = result.filter((i) => computeStockStatus(i.quantity, i.reserved, i.lowStockThreshold) === filter.status);
    }
    const page = filter.page ?? 1;
    const pageSize = filter.pageSize ?? 10;
    return { items: result.slice((page - 1) * pageSize, page * pageSize), total: result.length };
  }

  async findById(merchantId: string, id: string) {
    return this.items.find((i) => i.merchantId === merchantId && i.id === id) ?? null;
  }

  async findBySku(merchantId: string, sku: string, locationId: string) {
    return this.items.find((i) => i.merchantId === merchantId && i.sku === sku && i.locationId === locationId) ?? null;
  }

  async upsert(merchantId: string, data: { sku: string; productName: string; variantName?: string; locationId: string; quantity: number; avgCostCents?: number }) {
    const existing = await this.findBySku(merchantId, data.sku, data.locationId);
    if (existing) {
      existing.quantity = data.quantity;
      existing.productName = data.productName;
      if (data.avgCostCents != null) existing.avgCostCents = data.avgCostCents;
      return existing;
    }
    const item: InventoryItemRow = {
      id: `inv_${this.items.length + 1}`,
      merchantId,
      sku: data.sku,
      productName: data.productName,
      variantName: data.variantName ?? null,
      locationId: data.locationId,
      locationName: "Default",
      quantity: data.quantity,
      reserved: 0,
      reorderPoint: null,
      lowStockThreshold: null,
      avgCostCents: data.avgCostCents ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.items.push(item);
    return item;
  }

  async adjustQuantity(merchantId: string, itemId: string, delta: number) {
    const item = this.items.find((i) => i.merchantId === merchantId && i.id === itemId);
    if (!item) throw new Error("not_found");
    item.quantity += delta;
    if (item.quantity < 0) item.quantity = 0;
    return item;
  }

  async adjustReserved(merchantId: string, itemId: string, delta: number) {
    const item = this.items.find((i) => i.merchantId === merchantId && i.id === itemId);
    if (!item) throw new Error("not_found");
    item.reserved += delta;
    return item;
  }

  async setReorderPoint(merchantId: string, itemId: string, point: number) {
    const item = this.items.find((i) => i.merchantId === merchantId && i.id === itemId);
    if (item) item.reorderPoint = point;
  }

  async setLowStockThreshold(merchantId: string, itemId: string, threshold: number) {
    const item = this.items.find((i) => i.merchantId === merchantId && i.id === itemId);
    if (item) item.lowStockThreshold = threshold;
  }

  async getSummary(merchantId: string): Promise<InventorySummary> {
    const items = this.items.filter((i) => i.merchantId === merchantId);
    const lowStockCount = items.filter((i) => computeStockStatus(i.quantity, i.reserved, i.lowStockThreshold) === "low_stock").length;
    const outOfStockCount = items.filter((i) => computeStockStatus(i.quantity, i.reserved, i.lowStockThreshold) === "out_of_stock").length;
    const totalValueCents = items.reduce((sum, i) => sum + (i.quantity * (i.avgCostCents ?? 0)), 0);
    return { totalSkus: items.length, lowStockCount, outOfStockCount, totalValueCents };
  }

  async findItemsBelowThreshold(merchantId: string) {
    return this.items.filter((i) => {
      if (i.merchantId !== merchantId) return false;
      if (i.lowStockThreshold == null) return false;
      return (i.quantity - i.reserved) <= i.lowStockThreshold;
    });
  }

  seed(item: InventoryItemRow) { this.items.push(item); }
}

class InMemoryMovementRepository implements InventoryMovementRepositoryPort {
  private movements: MovementRow[] = [];

  async record(data: { merchantId: string; itemId: string; kind: string; quantity: number; reason?: string; externalRef?: string; source?: string; actorUserId?: string }) {
    const row: MovementRow = {
      id: `mov_${this.movements.length + 1}`,
      merchantId: data.merchantId,
      itemId: data.itemId,
      kind: data.kind,
      quantity: data.quantity,
      reason: data.reason ?? null,
      externalRef: data.externalRef ?? null,
      source: data.source ?? "native",
      actorUserId: data.actorUserId ?? null,
      createdAt: new Date(),
    };
    this.movements.push(row);
    return row;
  }

  async list(filter: MovementListFilter) {
    let result = this.movements.filter((m) => m.merchantId === filter.merchantId);
    if (filter.itemId) result = result.filter((m) => m.itemId === filter.itemId);
    if (filter.kind) result = result.filter((m) => m.kind === filter.kind);
    const page = filter.page ?? 1;
    const pageSize = filter.pageSize ?? 10;
    return { movements: result.slice((page - 1) * pageSize, page * pageSize), total: result.length };
  }

  count() { return this.movements.length; }
}

class InMemoryAlertRepository implements InventoryAlertRepositoryPort {
  private alerts: AlertRow[] = [];

  async create(data: { merchantId: string; itemId: string; severity: string; message: string }) {
    const row: AlertRow = {
      id: `alert_${this.alerts.length + 1}`,
      merchantId: data.merchantId,
      itemId: data.itemId,
      severity: data.severity,
      message: data.message,
      acknowledged: false,
      createdAt: new Date(),
      acknowledgedAt: null,
    };
    this.alerts.push(row);
    return row;
  }

  async list(merchantId: string, acknowledged?: boolean) {
    return this.alerts.filter((a) => {
      if (a.merchantId !== merchantId) return false;
      if (acknowledged != null) return a.acknowledged === acknowledged;
      return true;
    });
  }

  async acknowledge(merchantId: string, alertId: string) {
    const alert = this.alerts.find((a) => a.merchantId === merchantId && a.id === alertId);
    if (alert) {
      alert.acknowledged = true;
      alert.acknowledgedAt = new Date();
    }
  }

  async existsOpen(merchantId: string, itemId: string, severity: string) {
    return this.alerts.some((a) => a.merchantId === merchantId && a.itemId === itemId && a.severity === severity && !a.acknowledged);
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

test("computeStockStatus — in_stock when available > threshold", () => {
  assert.equal(computeStockStatus(100, 10, 5), "in_stock");
});

test("computeStockStatus — low_stock when available <= threshold", () => {
  assert.equal(computeStockStatus(10, 7, 5), "low_stock");
});

test("computeStockStatus — out_of_stock when available <= 0", () => {
  assert.equal(computeStockStatus(5, 5, null), "out_of_stock");
  assert.equal(computeStockStatus(0, 0, null), "out_of_stock");
});

test("computeStockStatus — no threshold → never low_stock", () => {
  assert.equal(computeStockStatus(1, 0, null), "in_stock");
});

test("InventoryRepository — upsert creates new item", async () => {
  const repo = new InMemoryInventoryRepository();
  const item = await repo.upsert("mrc_1", { sku: "SKU-001", productName: "Camiseta P", locationId: "loc_1", quantity: 50, avgCostCents: 2500 });
  assert.equal(item.sku, "SKU-001");
  assert.equal(item.quantity, 50);
  assert.equal(item.avgCostCents, 2500);
});

test("InventoryRepository — upsert updates existing item", async () => {
  const repo = new InMemoryInventoryRepository();
  await repo.upsert("mrc_1", { sku: "SKU-001", productName: "Camiseta P", locationId: "loc_1", quantity: 50 });
  const updated = await repo.upsert("mrc_1", { sku: "SKU-001", productName: "Camiseta P Updated", locationId: "loc_1", quantity: 75 });
  assert.equal(updated.quantity, 75);
  assert.equal(updated.productName, "Camiseta P Updated");
});

test("InventoryRepository — adjustQuantity adds delta", async () => {
  const repo = new InMemoryInventoryRepository();
  const item = await repo.upsert("mrc_1", { sku: "SKU-001", productName: "Camiseta", locationId: "loc_1", quantity: 50 });
  const adjusted = await repo.adjustQuantity("mrc_1", item.id, -10);
  assert.equal(adjusted.quantity, 40);
});

test("InventoryRepository — adjustQuantity floors at 0", async () => {
  const repo = new InMemoryInventoryRepository();
  const item = await repo.upsert("mrc_1", { sku: "SKU-001", productName: "Camiseta", locationId: "loc_1", quantity: 5 });
  const adjusted = await repo.adjustQuantity("mrc_1", item.id, -100);
  assert.equal(adjusted.quantity, 0);
});

test("InventoryRepository — getSummary computes correctly", async () => {
  const repo = new InMemoryInventoryRepository();
  await repo.upsert("mrc_1", { sku: "SKU-001", productName: "A", locationId: "loc_1", quantity: 50, avgCostCents: 1000 });
  await repo.upsert("mrc_1", { sku: "SKU-002", productName: "B", locationId: "loc_1", quantity: 0, avgCostCents: 2000 });
  const summary = await repo.getSummary("mrc_1");
  assert.equal(summary.totalSkus, 2);
  assert.equal(summary.outOfStockCount, 1);
  assert.equal(summary.totalValueCents, 50 * 1000 + 0 * 2000);
});

test("InventoryRepository — list filters by status", async () => {
  const repo = new InMemoryInventoryRepository();
  const item1 = await repo.upsert("mrc_1", { sku: "SKU-001", productName: "A", locationId: "loc_1", quantity: 50 });
  const item2 = await repo.upsert("mrc_1", { sku: "SKU-002", productName: "B", locationId: "loc_1", quantity: 0 });
  await repo.setLowStockThreshold("mrc_1", item1.id, 5);

  const inStock = await repo.list({ merchantId: "mrc_1", status: "in_stock" });
  assert.equal(inStock.items.length, 1);
  assert.equal(inStock.items[0]!.sku, "SKU-001");

  const outOfStock = await repo.list({ merchantId: "mrc_1", status: "out_of_stock" });
  assert.equal(outOfStock.items.length, 1);
  assert.equal(outOfStock.items[0]!.sku, "SKU-002");
});

test("InventoryRepository — list filters by search", async () => {
  const repo = new InMemoryInventoryRepository();
  await repo.upsert("mrc_1", { sku: "SKU-BLUE-001", productName: "Camiseta Azul", locationId: "loc_1", quantity: 10 });
  await repo.upsert("mrc_1", { sku: "SKU-RED-002", productName: "Calça Vermelha", locationId: "loc_1", quantity: 5 });

  const result = await repo.list({ merchantId: "mrc_1", search: "azul" });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0]!.sku, "SKU-BLUE-001");
});

test("MovementRepository — record creates movement", async () => {
  const repo = new InMemoryMovementRepository();
  const mov = await repo.record({ merchantId: "mrc_1", itemId: "inv_1", kind: "ENTRY", quantity: 50, reason: "Compra fornecedor", source: "native" });
  assert.equal(mov.kind, "ENTRY");
  assert.equal(mov.quantity, 50);
  assert.equal(mov.source, "native");
  assert.equal(repo.count(), 1);
});

test("MovementRepository — list filters by kind", async () => {
  const repo = new InMemoryMovementRepository();
  await repo.record({ merchantId: "mrc_1", itemId: "inv_1", kind: "ENTRY", quantity: 50 });
  await repo.record({ merchantId: "mrc_1", itemId: "inv_1", kind: "EXIT", quantity: -10 });
  await repo.record({ merchantId: "mrc_1", itemId: "inv_1", kind: "ENTRY", quantity: 20 });

  const entries = await repo.list({ merchantId: "mrc_1", kind: "ENTRY" });
  assert.equal(entries.total, 2);

  const exits = await repo.list({ merchantId: "mrc_1", kind: "EXIT" });
  assert.equal(exits.total, 1);
});

test("AlertRepository — create + list open", async () => {
  const repo = new InMemoryAlertRepository();
  await repo.create({ merchantId: "mrc_1", itemId: "inv_1", severity: "low", message: "Estoque baixo: SKU-001 (3 un.)" });
  await repo.create({ merchantId: "mrc_1", itemId: "inv_2", severity: "critical", message: "Sem estoque: SKU-002" });

  const open = await repo.list("mrc_1", false);
  assert.equal(open.length, 2);
});

test("AlertRepository — acknowledge marks as acknowledged", async () => {
  const repo = new InMemoryAlertRepository();
  const alert = await repo.create({ merchantId: "mrc_1", itemId: "inv_1", severity: "low", message: "Estoque baixo" });

  await repo.acknowledge("mrc_1", alert.id);

  const open = await repo.list("mrc_1", false);
  assert.equal(open.length, 0);

  const all = await repo.list("mrc_1");
  assert.equal(all.length, 1);
  assert.equal(all[0]!.acknowledged, true);
});

test("AlertRepository — existsOpen prevents duplicate alerts", async () => {
  const repo = new InMemoryAlertRepository();
  await repo.create({ merchantId: "mrc_1", itemId: "inv_1", severity: "low", message: "Estoque baixo" });

  const exists = await repo.existsOpen("mrc_1", "inv_1", "low");
  assert.equal(exists, true);

  const notExists = await repo.existsOpen("mrc_1", "inv_1", "critical");
  assert.equal(notExists, false);
});

test("InventoryRepository — findItemsBelowThreshold detects low stock", async () => {
  const repo = new InMemoryInventoryRepository();
  const item1 = await repo.upsert("mrc_1", { sku: "SKU-001", productName: "A", locationId: "loc_1", quantity: 3 });
  await repo.setLowStockThreshold("mrc_1", item1.id, 5);
  const item2 = await repo.upsert("mrc_1", { sku: "SKU-002", productName: "B", locationId: "loc_1", quantity: 50 });
  await repo.setLowStockThreshold("mrc_1", item2.id, 10);

  const belowThreshold = await repo.findItemsBelowThreshold("mrc_1");
  assert.equal(belowThreshold.length, 1);
  assert.equal(belowThreshold[0]!.sku, "SKU-001");
});

test("Multi-tenant isolation — merchant A cannot see merchant B items", async () => {
  const repo = new InMemoryInventoryRepository();
  await repo.upsert("mrc_A", { sku: "SKU-001", productName: "Item A", locationId: "loc_1", quantity: 10 });
  await repo.upsert("mrc_B", { sku: "SKU-001", productName: "Item B", locationId: "loc_1", quantity: 20 });

  const resultA = await repo.list({ merchantId: "mrc_A" });
  assert.equal(resultA.total, 1);
  assert.equal(resultA.items[0]!.productName, "Item A");

  const resultB = await repo.list({ merchantId: "mrc_B" });
  assert.equal(resultB.total, 1);
  assert.equal(resultB.items[0]!.productName, "Item B");
});

test("Multi-tenant isolation — summary scoped per merchant", async () => {
  const repo = new InMemoryInventoryRepository();
  await repo.upsert("mrc_A", { sku: "SKU-001", productName: "A", locationId: "loc_1", quantity: 10, avgCostCents: 100 });
  await repo.upsert("mrc_B", { sku: "SKU-001", productName: "B", locationId: "loc_1", quantity: 0, avgCostCents: 200 });

  const summaryA = await repo.getSummary("mrc_A");
  assert.equal(summaryA.totalSkus, 1);
  assert.equal(summaryA.outOfStockCount, 0);

  const summaryB = await repo.getSummary("mrc_B");
  assert.equal(summaryB.totalSkus, 1);
  assert.equal(summaryB.outOfStockCount, 1);
});
