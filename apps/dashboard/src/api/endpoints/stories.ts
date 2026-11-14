import { dashboardJson } from "../http/client.js";

export interface StoryCategoryDTO {
  id: string;
  merchantId: string;
  name: string;
  coverImage: string | null;
  sortOrder: number;
  isArchived: boolean;
  createdAt: string;
  stories?: StoryDTO[];
}

export interface StoryDTO {
  id: string;
  categoryId: string;
  imageUrl: string;
  title: string | null;
  titleConfig: TitleConfig | null;
  duration: number;
  sortOrder: number;
  isArchived: boolean;
  createdAt: string;
}

export interface TitleConfig {
  font: string;
  fontSize: number;
  color: string;
  hasBg: boolean;
  bgColor: string;
  bgOpacity: number;
  positionX: number;
  positionY: number;
}

export interface CreateStoryCategoryInput {
  name: string;
  coverImage?: string;
}

export interface CreateStoryInput {
  imageUrl: string;
  title?: string;
  titleConfig?: TitleConfig;
  duration?: number;
}

// ─── Categories ───────────────────────────────────────────────────────────

export async function listStoryCategories(apiBaseUrl: string): Promise<StoryCategoryDTO[]> {
  return dashboardJson<StoryCategoryDTO[]>(apiBaseUrl, "/story-manager/categories");
}

export async function createStoryCategory(apiBaseUrl: string, data: CreateStoryCategoryInput): Promise<StoryCategoryDTO> {
  return dashboardJson<StoryCategoryDTO>(apiBaseUrl, "/story-manager/categories", {
    method: "POST",
    jsonBody: data,
  });
}

export async function updateStoryCategory(apiBaseUrl: string, id: string, data: Partial<CreateStoryCategoryInput>): Promise<StoryCategoryDTO> {
  return dashboardJson<StoryCategoryDTO>(apiBaseUrl, `/story-manager/categories/${id}`, {
    method: "PATCH",
    jsonBody: data,
  });
}

export async function archiveStoryCategory(apiBaseUrl: string, id: string): Promise<void> {
  await dashboardJson(apiBaseUrl, `/story-manager/categories/${id}`, { method: "DELETE" });
}

export async function reorderStoryCategories(apiBaseUrl: string, items: { id: string; sortOrder: number }[]): Promise<void> {
  await dashboardJson(apiBaseUrl, "/story-manager/categories/reorder", {
    method: "POST",
    jsonBody: { items },
  });
}

// ─── Stories ──────────────────────────────────────────────────────────────

export async function listStories(apiBaseUrl: string, categoryId: string): Promise<StoryDTO[]> {
  return dashboardJson<StoryDTO[]>(apiBaseUrl, `/story-manager/categories/${categoryId}/stories`);
}

export async function createStory(apiBaseUrl: string, categoryId: string, data: CreateStoryInput): Promise<StoryDTO> {
  return dashboardJson<StoryDTO>(apiBaseUrl, `/story-manager/categories/${categoryId}/stories`, {
    method: "POST",
    jsonBody: data,
  });
}

export async function updateStory(apiBaseUrl: string, id: string, data: Partial<CreateStoryInput & { sortOrder: number }>): Promise<StoryDTO> {
  return dashboardJson<StoryDTO>(apiBaseUrl, `/story-manager/${id}`, {
    method: "PATCH",
    jsonBody: data,
  });
}

export async function archiveStory(apiBaseUrl: string, id: string): Promise<void> {
  await dashboardJson(apiBaseUrl, `/story-manager/${id}`, { method: "DELETE" });
}

export async function reorderStories(apiBaseUrl: string, items: { id: string; sortOrder: number }[]): Promise<void> {
  await dashboardJson(apiBaseUrl, "/story-manager/reorder", {
    method: "POST",
    jsonBody: { items },
  });
}

export async function uploadStoryImage(apiBaseUrl: string, imageBase64: string): Promise<{ url: string }> {
  return dashboardJson<{ url: string }>(apiBaseUrl, "/story-manager/upload", {
    method: "POST",
    jsonBody: { image: imageBase64 },
  });
}
