import React, { useRef, useState } from "react";
import { Plus, Trash2, GripVertical, Image, Clock, FolderOpen, X, Upload } from "lucide-react";
import type { MerchantProfile } from "../api-client.js";
import { useStoriesPage } from "./useStoriesPage.js";
import type { TitleConfig } from "../api/endpoints/stories.js";

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

  if (vm.loading) {
    return <div style={{ padding: "40px", color: "var(--muted)" }}>Carregando stories...</div>;
  }

  return (
    <div>
      {/* Header — same pattern as CategoriesPage */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <div style={{ font: "600 10px var(--mono)", letterSpacing: "0.06em", color: "var(--faint)", marginBottom: 4 }}>LOJA</div>
          <h1 style={{ font: "700 22px var(--serif)", color: "var(--ink)", letterSpacing: "-0.02em", marginBottom: 6 }}>Stories</h1>
          <div style={{ font: "17px var(--serif)", fontStyle: "italic", color: "var(--muted)" }}>Crie stories visuais para engajar compradores — promoções, destaques, novidades.</div>
        </div>
        <button
          onClick={() => vm.setShowCreateCategory(true)}
          style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 8, border: "1px solid var(--accent-dark)", background: "var(--accent-dark)", font: "600 12.5px var(--sans)", color: "white", cursor: "pointer", flex: "none" }}
        >
          <Plus size={14} /> Nova Categoria
        </button>
      </div>

      {/* Stat cards — same as CategoriesPage StatCard pattern */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 20 }}>
        <div style={{ padding: "16px 20px", borderRadius: 10, border: "1px solid var(--rule)", background: "var(--card)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <span style={{ font: "600 10px var(--mono)", letterSpacing: "0.05em", color: "var(--faint)", textTransform: "uppercase" }}>Categorias</span>
            <FolderOpen size={15} style={{ color: "var(--accent)" }} />
          </div>
          <div style={{ font: "700 26px var(--sans)", color: "var(--ink)" }}>{vm.categories.length}</div>
        </div>
        <div style={{ padding: "16px 20px", borderRadius: 10, border: "1px solid var(--rule)", background: "var(--card)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <span style={{ font: "600 10px var(--mono)", letterSpacing: "0.05em", color: "var(--faint)", textTransform: "uppercase" }}>Stories Ativos</span>
            <Image size={15} style={{ color: "var(--accent)" }} />
          </div>
          <div style={{ font: "700 26px var(--sans)", color: "var(--accent)" }}>{vm.stories.length}</div>
        </div>
        <div style={{ padding: "16px 20px", borderRadius: 10, border: "1px solid var(--rule)", background: "var(--card)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <span style={{ font: "600 10px var(--mono)", letterSpacing: "0.05em", color: "var(--faint)", textTransform: "uppercase" }}>Selecionada</span>
            <Clock size={15} style={{ color: "var(--faint)" }} />
          </div>
          <div style={{ font: "600 15px var(--sans)", color: "var(--ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{vm.selectedCategory?.name ?? "—"}</div>
        </div>
      </div>

      {/* Layout — categories sidebar + stories grid */}
      <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: 16, minHeight: "400px" }}>
        {/* Categories sidebar */}
        <div style={{ background: "var(--card)", border: "1px solid var(--rule)", borderRadius: 10, padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
          <h3 style={{ font: "600 10px var(--mono)", letterSpacing: "0.05em", color: "var(--faint)", textTransform: "uppercase", margin: "0 0 8px" }}>
            Categorias ({vm.categories.length})
          </h3>
          {vm.categories.map((cat) => (
            <div
              key={cat.id}
              onClick={() => vm.setSelectedCategory(cat)}
              style={{
                display: "flex", alignItems: "center", gap: "10px", padding: "10px 12px",
                borderRadius: "8px", cursor: "pointer",
                background: vm.selectedCategory?.id === cat.id ? "var(--accent-bg, rgba(16,185,129,0.08))" : "transparent",
                border: vm.selectedCategory?.id === cat.id ? "1px solid var(--accent)" : "1px solid transparent",
              }}
            >
              <GripVertical size={14} style={{ color: "var(--faint)", cursor: "grab" }} />
              <div style={{ width: "36px", height: "36px", borderRadius: "50%", background: "var(--bg)", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", flexShrink: 0 }}>
                {cat.coverImage ? (
                  <img src={cat.coverImage} style={{ width: "100%", height: "100%", objectFit: "cover" }} alt="" />
                ) : (
                  <FolderOpen size={16} style={{ color: "var(--faint)" }} />
                )}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{cat.name}</div>
              </div>
              <button onClick={(e) => { e.stopPropagation(); vm.handleDeleteCategory(cat.id); }} style={{ padding: "4px", borderRadius: "4px", border: "none", background: "transparent", color: "var(--faint)", cursor: "pointer" }}>
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          {vm.categories.length === 0 && (
            <div style={{ fontSize: "13px", color: "var(--faint)", textAlign: "center", padding: "20px" }}>Nenhuma categoria criada</div>
          )}
        </div>

        {/* Stories grid */}
        <div style={{ background: "var(--card)", border: "1px solid var(--rule)", borderRadius: 10, padding: "20px" }}>
          {vm.selectedCategory ? (
            <>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
                <h3 style={{ font: "600 16px var(--sans)", margin: 0, color: "var(--ink)" }}>{vm.selectedCategory.name}</h3>
                <button onClick={() => vm.openCreateStory()} style={{ display: "flex", alignItems: "center", gap: "6px", padding: "8px 16px", borderRadius: "8px", border: "1px solid var(--accent)", background: "transparent", color: "var(--accent)", fontSize: "13px", fontWeight: 600, cursor: "pointer" }}>
                  <Plus size={14} /> Adicionar Story
                </button>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: "16px" }}>
                {vm.stories.map((story) => (
                  <div key={story.id} style={{ position: "relative", aspectRatio: "9/16", borderRadius: "12px", overflow: "hidden", border: "1px solid var(--rule)", background: "var(--bg)" }}>
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
                    <button onClick={() => vm.handleDeleteStory(story.id)} style={{ position: "absolute", top: "8px", left: "8px", padding: "4px", borderRadius: "4px", border: "none", background: "rgba(0,0,0,0.6)", color: "#fff", cursor: "pointer" }}>
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
                {vm.stories.length === 0 && (
                  <div style={{ gridColumn: "1 / -1", textAlign: "center", padding: "40px", color: "var(--faint)", fontSize: "14px" }}>
                    <Image size={32} style={{ marginBottom: "8px", opacity: 0.4 }} />
                    <div>Nenhum story nesta categoria</div>
                    <div style={{ fontSize: "12px", marginTop: "4px" }}>Clique em "Adicionar Story" para começar</div>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--faint)" }}>
              <FolderOpen size={48} style={{ opacity: 0.3, marginBottom: "12px" }} />
              <div style={{ fontSize: "14px" }}>Selecione uma categoria</div>
            </div>
          )}
        </div>
      </div>

      {/* Create Category — Side Panel */}
      {vm.showCreateCategory && (
        <SidePanel title="Nova Categoria" onClose={() => vm.setShowCreateCategory(false)}>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "16px" }}>
            <div>
              <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "var(--muted)", marginBottom: "6px" }}>Nome da Categoria</label>
              <input
                value={vm.newCategoryName}
                onChange={(e) => vm.setNewCategoryName(e.target.value)}
                placeholder="Ex: Promoções, Novidades, Destaques"
                style={{ width: "100%", padding: "12px 14px", borderRadius: "8px", border: "1px solid var(--rule)", fontSize: "14px", background: "var(--bg)", color: "var(--ink)", boxSizing: "border-box" }}
                autoFocus
                onKeyDown={(e) => e.key === "Enter" && vm.handleCreateCategory()}
              />
            </div>
          </div>
          <PanelFooter onCancel={() => vm.setShowCreateCategory(false)} onSubmit={vm.handleCreateCategory} disabled={!vm.newCategoryName.trim()} label="Criar Categoria" />
        </SidePanel>
      )}

      {/* Create Story — Side Panel */}
      {vm.showCreateStory && (
        <SidePanel title="Novo Story" subtitle={`Categoria: ${vm.selectedCategory?.name}`} onClose={() => vm.setShowCreateStory(false)} width={520}>
          <StoryEditorContent vm={vm} />
          <PanelFooter onCancel={() => vm.setShowCreateStory(false)} onSubmit={vm.handleCreateStory} disabled={!vm.editor.imageUrl || vm.editor.uploading} label={vm.editor.uploading ? "Enviando..." : "Criar Story"} />
        </SidePanel>
      )}

      <style>{`@keyframes slideInRight { from { transform: translateX(100%); } to { transform: translateX(0); } }`}</style>
      <link rel="stylesheet" href={GOOGLE_FONTS_URL} />
    </div>
  );
}

// ── Reusable Side Panel ──────────────────────────────────────────────────────

function SidePanel({ title, subtitle, onClose, children, width = 420 }: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  width?: number;
}) {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 900, display: "flex", justifyContent: "flex-end" }} onClick={onClose}>
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)", backdropFilter: "blur(2px)" }} />
      <aside
        style={{ position: "relative", width, maxWidth: "90vw", height: "100vh", overflowY: "auto", background: "var(--card)", borderLeft: "1px solid var(--rule)", padding: "28px 24px", display: "flex", flexDirection: "column", gap: "20px", animation: "slideInRight 0.2s ease-out" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <h2 style={{ fontSize: "18px", fontWeight: 600, color: "var(--ink)", margin: 0 }}>{title}</h2>
            {subtitle && <p style={{ fontSize: "12px", color: "var(--muted)", margin: "4px 0 0" }}>{subtitle}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar" style={{ width: 44, height: 44, borderRadius: 10, border: "1px solid var(--rule)", background: "var(--bg)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--ink)" }}>
            <X size={22} />
          </button>
        </div>
        {children}
      </aside>
    </div>
  );
}

function PanelFooter({ onCancel, onSubmit, disabled, label }: { onCancel: () => void; onSubmit: () => void; disabled: boolean; label: string }) {
  return (
    <div style={{ marginTop: "auto", display: "flex", gap: "8px", justifyContent: "flex-end", paddingTop: "16px", borderTop: "1px solid var(--rule)" }}>
      <button onClick={onCancel} style={{ padding: "10px 20px", borderRadius: "8px", border: "1px solid var(--rule)", background: "transparent", color: "var(--muted)", fontSize: "14px", cursor: "pointer" }}>Cancelar</button>
      <button onClick={onSubmit} disabled={disabled} style={{ padding: "10px 20px", borderRadius: "8px", border: "none", background: "var(--accent)", color: "#fff", fontSize: "14px", fontWeight: 600, cursor: "pointer", opacity: disabled ? 0.5 : 1 }}>{label}</button>
    </div>
  );
}

// ── Story Editor Content ─────────────────────────────────────────────────────

function StoryEditorContent({ vm }: { vm: ReturnType<typeof useStoriesPage> }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { editor, updateEditorField, updateTitleConfig, handleFileUpload } = vm;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "20px" }}>
      {/* Image Upload */}
      <div>
        <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "var(--muted)", marginBottom: "8px" }}>Imagem do Story</label>
        <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => e.target.files?.[0] && handleFileUpload(e.target.files[0])} style={{ display: "none" }} />

        {!editor.imagePreview ? (
          <div>
            <button type="button" onClick={() => fileInputRef.current?.click()} style={{ width: "100%", padding: "40px 16px", borderRadius: "12px", border: "2px dashed var(--rule)", background: "var(--bg)", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: "10px", color: "var(--muted)", transition: "border-color 0.15s" }}>
              <Upload size={28} style={{ opacity: 0.4 }} />
              <span style={{ fontSize: "13px", fontWeight: 600 }}>Enviar imagem do story</span>
              <span style={{ fontSize: "11px", color: "var(--faint)" }}>JPEG, PNG ou WebP · Máx 5MB</span>
            </button>
            <div style={{ marginTop: "10px", padding: "10px 14px", borderRadius: "8px", background: "color-mix(in srgb, var(--accent) 8%, var(--card))", border: "1px solid color-mix(in srgb, var(--accent) 20%, transparent)", display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ fontSize: "16px" }}>📐</span>
              <span style={{ fontSize: "11px", color: "var(--muted)", lineHeight: 1.4 }}>
                Tamanho recomendado: <strong style={{ color: "var(--ink)" }}>1080 × 1920px</strong> (9:16 vertical). A imagem será exibida em tela cheia no storefront.
              </span>
            </div>
          </div>
        ) : (
          <DraggablePreview editor={editor} updateTitleConfig={updateTitleConfig} onReplace={() => { updateEditorField("imagePreview", ""); updateEditorField("imageUrl", ""); fileInputRef.current?.click(); }} />
        )}
      </div>

      {/* Duration */}
      <div>
        <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "var(--muted)", marginBottom: "6px" }}>
          <Clock size={12} style={{ display: "inline", verticalAlign: "middle", marginRight: "4px" }} />
          Duração: {editor.duration}s
        </label>
        <input type="range" min={3} max={15} value={editor.duration} onChange={(e) => updateEditorField("duration", Number(e.target.value))} style={{ width: "100%", accentColor: "var(--accent)" }} />
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "10px", color: "var(--faint)", marginTop: "2px" }}><span>3s</span><span>15s</span></div>
      </div>

      {/* Title */}
      <div>
        <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "var(--muted)", marginBottom: "6px" }}>Título (opcional)</label>
        <input
          value={editor.title}
          onChange={(e) => updateEditorField("title", e.target.value)}
          placeholder="Texto sobre a imagem"
          style={{ width: "100%", padding: "10px 12px", borderRadius: "8px", border: "1px solid var(--rule)", fontSize: "13px", background: "var(--bg)", color: "var(--ink)", boxSizing: "border-box" }}
        />
      </div>

      {/* Title Config */}
      {editor.title && (
        <div style={{ padding: "20px", borderRadius: "12px", border: "1px solid var(--rule)", background: "var(--bg)" }}>
          <div style={{ fontSize: "11px", fontWeight: 700, color: "var(--muted)", marginBottom: "16px", textTransform: "uppercase", letterSpacing: "0.06em" }}>Estilo do Título</div>

          {/* Row 1: Font + Size */}
          <div style={{ display: "flex", gap: "12px", marginBottom: "14px" }}>
            <div style={{ flex: 1 }}>
              <label style={{ display: "block", fontSize: "10px", fontWeight: 600, color: "var(--faint)", marginBottom: "5px", textTransform: "uppercase", letterSpacing: "0.04em" }}>Fonte</label>
              <select value={editor.titleConfig.font} onChange={(e) => updateTitleConfig({ font: e.target.value })} style={{ width: "100%", padding: "9px 10px", borderRadius: "8px", border: "1px solid var(--rule)", fontSize: "12px", background: "var(--card)", color: "var(--text-primary, #fff)", colorScheme: "dark", appearance: "none", WebkitAppearance: "none", height: "38px" }}>
                {FONT_OPTIONS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
            </div>
            <div style={{ width: "100px" }}>
              <label style={{ display: "block", fontSize: "10px", fontWeight: 600, color: "var(--faint)", marginBottom: "5px", textTransform: "uppercase", letterSpacing: "0.04em" }}>Tamanho</label>
              <input type="number" min={10} max={48} value={editor.titleConfig.fontSize} onChange={(e) => updateTitleConfig({ fontSize: Number(e.target.value) })} style={{ width: "100%", height: "38px", padding: "0 10px", borderRadius: "8px", border: "1px solid var(--rule)", fontSize: "14px", fontWeight: 600, background: "var(--card)", color: "var(--text-primary, #fff)", textAlign: "center", boxSizing: "border-box" }} />
            </div>
          </div>

          {/* Row 2: Text color + Bg toggle */}
          <div style={{ display: "flex", gap: "12px", alignItems: "flex-end", marginBottom: "14px" }}>
            <div style={{ flex: 1 }}>
              <label style={{ display: "block", fontSize: "10px", fontWeight: 600, color: "var(--faint)", marginBottom: "5px", textTransform: "uppercase", letterSpacing: "0.04em" }}>Cor do texto</label>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <input type="color" value={editor.titleConfig.color} onChange={(e) => updateTitleConfig({ color: e.target.value })} style={{ width: "36px", height: "36px", borderRadius: "8px", border: "1px solid var(--rule)", cursor: "pointer", padding: 0 }} />
                <span style={{ fontSize: "11px", fontFamily: "monospace", color: "var(--muted)" }}>{editor.titleConfig.color}</span>
              </div>
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", padding: "8px 0" }}>
              <input type="checkbox" checked={editor.titleConfig.hasBg} onChange={(e) => updateTitleConfig({ hasBg: e.target.checked })} style={{ width: "16px", height: "16px", accentColor: "var(--accent)", borderRadius: "4px" }} />
              <span style={{ fontSize: "11px", fontWeight: 500, color: "var(--muted)" }}>Fundo</span>
            </label>
          </div>

          {/* Row 3: Background settings (conditional) */}
          {editor.titleConfig.hasBg && (
            <div style={{ display: "flex", gap: "16px", alignItems: "flex-end", paddingTop: "14px", borderTop: "1px solid var(--rule)" }}>
              <div>
                <label style={{ display: "block", fontSize: "10px", fontWeight: 600, color: "var(--faint)", marginBottom: "5px", textTransform: "uppercase", letterSpacing: "0.04em" }}>Cor fundo</label>
                <input type="color" value={editor.titleConfig.bgColor} onChange={(e) => updateTitleConfig({ bgColor: e.target.value })} style={{ width: "38px", height: "38px", borderRadius: "8px", border: "1px solid var(--rule)", cursor: "pointer", padding: 0 }} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "5px" }}>
                  <label style={{ fontSize: "10px", fontWeight: 600, color: "var(--faint)", textTransform: "uppercase", letterSpacing: "0.04em" }}>Opacidade</label>
                  <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--ink)" }}>{Math.round(editor.titleConfig.bgOpacity * 100)}%</span>
                </div>
                <input type="range" min={0} max={100} value={editor.titleConfig.bgOpacity * 100} onChange={(e) => updateTitleConfig({ bgOpacity: Number(e.target.value) / 100 })} style={{ width: "100%", accentColor: "var(--accent)", height: "6px" }} />
              </div>
            </div>
          )}

          {editor.imagePreview && (
            <div style={{ marginTop: "14px", padding: "8px 12px", borderRadius: "6px", background: "color-mix(in srgb, var(--accent, #10b981) 6%, transparent)", display: "flex", alignItems: "center", gap: "6px" }}>
              <span style={{ fontSize: "12px" }}>↕</span>
              <span style={{ fontSize: "10px", color: "var(--muted)" }}>Arraste o título no preview para posicionar</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
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
        style={{ position: "relative", width: "220px", aspectRatio: "9/16", borderRadius: "14px", overflow: "hidden", border: "2px solid var(--rule)", background: "#111" }}
      >
        <img src={editor.imagePreview} style={{ width: "100%", height: "100%", objectFit: "cover" }} alt="Preview" />
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
        <button type="button" onClick={onReplace} style={{ position: "absolute", top: "8px", right: "8px", width: "28px", height: "28px", borderRadius: "6px", border: "none", background: "rgba(0,0,0,0.6)", color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
