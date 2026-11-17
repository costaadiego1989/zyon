import type { Product } from "../../../api-client.js";
import type { CreateCategoryInput, UpdateCategoryInput } from "../../../api/endpoints/catalog.js";
import type { ServiceCategoryCreate, ServiceCategoryDTO, ServiceCategoryUpdate } from "../../../api/endpoints/service-attendance.js";

export function categoryFormPayload(mode: "create", data: CreateCategoryInput): ServiceCategoryCreate;
export function categoryFormPayload(mode: "edit", data: UpdateCategoryInput): ServiceCategoryUpdate;
export function categoryFormPayload(mode: "create" | "edit", data: CreateCategoryInput | UpdateCategoryInput): ServiceCategoryCreate | ServiceCategoryUpdate {
  const input: ServiceCategoryUpdate & { slug?: string } = {};
  if (data.name !== undefined) input.name = data.name;
  if (data.description !== undefined) input.description = data.description;
  if (data.image_url !== undefined) input.imageUrl = data.image_url;
  if (data.parent_id !== undefined) input.parentId = data.parent_id;
  if (mode === "create" && "slug" in data && data.slug !== undefined) input.slug = data.slug;
  return mode === "create" ? { ...input, name: data.name! } as ServiceCategoryCreate : input;
}

export function categoryParentOptions<T extends ServiceCategoryDTO>(rows: T[], editingId: string | null): T[] {
  if (!editingId) return rows;
  const excluded = new Set([editingId]), pending = [editingId];
  while (pending.length) {
    const parent = pending.pop()!;
    for (const row of rows) if (row.parent_id === parent && !excluded.has(row.id)) { excluded.add(row.id); pending.push(row.id); }
  }
  return rows.filter(row => !excluded.has(row.id));
}

export function publishedServices(rows: Product[], merchantId: string): Product[] {
  return rows.filter(row => row.type === "service" && row.isActive && row.merchantId === merchantId);
}
