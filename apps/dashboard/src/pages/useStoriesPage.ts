import { useCallback, useEffect, useRef, useState } from "react";
import {
  listStoryCategories,
  createStoryCategory,
  updateStoryCategory,
  archiveStoryCategory,
  listStories,
  createStory,
  updateStory,
  archiveStory,
  uploadStoryImage,
  type StoryCategoryDTO,
  type StoryDTO,
  type TitleConfig,
  type CreateStoryInput,
} from "../api/endpoints/stories.js";
import { reportError } from "../lib/observability/error-reporter.js";
import { changedFields } from "../lib/config-patch.js";

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

export function storyEditorPatch(current: StoryEditorState, initial: StoryEditorState, hasSavedTitleConfig = true): Partial<CreateStoryInput> {
  const persisted = (value: StoryEditorState) => ({ imageUrl: value.imageUrl,
    title: value.title, titleConfig: value.titleConfig, duration: value.duration });
  const patch = changedFields(persisted(current), persisted(initial));
  // The story API replaces titleConfig; unlike checkout policies it is not a
  // nested merge. Send the complete style only when the user edits its style.
  if (patch.titleConfig || (!hasSavedTitleConfig && patch.title?.trim())) patch.titleConfig = current.titleConfig;
  return patch;
}

import { showToast } from "../components/Toast.js";

export function useStoriesPage(apiBaseUrl: string) {
  const [categories, setCategories] = useState<StoryCategoryDTO[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<StoryCategoryDTO | null>(null);
  const [stories, setStories] = useState<StoryDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [storiesLoading, setStoriesLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [storiesError, setStoriesError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showCreateCategory, setShowCreateCategory] = useState(false);
  const [showCreateStory, setShowCreateStory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [initialCategoryName, setInitialCategoryName] = useState("");
  const [editingStoryId, setEditingStoryId] = useState<string | null>(null);
  const emptyEditor = (): StoryEditorState => ({ imageUrl: "", imagePreview: "", title: "", duration: 7, titleConfig: { ...DEFAULT_TITLE_CONFIG }, uploading: false });
  const [editor, setEditor] = useState<StoryEditorState>(emptyEditor);
  const [initialEditor, setInitialEditor] = useState<StoryEditorState>(emptyEditor);
  const [hasSavedTitleConfig, setHasSavedTitleConfig] = useState(true);
  const categoryDirty = newCategoryName !== initialCategoryName;
  const storyDirty = JSON.stringify({ ...editor, uploading: false }) !== JSON.stringify({ ...initialEditor, uploading: false });
  const working = useRef(false);
  const uploading = useRef(false);
  const storyRequest = useRef(0);
  const loadCategories = useCallback(async () => {
    setLoading(true); setLoadError(null);
    try { const cats = await listStoryCategories(apiBaseUrl); setCategories(cats); setSelectedCategory(current => cats.find(cat => cat.id === current?.id) ?? cats[0] ?? null); }
    catch (error) { setLoadError("Não foi possível carregar as categorias de stories. Tente novamente."); reportError({ source: "stories.loadCategories", error, severity: "warning" }); }
    finally { setLoading(false); }
  }, [apiBaseUrl]);
  const loadStories = useCallback(async () => {
    const request = ++storyRequest.current;
    if (!selectedCategory) { setStories([]); setStoriesLoading(false); return; }
    setStoriesLoading(true); setStoriesError(null); setStories([]);
    try { const items = await listStories(apiBaseUrl, selectedCategory.id); if (request === storyRequest.current) setStories(items); }
    catch (error) { if (request === storyRequest.current) setStoriesError("Não foi possível carregar os stories desta categoria. Tente novamente."); reportError({ source: "stories.loadStories", error, severity: "warning" }); }
    finally { if (request === storyRequest.current) setStoriesLoading(false); }
  }, [apiBaseUrl, selectedCategory]);
  useEffect(() => { void loadCategories(); }, [loadCategories]);
  useEffect(() => { void loadStories(); return () => { storyRequest.current += 1; }; }, [loadStories]);
  async function mutate(action: () => Promise<void>, message: string): Promise<boolean> {
    if (working.current || uploading.current) return false;
    working.current = true; setBusy(true); setActionError(null);
    try { await action(); return true; }
    catch (error) { setActionError(message); reportError({ source: "stories.update", error, severity: "warning" }); return false; }
    finally { working.current = false; setBusy(false); }
  }
  const handleCreateCategory = async () => {
    if (!newCategoryName.trim()) return false;
    if (editingCategoryId) return mutate(async () => {
      const updated = await updateStoryCategory(apiBaseUrl, editingCategoryId, { name: newCategoryName.trim() });
      setCategories(current => current.map(category => category.id === updated.id ? updated : category));
      setSelectedCategory(current => current?.id === updated.id ? updated : current);
      setNewCategoryName(""); setInitialCategoryName(""); setEditingCategoryId(null); setShowCreateCategory(false);
      showToast("success", "Categoria atualizada.");
    }, "Não foi possível atualizar a categoria. O nome foi preservado para você tentar novamente.");
    return mutate(async () => { const created = await createStoryCategory(apiBaseUrl, { name: newCategoryName.trim() }); setCategories(current => [...current, created]); setSelectedCategory(created); setNewCategoryName(""); setShowCreateCategory(false); showToast("success", "Categoria criada."); }, "Não foi possível criar a categoria. O nome foi preservado para você tentar novamente.");
  };
  const handleDeleteCategory = (id: string) => mutate(async () => {
    await archiveStoryCategory(apiBaseUrl, id); const remaining = categories.filter(cat => cat.id !== id); setCategories(remaining); if (selectedCategory?.id === id) { storyRequest.current += 1; setStories([]); setSelectedCategory(remaining[0] ?? null); } showToast("success", "Categoria removida.");
  }, "Não foi possível remover a categoria. Tente novamente.");
  const handleDeleteStory = (id: string) => mutate(async () => { await archiveStory(apiBaseUrl, id); storyRequest.current += 1; setStoriesLoading(false); setStories(current => current.filter(story => story.id !== id)); showToast("success", "Story removido."); }, "Não foi possível remover o story. Tente novamente.");
  const handleFileUpload = async (file: File) => {
    if (working.current || uploading.current) return;
    setUploadError(null);
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) { setUploadError("Selecione uma imagem JPEG, PNG ou WebP."); return; }
    if (file.size > 5 * 1024 * 1024) { setUploadError("A imagem deve ter no máximo 5 MB. Escolha um arquivo menor."); return; }
    uploading.current = true; setEditor(current => ({ ...current, uploading: true, imageUrl: "" }));
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("invalid_image")); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file); });
      setEditor(current => ({ ...current, imagePreview: dataUrl }));
      const result = await uploadStoryImage(apiBaseUrl, dataUrl);
      if (!result.url) throw new Error("image_upload_missing_url");
      setEditor(current => ({ ...current, imageUrl: result.url }));
    } catch (error) { setUploadError("Não foi possível enviar a imagem. A prévia foi preservada. Selecione a imagem novamente para tentar o envio."); reportError({ source: "stories.uploadImage", error, severity: "warning" }); }
    finally { uploading.current = false; setEditor(current => ({ ...current, uploading: false })); }
  };
  const resetEditor = () => { const next = emptyEditor(); setEditor(next); setInitialEditor(next); setEditingStoryId(null); setUploadError(null); setActionError(null); };
  const handleCreateStory = async () => {
    if (!selectedCategory || !editor.imageUrl || editor.uploading || editor.duration < 3 || editor.duration > 15) return false;
    if (editingStoryId) return mutate(async () => {
      const updated = await updateStory(apiBaseUrl, editingStoryId, storyEditorPatch(editor, initialEditor, hasSavedTitleConfig));
      storyRequest.current += 1; setStoriesLoading(false);
      setStories(current => current.map(story => story.id === updated.id ? updated : story));
      resetEditor(); setShowCreateStory(false); showToast("success", "Story atualizado.");
    }, "Não foi possível atualizar o story. Suas alterações foram preservadas para você tentar novamente.");
    return mutate(async () => { await createStory(apiBaseUrl, selectedCategory.id, { imageUrl: editor.imageUrl, title: editor.title.trim() || undefined, titleConfig: editor.title.trim() ? editor.titleConfig : undefined, duration: editor.duration }); resetEditor(); setShowCreateStory(false); showToast("success", "Story criado."); await loadStories(); }, "Não foi possível criar o story. Sua imagem e seu texto foram preservados. Confira a categoria e tente novamente.");
  };
  const openCreateStory = async () => {
    await mutate(async () => { const cats = await listStoryCategories(apiBaseUrl); setCategories(cats); const target = cats.find(cat => cat.id === selectedCategory?.id) ?? cats[0]; if (!target) { setSelectedCategory(null); setActionError("Crie uma categoria antes de adicionar um story."); return; } setSelectedCategory(current => current?.id === target.id ? current : target); resetEditor(); setShowCreateStory(true); }, "Não foi possível confirmar a categoria. Tente novamente.");
  };
  const updateEditorField = <K extends keyof StoryEditorState>(key: K, value: StoryEditorState[K]) => { setEditor(current => ({ ...current, [key]: value })); };
  const updateTitleConfig = (partial: Partial<TitleConfig>) => { setEditor(current => ({ ...current, titleConfig: { ...current.titleConfig, ...partial } })); };
  const openCreateCategory = () => { setEditingCategoryId(null); setNewCategoryName(""); setInitialCategoryName(""); setActionError(null); setShowCreateCategory(true); };
  const openEditCategory = (category: StoryCategoryDTO) => { setEditingCategoryId(category.id); setNewCategoryName(category.name); setInitialCategoryName(category.name); setActionError(null); setShowCreateCategory(true); };
  const openEditStory = (story: StoryDTO) => {
    const next = { imageUrl: story.imageUrl, imagePreview: story.imageUrl, title: story.title ?? "", duration: story.duration,
      titleConfig: { ...DEFAULT_TITLE_CONFIG, ...story.titleConfig }, uploading: false };
    setHasSavedTitleConfig(!!story.titleConfig);
    setEditingStoryId(story.id); setEditor(next); setInitialEditor(next); setUploadError(null); setActionError(null); setShowCreateStory(true);
  };
  return { categories, selectedCategory, stories, loading, storiesLoading, loadError, storiesError, actionError, uploadError, busy, showCreateCategory, showCreateStory, newCategoryName, editor, editingCategoryId, editingStoryId, categoryDirty, storyDirty, openCreateCategory, openEditCategory, openEditStory, setSelectedCategory, setShowCreateCategory, setShowCreateStory, setNewCategoryName, updateEditorField, updateTitleConfig, handleCreateCategory, handleDeleteCategory, handleFileUpload, handleCreateStory, handleDeleteStory, openCreateStory, resetEditor, reload: loadCategories, reloadStories: loadStories, clearError: () => setActionError(null) };
}
