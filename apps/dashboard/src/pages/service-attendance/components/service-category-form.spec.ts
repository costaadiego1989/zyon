import { describe, expect, it } from "vitest";
import type { Product } from "../../../api-client.js";
import type { ServiceCategoryDTO } from "../../../api/endpoints/service-attendance.js";
import { categoryFormPayload, categoryParentOptions, publishedServices } from "./service-category-form.js";

const category = (id: string, parent_id: string | null = null): ServiceCategoryDTO => ({ id, name: id, slug: id, parent_id, description: null, image_url: null, is_active: true, sort_order: 0, created_at: "2026-11-16T12:00:00Z", updated_at: "2026-11-16T12:00:00Z" });

describe("T77 category contract criteria", () => {
  it("maps the existing create form to the canonical category SDK without another tenant or price field", () => {
    expect(categoryFormPayload("create", { name: "Consulta", slug: "consulta", parent_id: "parent-a", description: "Atendimentos", image_url: "https://example.test/image.png" })).toEqual({ name: "Consulta", slug: "consulta", parentId: "parent-a", description: "Atendimentos", imageUrl: "https://example.test/image.png" });
  });
  it("preserves explicit parent removal for the corrected SDK wire alias", () => {
    expect(categoryFormPayload("edit", { name: "Consulta", parent_id: null, description: "", image_url: "" })).toEqual({ name: "Consulta", parentId: null, description: "", imageUrl: "" });
  });
  it("does not introduce parent removal or a slug update when the existing update input omits them", () => {
    expect(categoryFormPayload("edit", { name: "Consulta" })).toEqual({ name: "Consulta" });
  });
  it("offers every known category as a parent when creating", () => {
    const rows = [category("a"), category("b", "a")]; expect(categoryParentOptions(rows, null).map(row => row.id)).toEqual(["a", "b"]);
  });
  it("excludes the edited category and every descendant from parent choices", () => {
    expect(categoryParentOptions([category("a"), category("b", "a"), category("c", "b"), category("d")], "a").map(row => row.id)).toEqual(["d"]);
  });
  it("terminates an existing parent cycle and still excludes its descendant choices", () => {
    expect(categoryParentOptions([category("a", "b"), category("b", "a"), category("c")], "a").map(row => row.id)).toEqual(["c"]);
  });
  it("accepts only published canonical service offers from the authenticated merchant", () => {
    const row = (id: string, extra: Partial<Product> = {}) => ({ id, name: id, type: "service", merchantId: "merchant-a", isActive: true, variants: [], createdAt: "", updatedAt: "", ...extra });
    expect(publishedServices([row("service-a"), row("physical", { type: "physical" }), row("inactive", { isActive: false }), row("foreign", { merchantId: "merchant-b" })], "merchant-a").map(service => service.id)).toEqual(["service-a"]);
  });
});
