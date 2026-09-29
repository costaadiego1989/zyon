import { describe, expect, it } from "vitest";
import { mapInboxNotification, notificationDate } from "./notification-inbox.js";

describe("merchant notification inbox", () => {
  it("keeps analysis updates and routes strategy notifications to their review", () => {
    expect(mapInboxNotification({ id: "analysis:1", type: "ai_analysis_update", title: "Análise concluída", body: "Veja o resultado da análise semanal." })).toMatchObject({ type: "ai_analysis_update", body: "Veja o resultado da análise semanal." });
    expect(mapInboxNotification({ id: "strategy:1", type: "ai_strategy_suggestion", title: "Nova sugestão", metadata: { strategyId: "strategy-1", hypothesisId: "legacy-1" } })).toMatchObject({ type: "ai_strategy_suggestion", hypothesisId: "strategy-1" });
  });
  it("keeps the inventory product description and navigation metadata", () => {
    expect(mapInboxNotification({ id: "stock:1", type: "inventory_alert", title: "Estoque abaixo do limite", body: "Tênis Azul — 3 unidades disponíveis (SKU-A)", createdAt: "2026-09-24T21:35:00Z", metadata: { inventoryAlertId: "alert-1", itemId: "item-1", sku: "SKU-A" } })).toMatchObject({ body: "Tênis Azul — 3 unidades disponíveis (SKU-A)", inventoryAlertId: "alert-1", inventoryItemId: "item-1", sku: "SKU-A" });
  });
  it("accepts legacy notifications without a body", () => {
    expect(mapInboxNotification({ id: "1", title: "Aviso", type: "plan_expiry" })).toMatchObject({ id: "1", title: "Aviso", type: "plan_expiry", createdAt: "" });
  });
  it.each([null, [], {}, { id: "1" }, { title: "Aviso" }, { id: " ", title: "Aviso" }])("ignores malformed notification %j", value => {
    expect(mapInboxNotification(value)).toBeNull();
  });
  it("treats unfamiliar types as generic messages without trusting malformed fields", () => {
    expect(mapInboxNotification({ id: "1", title: "Aviso", type: "future_type", body: {}, metadata: { itemId: 123, hypothesisId: "hyp-1" } })).toMatchObject({ type: "message", body: undefined, inventoryItemId: undefined, hypothesisId: "hyp-1" });
  });
  it("preserves text without interpreting HTML", () => {
    expect(mapInboxNotification({ id: "1", title: "Aviso", body: '<img src=x onerror="alert(1)">' })?.body).toBe('<img src=x onerror="alert(1)">');
  });
  it("handles missing or invalid timestamps", () => {
    expect(notificationDate("")).toBe("Data indisponível");
    expect(notificationDate("invalid")).toBe("Data indisponível");
    expect(notificationDate("2026-09-24T21:35:00Z")).toContain("24");
  });
});
