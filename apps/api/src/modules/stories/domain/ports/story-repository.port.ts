export const STORY_REPOSITORY = Symbol("StoryRepository");

export interface StoryRepositoryPort {
  listCategories(merchantId: string): Promise<any[]>;
  createCategory(merchantId: string, data: { name: string; coverImage?: string; sortOrder?: number }): Promise<any>;
  updateCategory(merchantId: string, id: string, data: Partial<{ name: string; coverImage: string; sortOrder: number; isArchived: boolean }>): Promise<any>;
  archiveCategory(merchantId: string, id: string): Promise<void>;
  reorderCategories(merchantId: string, items: { id: string; sortOrder: number }[]): Promise<void>;

  listStories(categoryId: string, merchantId: string): Promise<any[]>;
  createStory(merchantId: string, categoryId: string, data: { imageUrl: string; title?: string; titleConfig?: any; duration?: number; sortOrder?: number }): Promise<any>;
  updateStory(merchantId: string, id: string, data: Partial<{ imageUrl: string; title: string; titleConfig: any; duration: number; sortOrder: number; isArchived: boolean }>): Promise<any>;
  archiveStory(merchantId: string, id: string): Promise<void>;
  reorderStories(merchantId: string, items: { id: string; sortOrder: number }[]): Promise<void>;

  listPublicStories(merchantId: string): Promise<any[]>;
}
