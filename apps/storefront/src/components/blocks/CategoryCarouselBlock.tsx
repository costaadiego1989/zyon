"use client";

import type { ConversationBlock } from "@/lib/types";

interface CategoryData {
  id: string;
  name: string;
  slug: string;
  description?: string;
  emoji?: string;
  productCount?: number;
}

export interface CategoryCarouselBlock {
  type: "category_carousel";
  data: { categories: CategoryData[] };
}

const CATEGORY_EMOJIS: Record<string, string> = {
  vestuario: "👕", vestuário: "👕", roupas: "👕", moda: "👗",
  calcados: "👟", calçados: "👟", tenis: "👟", sapatos: "👠",
  acessorios: "💎", acessórios: "💎", joias: "💍",
  eletronicos: "💻", eletrônicos: "💻", tecnologia: "📱",
  casa: "🏠", decoracao: "🏠", decoração: "🏠",
  esportes: "⚽", fitness: "💪",
  beleza: "💄", cosmeticos: "💄",
  pet: "🐾",
  alimentos: "🍕", bebidas: "🍷",
  saude: "💊", saúde: "💊",
  games: "🎮", entretenimento: "🎬",
};

const CATEGORY_DESCRIPTIONS: Record<string, string> = {
  vestuario: "Camisetas, calças, jaquetas e mais",
  vestuário: "Camisetas, calças, jaquetas e mais",
  calcados: "Tênis, botas, sandálias e sapatos",
  calçados: "Tênis, botas, sandálias e sapatos",
  acessorios: "Bolsas, relógios, óculos e mais",
  acessórios: "Bolsas, relógios, óculos e mais",
};

function getEmoji(name: string): string {
  const key = name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  return CATEGORY_EMOJIS[key] ?? "🏷️";
}

function getDescription(name: string): string {
  const key = name.toLowerCase();
  return CATEGORY_DESCRIPTIONS[key] ?? `Explore os produtos de ${name}`;
}

export default function CategoryCarouselBlock({
  block,
  onQuickReply,
}: {
  block: CategoryCarouselBlock;
  onQuickReply?: (text: string) => void;
}) {
  const { categories } = block.data;

  return (
    <div style={{ position: "relative", margin: "0 -18px", padding: "0 18px" }}>
      <style>{`
        .aacp-cat-scroll::-webkit-scrollbar { display: none; }
        .aacp-cat-scroll { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>

      <div
        className="aacp-cat-scroll"
        style={{
          display: "flex",
          gap: "12px",
          overflowX: "auto",
          paddingBottom: "4px",
          scrollSnapType: "x mandatory",
          WebkitOverflowScrolling: "touch",
        }}
      >
        {categories.map((cat) => {
          const emoji = cat.emoji ?? getEmoji(cat.name);
          const desc = cat.description ?? getDescription(cat.name);

          return (
            <div
              key={cat.id}
              onClick={() => onQuickReply?.(`Ver produtos de ${cat.name}`)}
              style={{
                minWidth: "200px",
                maxWidth: "220px",
                flex: "0 0 200px",
                scrollSnapAlign: "start",
                cursor: "pointer",
              }}
            >
              <div
                style={{
                  background: "var(--aacp-surface-2, rgba(255,255,255,0.04))",
                  border: "1px solid var(--aacp-line)",
                  borderRadius: "14px",
                  padding: "20px 16px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "8px",
                  height: "100%",
                  transition: "border-color 0.2s, transform 0.2s, box-shadow 0.2s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = "var(--aacp-accent)";
                  e.currentTarget.style.transform = "translateY(-2px)";
                  e.currentTarget.style.boxShadow = "0 6px 20px rgba(0,0,0,0.15)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = "var(--aacp-line)";
                  e.currentTarget.style.transform = "none";
                  e.currentTarget.style.boxShadow = "none";
                }}
              >
                {/* Emoji */}
                <div style={{ fontSize: "32px", marginBottom: "4px" }}>{emoji}</div>

                {/* Category name */}
                <h4 style={{ fontSize: "14px", fontWeight: 700, margin: 0, color: "var(--aacp-fg)", fontFamily: "var(--aacp-font-display, var(--aacp-font))" }}>
                  {cat.name}
                </h4>

                {/* Description */}
                <p style={{ fontSize: "11.5px", color: "var(--aacp-muted)", margin: 0, lineHeight: 1.4 }}>
                  {desc}
                </p>

                {/* Product count */}
                {cat.productCount !== undefined && cat.productCount > 0 && (
                  <span style={{ fontSize: "10px", color: "var(--aacp-faint, var(--aacp-muted))", marginTop: "4px" }}>
                    {cat.productCount} {cat.productCount === 1 ? "produto" : "produtos"}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
