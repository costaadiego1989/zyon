import { useCallback, useEffect, useState } from "react";
import {
  listStoryCategories,
  createStoryCategory,
  archiveStoryCategory,
  listStories,
  createStory,
  archiveStory,
  uploadStoryImage,
  type StoryCategoryDTO,
  type StoryDTO,
  type TitleConfig,
} from "../api/endpoints/stories.js";

const DEFAULT_TITLE_CONFIG: TitleConfig = {
  font: "inter",
  fontSize: 16,
  color: "#ffffff",
  hasBg: true,
  bgColor: "#000000",
  bgOpacity: 0.6,
  positionX: 50,
  positionY: 80,
};

export interface StoryEditorState {
  imageUrl: string;
  imagePreview: string;
  title: string;
  duration: number;
  titleConfig: TitleConfig;
  uploading: boolean;
}

export function useStoriesPage(apiBaseUrl: string) {
  const [categories, setCategories] = useState<StoryCategoryDTO[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<StoryCategoryDTO | null>(null);
  const [stories, setStories] = useState<StoryDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateCategory, setShowCreateCategory] = useState(false);
  const [showCreateStory, setShowCreateStory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");

  const [editor, setEditor] = useState<StoryEditorState>({
    imageUrl: "",
    imagePreview: "",
    title: "",
    duration: 7,
    titleConfig: { ...DEFAULT_TITLE_CONFIG },
    uploading: false,
  });

  const loadCategories = useCallback(async () => {
    try {
      const cats = await listStoryCategories(apiBaseUrl);
      setCategories(cats);
      setSelectedCategory(prev => {
        if (prev && !cats.some(c => c.id === prev.id)) return cats[0] ?? null;
        if (!prev && cats.length > 0) return cats[0];
        return prev;
      });
    } catch { /* */ }
    setLoading(false);
  }, [apiBaseUrl]);

  const loadStories = useCallback(async () => {
    if (!selectedCategory) { setStories([]); return; }
    try {
      const items = await listStories(apiBaseUrl, selectedCategory.id);
      setStories(items);
    } catch { /* */ }
  }, [apiBaseUrl, selectedCategory]);

  useEffect(() => { loadCategories(); }, [loadCategories]);
  useEffect(() => { loadStories(); }, [loadStories]);

  const handleCreateCategory = async () => {
    if (!newCategoryName.trim()) return;
    try {
      await createStoryCategory(apiBaseUrl, { name: newCategoryName.trim() });
      setNewCategoryName("");
      setShowCreateCategory(false);
      await loadCategories();
    } catch (err) {
      console.error("[Stories] Failed to create category:", err);
      alert("Erro ao criar categoria. Verifique sua conexão.");
    }
  };

  const handleDeleteCategory = async (id: string) => {
    await archiveStoryCategory(apiBaseUrl, id);
    if (selectedCategory?.id === id) setSelectedCategory(null);
    await loadCategories();
  };

  const handleFileUpload = async (file: File) => {
    if (!file.type.startsWith("image/")) return;
    if (file.size > 5 * 1024 * 1024) { alert("Imagem deve ter no máximo 5MB"); return; }

    const reader = new FileReader();
    reader.onload = async (e) => {
      const base64 = e.target?.result as string;
      setEditor((s) => ({ ...s, imagePreview: base64, uploading: true }));
      try {
        const result = await uploadStoryImage(apiBaseUrl, base64);
        setEditor((s) => ({ ...s, imageUrl: result.url, uploading: false }));
      } catch {
        setEditor((s) => ({ ...s, imageUrl: base64, uploading: false }));
      }
    };
    reader.readAsDataURL(file);
  };

  const handleCreateStory = async () => {
    // Use categories from state (which openCreateStory refreshed)
    const cat = selectedCategory ?? categories[0];
    if (!cat || !editor.imageUrl) return;
    try {
      await createStory(apiBaseUrl, cat.id, {
        imageUrl: editor.imageUrl,
        title: editor.title || undefined,
        titleConfig: editor.title ? editor.titleConfig : undefined,
        duration: editor.duration,
      });
      resetEditor();
      setShowCreateStory(false);
      await loadStories();
    } catch (err: any) {
      console.error("[Stories] Create story failed:", err);
      await loadCategories();
      const status = err?.status ?? err?.statusCode;
      if (status === 404) {
        alert("Categoria não encontrada no servidor. A lista foi atualizada — selecione a categoria e tente novamente.");
      } else {
        alert("Erro ao criar story. Verifique os logs do servidor (console da API).");
      }
    }
  };

  const handleDeleteStory = async (id: string) => {
    await archiveStory(apiBaseUrl, id);
    await loadStories();
  };

  const openCreateStory = async () => {
    // Refresh from DB to ensure we have current data
    let freshCats: typeof categories = [];
    try {
      freshCats = await listStoryCategories(apiBaseUrl);
      setCategories(freshCats);
      if (freshCats.length === 0) {
        setSelectedCategory(null);
        alert("Nenhuma categoria disponível. Crie uma categoria primeiro.");
        return;
      }
      // Ensure selectedCategory is valid
      const current = selectedCategory;
      if (!current || !freshCats.some(c => c.id === current.id)) {
        setSelectedCategory(freshCats[0]);
      }
    } catch {
      alert("Erro ao carregar categorias.");
      return;
    }
    resetEditor();
    setShowCreateStory(true);
  };

  const resetEditor = () => {
    setEditor({
      imageUrl: "",
      imagePreview: "",
      title: "",
      duration: 7,
      titleConfig: { ...DEFAULT_TITLE_CONFIG },
      uploading: false,
    });
  };

  const updateEditorField = <K extends keyof StoryEditorState>(key: K, value: StoryEditorState[K]) => {
    setEditor((s) => ({ ...s, [key]: value }));
  };

  const updateTitleConfig = (partial: Partial<TitleConfig>) => {
    setEditor((s) => ({ ...s, titleConfig: { ...s.titleConfig, ...partial } }));
  };

  return {
    // State
    categories,
    selectedCategory,
    stories,
    loading,
    showCreateCategory,
    showCreateStory,
    newCategoryName,
    editor,

    // Actions
    setSelectedCategory,
    setShowCreateCategory,
    setShowCreateStory,
    setNewCategoryName,
    updateEditorField,
    updateTitleConfig,
    handleCreateCategory,
    handleDeleteCategory,
    handleFileUpload,
    handleCreateStory,
    handleDeleteStory,
    openCreateStory,
    resetEditor,
  };
}
