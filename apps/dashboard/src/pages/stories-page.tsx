import { Modal } from "../components/Modal.js";
import { PageLoader } from "../components/PageLoader.js";
import "./stories-page.css";
import { SetupGuide } from "../components/SetupGuide.js";
import { PageHeader } from "../components/PageHeader.js";
import React, { useRef, useState } from "react";
import { Plus, Pencil, Trash2, GripVertical, Image, Clock, FolderOpen, X, Upload, CircleDashed } from "lucide-react";
import { EmptyState } from "../components/EmptyState.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import type { MerchantProfile } from "../api-client.js";
import { useStoriesPage } from "./useStoriesPage.js";
import type { TitleConfig } from "../api/endpoints/stories.js";
import { Button } from "../components/Button.js";
import { FormField, FormSelect, FormTextarea } from "../components/FormField.js";
import { StatCard, StatCardGroup } from "./overview/components/StatCard.js";

export interface StoriesPageProps {
  apiBaseUrl: string;
  me: MerchantProfile | null;
}

const FONT_OPTIONS = [
  { value: "inter", label: "Inter", css: "'Inter', sans-serif" },
  { value: "playfair", label: "Playfair Display", css: "'Playfair Display', serif" },
  { value: "space-mono", label: "Space Mono", css: "'Space Mono', monospace" },
  { value: "dm-sans", label: "DM Sans", css: "'DM Sans', sans-serif" },
  { value: "bebas-neue", label: "Bebas Neue", css: "'Bebas Neue', sans-serif" },
  { value: "montserrat", label: "Montserrat", css: "'Montserrat', sans-serif" },
  { value: "oswald", label: "Oswald", css: "'Oswald', sans-serif" },
  { value: "poppins", label: "Poppins", css: "'Poppins', sans-serif" },
  { value: "raleway", label: "Raleway", css: "'Raleway', sans-serif" },
  { value: "roboto-condensed", label: "Roboto Condensed", css: "'Roboto Condensed', sans-serif" },
  { value: "lora", label: "Lora", css: "'Lora', serif" },
  { value: "abril-fatface", label: "Abril Fatface", css: "'Abril Fatface', serif" },
];

const FONT_CSS_MAP: Record<string, string> = Object.fromEntries(FONT_OPTIONS.map(f => [f.value, f.css]));

const GOOGLE_FONTS_URL = "https://fonts.googleapis.com/css2?family=Inter:wght@600;700&family=Playfair+Display:wght@600;700&family=Space+Mono:wght@700&family=DM+Sans:wght@600;700&family=Bebas+Neue&family=Montserrat:wght@600;700&family=Oswald:wght@600;700&family=Poppins:wght@600;700&family=Raleway:wght@600;700&family=Roboto+Condensed:wght@600;700&family=Lora:wght@600;700&family=Abril+Fatface&display=swap";

export function StoriesPage({ apiBaseUrl, me }: StoriesPageProps) {
  const vm = useStoriesPage(apiBaseUrl);
  const [confirmDelete, setConfirmDelete] = useState<{ type: "category" | "story"; id: string; name: string } | null>(null);

  const [discard, setDiscard] = useState<"category" | "story" | null>(null);
  function closeEditor(type: "category" | "story") {
    if (vm.busy || vm.editor.uploading) return;
    const dirty = type === "category" ? vm.categoryDirty : vm.storyDirty;
    if (dirty) { setDiscard(type); return; }
    if (type === "category") vm.setShowCreateCategory(false); else vm.setShowCreateStory(false);
  }
  function discardEditor() { if (discard === "category") { vm.setNewCategoryName(""); vm.setShowCreateCategory(false); } else { vm.resetEditor(); vm.setShowCreateStory(false); } setDiscard(null); }
  function requestDeleteCategory(id: string, name: string) {
    vm.clearError();
    setConfirmDelete({ type: "category", id, name });
  }

  function requestDeleteStory(id: string) {
    setConfirmDelete({ type: "story", id, name: "este story" });
  }

  async function executeDelete() {
    if (!confirmDelete) return;
    const success = confirmDelete.type === "category" ? await vm.handleDeleteCategory(confirmDelete.id) : await vm.handleDeleteStory(confirmDelete.id);
    if (success) setConfirmDelete(null);
  }

  if (vm.loading) {
    return <div className="page-container stories-page"><PageHeader title="Stories" description="Organize novidades e destaques visuais para os compradores." /><PageLoader /></div>;
  }

  return (
    <div className="page-container stories-page">
      <ConfirmDialog
        open={!!confirmDelete}
        busy={vm.busy}
        error={vm.actionError}
        title={confirmDelete?.type === "category" ? "Excluir categoria" : "Excluir story"}
        description={confirmDelete?.type === "category"
          ? `Tem certeza que deseja excluir "${confirmDelete.name}"? Todos os stories desta categoria serão removidos.`
          : "Tem certeza que deseja excluir este story? Essa ação não pode ser desfeita."}
        confirmLabel="Excluir"
        variant="danger"
        onConfirm={executeDelete}
        onCancel={() => setConfirmDelete(null)}
      />
      {/* Header */}
      <PageHeader title="Stories" description="Crie stories visuais para engajar compradores com promoções, destaques e novidades" actions={<>
<Button variant="primary" size="sm" arrow disabled={vm.busy || Boolean(vm.loadError)} onClick={vm.openCreateCategory}>
          <Plus size={14} /> Nova categoria
        </Button>
</>} />
      <SetupGuide title="Como criar stories para a loja" steps={[{"title":"Organize por assunto","description":"Crie uma categoria de stories, como Novidades. Essas categorias são diferentes das categorias de produtos."},{"title":"Adicione a mídia e o texto","description":"Selecione a categoria e prepare o conteúdo do story. Use uma imagem JPEG, PNG ou WebP e uma mensagem curta."},{"title":"Confira a prévia","description":"Revise o enquadramento, a posição do título e o tempo de exibição antes de criar."}]} />

      {vm.loadError ? <EmptyState icon={CircleDashed} title="Stories indisponíveis" description={vm.loadError} action={<Button variant="outline" onClick={() => void vm.reload()}>Tentar novamente</Button>} /> : <>
      {vm.actionError && !vm.showCreateStory && !vm.showCreateCategory && !confirmDelete && <div className="panel-error" role="alert">{vm.actionError}</div>}
      {/* KPIs */}
      <StatCardGroup columns={3}>
        <StatCard
          label="Categorias"
          value={vm.categories.length}
          icon={<FolderOpen size={16} />}
        />
        <StatCard
          label="Stories na categoria selecionada"
          value={vm.storiesLoading || vm.storiesError ? "—" : vm.stories.length}
          icon={<Image size={16} />}
          accent="var(--color-brand)"
        />
        <StatCard
          label="Categoria selecionada"
          value={vm.selectedCategory?.name ?? "Nenhuma"}
          icon={<Clock size={16} />}
        />
      </StatCardGroup>

      {/* Layout — categories sidebar + stories grid */}
      <div className="stories-layout">
        {/* Categories sidebar */}
        <div style={{ background: "var(--surface-2)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)", padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
          <h3 style={{ font: "600 14px var(--font-sans)", color: "var(--color-brand)", margin: "0 0 8px" }}>
            Categorias ({vm.categories.length})
          </h3>
          {vm.categories.map(cat => <div key={cat.id} className="stories-category" data-selected={vm.selectedCategory?.id === cat.id}>
            <button type="button" className="stories-category__select" aria-pressed={vm.selectedCategory?.id === cat.id} disabled={vm.busy} onClick={() => vm.setSelectedCategory(cat)}>
              {cat.coverImage ? <img src={cat.coverImage} alt="" /> : <FolderOpen size={18} aria-hidden="true" />}
              <span>{cat.name}</span>
            </button>
            <button type="button" className="ui-icon-button" aria-label={`Editar categoria ${cat.name}`} disabled={vm.busy} onClick={() => vm.openEditCategory(cat)}><Pencil size={15} /></button>
            <button type="button" className="ui-icon-button" aria-label={`Remover categoria ${cat.name}`} disabled={vm.busy} onClick={() => requestDeleteCategory(cat.id, cat.name)}><Trash2 size={15} /></button>
          </div>)}
          {vm.categories.length === 0 && (
            <EmptyState icon={CircleDashed} title="Nenhuma categoria criada" description="Crie uma categoria para organizar seus stories." />
          )}
        </div>

        {/* Stories grid */}
        <div style={{ background: "var(--surface-2)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)", padding: "20px" }}>
          {vm.selectedCategory ? (
            <>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: "16px" }}>
                <h3 style={{ font: "600 14px var(--font-sans)", margin: 0, color: "var(--color-brand)" }}>{vm.selectedCategory.name}</h3>
                <Button variant="outline" disabled={vm.busy} onClick={() => void vm.openCreateStory()}>
                  <Plus size={14} /> Adicionar story
                </Button>
              </div>
              {vm.storiesLoading ? <PageLoader /> : vm.storiesError ? <EmptyState icon={Image} title="Conteúdo indisponível" description={vm.storiesError} action={<Button variant="outline" onClick={() => void vm.reloadStories()}>Tentar novamente</Button>} /> : <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: "16px" }}>
                {vm.stories.map((story) => (
                  <div key={story.id} style={{ position: "relative", aspectRatio: "9/16", borderRadius: "12px", overflow: "hidden", border: "1px solid var(--color-border)", background: "var(--surface-1)" }}>
                    <img src={story.imageUrl} alt={story.title ?? ""} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    {story.title && (
                      <div style={{
                        position: "absolute",
                        left: `${(story.titleConfig as any)?.positionX ?? 50}%`,
                        top: `${(story.titleConfig as any)?.positionY ?? 80}%`,
                        transform: "translate(-50%, -50%)",
                        padding: "6px 10px", borderRadius: "6px",
                        background: (story.titleConfig as any)?.hasBg ? `${(story.titleConfig as any).bgColor}${Math.round(((story.titleConfig as any).bgOpacity ?? 0.6) * 255).toString(16).padStart(2, "0")}` : "transparent",
                        color: (story.titleConfig as any)?.color ?? "#fff",
                        fontSize: "12px", fontWeight: 600, textAlign: "center",
                        fontFamily: FONT_CSS_MAP[(story.titleConfig as any)?.font] ?? "inherit",
                        maxWidth: "85%",
                      }}>
                        {story.title}
                      </div>
                    )}
                    <div style={{ position: "absolute", top: "8px", right: "8px", display: "flex", alignItems: "center", gap: "3px", padding: "3px 6px", borderRadius: "4px", background: "rgba(0,0,0,0.6)", color: "#fff", fontSize: "10px" }}>
                      <Clock size={10} /> {story.duration}s
                    </div>
                    <button type="button" aria-label={"Editar story " + (story.title || "sem título")} disabled={vm.busy} onClick={() => vm.openEditStory(story)} style={{ position: "absolute", bottom: 8, right: 8, width: 44, height: 44, borderRadius: 4, border: "none", background: "rgba(0,0,0,0.8)", color: "#fff", cursor: "pointer" }}><Pencil size={16} /></button>
                    <button type="button" aria-label={"Remover story " + (story.title || "sem título")} disabled={vm.busy} onClick={() => requestDeleteStory(story.id)} style={{ position: "absolute", top: "8px", left: "8px", width: 44, height: 44, padding: "4px", borderRadius: "4px", border: "none", background: "rgba(0,0,0,0.6)", color: "#fff", cursor: "pointer" }}>
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
                {vm.stories.length === 0 && (
                  <div style={{ gridColumn: "1 / -1" }}>
                    <EmptyState icon={Image} title="Nenhum story nesta categoria" description={'Clique em "Adicionar story" para começar.'} />
                  </div>
                )}
              </div>}
            </>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--color-text-faint)" }}>
              <FolderOpen size={48} style={{ opacity: 0.3, marginBottom: "12px" }} />
              <div style={{ fontSize: "14px" }}>Selecione uma categoria</div>
            </div>
          )}
        </div>
      </div>

      </>}
      <Modal isOpen={vm.showCreateCategory} title={vm.editingCategoryId ? "Editar categoria" : "Nova categoria"} subtitle="Organize os stories por assunto para facilitar a navegação dos compradores." presentation="center" size="lg" onClose={() => closeEditor("category")} footer={discard === "category" ? <DiscardActions onContinue={() => setDiscard(null)} onDiscard={discardEditor} /> : <><Button variant="outline" disabled={vm.busy} onClick={() => closeEditor("category")}>Cancelar</Button><Button variant="primary" loading={vm.busy} disabled={vm.busy || !vm.newCategoryName.trim() || (!!vm.editingCategoryId && !vm.categoryDirty)} onClick={() => void vm.handleCreateCategory()}>{vm.editingCategoryId ? "Salvar categoria" : "Criar categoria"}</Button></>}>
        <div className="story-editor configuration-form">{vm.actionError && <div className="panel-error" role="alert">{vm.actionError}</div>}<FormField label="Nome da categoria" value={vm.newCategoryName} onChange={vm.setNewCategoryName} placeholder="Ex.: Novidades, Coleções ou Promoções" maxLength={100} disabled={vm.busy} hint="As categorias de stories são independentes das categorias de produtos." /></div>
      </Modal>
      <Modal isOpen={vm.showCreateStory} title={vm.editingStoryId ? "Editar story" : "Novo story"} subtitle={"Categoria: " + vm.selectedCategory?.name} presentation="center" size="lg" onClose={() => closeEditor("story")} footer={discard === "story" ? <DiscardActions onContinue={() => setDiscard(null)} onDiscard={discardEditor} /> : <><Button variant="outline" disabled={vm.busy || vm.editor.uploading} onClick={() => closeEditor("story")}>Cancelar</Button><Button variant="primary" loading={vm.busy || vm.editor.uploading} disabled={vm.busy || !vm.editor.imageUrl || vm.editor.uploading || (!!vm.editingStoryId && !vm.storyDirty)} onClick={() => void vm.handleCreateStory()}>{vm.editingStoryId ? "Salvar story" : "Criar story"}</Button></>}>
        {vm.showCreateStory && <StoryEditorContent vm={vm} />}
      </Modal>
      <link rel="stylesheet" href={GOOGLE_FONTS_URL} />
    </div>
  );
}

function DiscardActions({ onContinue, onDiscard }: { onContinue: () => void; onDiscard: () => void }) {
  return <div className="story-discard"><p>Há alterações que ainda não foram salvas.</p><Button variant="outline" onClick={onContinue}>Continuar editando</Button><Button variant="danger" onClick={onDiscard}>Descartar e fechar</Button></div>;
}

function StoryEditorContent({ vm }: { vm: ReturnType<typeof useStoriesPage> }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { editor, updateEditorField, updateTitleConfig } = vm;
  const disabled = vm.busy || editor.uploading;
  return <div className="story-editor configuration-form">
    {vm.actionError && <div className="panel-error" role="alert">{vm.actionError}</div>}
    <fieldset disabled={disabled} className="story-editor__fields">
      <legend>Imagem e mensagem</legend>
      <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" aria-label="Selecionar imagem do story" disabled={disabled} onChange={event => { const file = event.target.files?.[0]; if (file) void vm.handleFileUpload(file); event.target.value = ""; }} hidden />
      <div className="story-editor__media">
        {editor.imagePreview ? <DraggablePreview editor={editor} updateTitleConfig={updateTitleConfig} onReplace={() => fileInputRef.current?.click()} /> : <Button variant="outline" className="story-editor__upload" disabled={disabled} onClick={() => fileInputRef.current?.click()}><Upload size={24} /> Selecionar imagem</Button>}
        <div className="story-editor__guidance"><h3>Prepare uma imagem vertical</h3><p>Use JPEG, PNG ou WebP com até 5 MB. O formato recomendado é 1080 × 1920 px (9:16).</p><p>A prévia mostra o enquadramento e a posição do título. A imagem será exibida na loja.</p>{editor.imagePreview && <Button variant="outline" disabled={disabled} onClick={() => fileInputRef.current?.click()}>Trocar imagem</Button>}</div>
      </div>
      {vm.uploadError && <div className="panel-error" role="alert">{vm.uploadError}</div>}
      <div className="story-editor__grid"><FormField label="Título (opcional)" value={editor.title} onChange={value => updateEditorField("title", value)} maxLength={160} disabled={disabled} placeholder="Uma mensagem curta sobre a imagem" /><FormSelect label="Tempo de exibição" value={String(editor.duration)} onChange={value => updateEditorField("duration", Number(value))} disabled={disabled} options={Array.from({ length: 13 }, (_, index) => ({ value: String(index + 3), label: (index + 3) + " segundos" }))} /></div>
    </fieldset>
    {editor.title && <fieldset disabled={disabled} className="story-editor__fields"><legend>Estilo e posição do título</legend><div className="story-editor__grid">
      <FormSelect label="Fonte" value={editor.titleConfig.font} onChange={font => updateTitleConfig({ font })} disabled={disabled} options={FONT_OPTIONS} />
      <FormField label="Tamanho do texto (px)" type="number" value={String(editor.titleConfig.fontSize)} onChange={value => updateTitleConfig({ fontSize: Math.max(10, Math.min(48, Number(value) || 10)) })} disabled={disabled} inputProps={{ min: 10, max: 48 }} />
      <label className="story-editor__color"><span className="story-editor__color-label">Cor do texto</span><input type="color" value={editor.titleConfig.color} onChange={event => updateTitleConfig({ color: event.target.value })} /><span>{editor.titleConfig.color}</span></label>
      <label className="story-editor__check"><input type="checkbox" checked={editor.titleConfig.hasBg} onChange={event => updateTitleConfig({ hasBg: event.target.checked })} /><span>Adicionar fundo ao título</span></label>
      {editor.titleConfig.hasBg && <><label className="story-editor__color"><span className="story-editor__color-label">Cor do fundo</span><input type="color" value={editor.titleConfig.bgColor} onChange={event => updateTitleConfig({ bgColor: event.target.value })} /><span>{editor.titleConfig.bgColor}</span></label><FormField label="Opacidade do fundo (%)" type="number" value={String(Math.round(editor.titleConfig.bgOpacity * 100))} onChange={value => updateTitleConfig({ bgOpacity: Math.max(0, Math.min(100, Number(value))) / 100 })} disabled={disabled} inputProps={{ min: 0, max: 100 }} /></>}
      <FormField label="Posição horizontal (%)" type="number" value={String(editor.titleConfig.positionX)} onChange={value => updateTitleConfig({ positionX: Math.max(5, Math.min(95, Number(value))) })} disabled={disabled} inputProps={{ min: 5, max: 95 }} />
      <FormField label="Posição vertical (%)" type="number" value={String(editor.titleConfig.positionY)} onChange={value => updateTitleConfig({ positionY: Math.max(5, Math.min(95, Number(value))) })} disabled={disabled} inputProps={{ min: 5, max: 95 }} />
    </div><p className="story-editor__hint">A posição vai de 5% a 95% da imagem. Ajuste pelos campos ou arraste o título na prévia.</p></fieldset>}
  </div>;
}

// ── Draggable Preview ────────────────────────────────────────────────────────

function DraggablePreview({ editor, updateTitleConfig, onReplace }: {
  editor: ReturnType<typeof useStoriesPage>["editor"];
  updateTitleConfig: (partial: Partial<TitleConfig>) => void;
  onReplace: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  const handlePointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(true);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragging || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = Math.max(5, Math.min(95, ((e.clientX - rect.left) / rect.width) * 100));
    const y = Math.max(5, Math.min(95, ((e.clientY - rect.top) / rect.height) * 100));
    updateTitleConfig({ positionX: Math.round(x), positionY: Math.round(y) });
  };

  const handlePointerUp = () => setDragging(false);

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "8px" }}>
      <div
        ref={containerRef}
        style={{ position: "relative", width: "220px", maxWidth: "100%", aspectRatio: "9/16", borderRadius: "var(--radius-md)", overflow: "hidden", border: "2px solid var(--color-border)", background: "#111" }}
      >
        <img src={editor.imagePreview} style={{ width: "100%", height: "100%", objectFit: "cover" }} alt="Prévia do story" />
        {editor.uploading && (
          <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: "12px", fontWeight: 600 }}>Enviando...</div>
        )}
        {/* Draggable title */}
        {editor.title && (
          <div
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            style={{
              position: "absolute",
              left: `${editor.titleConfig.positionX}%`,
              top: `${editor.titleConfig.positionY}%`,
              transform: "translate(-50%, -50%)",
              padding: "6px 12px",
              borderRadius: "6px",
              background: editor.titleConfig.hasBg ? `${editor.titleConfig.bgColor}${Math.round(editor.titleConfig.bgOpacity * 255).toString(16).padStart(2, "0")}` : "transparent",
              color: editor.titleConfig.color,
              fontSize: `${Math.max(10, Math.round(editor.titleConfig.fontSize * 0.6))}px`,
              fontWeight: 600,
              textAlign: "center",
              fontFamily: FONT_CSS_MAP[editor.titleConfig.font] ?? "inherit",
              cursor: dragging ? "grabbing" : "grab",
              userSelect: "none",
              maxWidth: "85%",
              border: dragging ? "1px dashed rgba(255,255,255,0.5)" : "1px dashed transparent",
              transition: dragging ? "none" : "border-color 0.2s",
              touchAction: "none",
            }}
          >
            {editor.title}
          </div>
        )}
        {/* Replace button */}
        <button type="button" aria-label="Trocar imagem na prévia" disabled={editor.uploading} onClick={onReplace} style={{ position: "absolute", top: "8px", right: "8px", width: "28px", height: "28px", borderRadius: "6px", border: "none", background: "rgba(0,0,0,0.6)", color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
