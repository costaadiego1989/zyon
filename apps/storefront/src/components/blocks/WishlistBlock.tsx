"use client";

import type { WishlistBlock as WishlistBlockType } from "@/lib/types";

function HeartIcon() {
  return <svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78Z" /></svg>;
}

function BagIcon() {
  return <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 8h12l1 12H5L6 8Z" /><path d="M9 8a3 3 0 0 1 6 0" /></svg>;
}

function RemoveIcon() {
  return <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v4M14 11v4" /></svg>;
}

function Rating({ rating, reviewCount }: { rating?: number; reviewCount?: number }) {
  if (typeof rating !== "number") return null;
  return <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", color: "var(--aacp-muted)", fontSize: "11px", lineHeight: 1 }}><span aria-hidden="true" style={{ color: "var(--aacp-warning)", fontSize: "12px" }}>★</span><span style={{ color: "var(--aacp-fg)", fontWeight: 700 }}>{rating.toFixed(1)}</span>{typeof reviewCount === "number" && reviewCount > 0 && <span>({reviewCount})</span>}</span>;
}

export default function WishlistBlock({ block, onQuickReply }: { block: WishlistBlockType; onQuickReply?: (text: string) => void }) {
  const { items } = block.data;
  const itemLabel = items.length === 1 ? "item salvo" : "itens salvos";

  return (
    <section data-neu="surface" aria-label="Lista de desejos" style={{ width: "100%", overflow: "hidden", border: "1px solid var(--aacp-line)", borderRadius: "var(--aacp-radius-md)", background: "var(--aacp-surface)", boxShadow: "var(--aacp-shadow-sm)" }}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "14px", padding: "15px 16px", borderBottom: items.length ? "1px solid var(--aacp-line)" : undefined, background: "var(--aacp-surface-2)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0 }}>
          <span aria-hidden="true" style={{ width: "32px", height: "32px", borderRadius: "11px", display: "grid", placeItems: "center", flex: "none", color: "var(--aacp-accent-text, var(--aacp-accent))", border: "1px solid color-mix(in srgb, var(--aacp-accent) 32%, var(--aacp-line))", background: "color-mix(in srgb, var(--aacp-accent) 12%, transparent)", boxShadow: "inset 0 1px 0 color-mix(in srgb, var(--aacp-fg) 10%, transparent)" }}><HeartIcon /></span>
          <div style={{ minWidth: 0 }}>
            <h3 style={{ margin: 0, color: "var(--aacp-fg)", fontSize: "14px", fontWeight: 750, letterSpacing: "-0.15px" }}>Lista de desejos</h3>
            <p style={{ margin: "2px 0 0", color: "var(--aacp-muted)", fontSize: "11px", lineHeight: 1.35 }}>Escolhas guardadas para você</p>
          </div>
        </div>
        <span aria-label={`${items.length} ${itemLabel}`} style={{ display: "inline-flex", alignItems: "center", gap: "6px", flex: "none", padding: "5px 8px", border: "1px solid var(--aacp-line)", borderRadius: "var(--aacp-radius-pill)", color: "var(--aacp-muted)", background: "var(--aacp-surface)", fontSize: "10px", fontWeight: 700, fontFamily: "var(--aacp-font-mono, monospace)", letterSpacing: "0.02em" }}><span aria-hidden="true" style={{ width: "5px", height: "5px", borderRadius: "50%", background: "var(--aacp-accent)" }} />{items.length} {itemLabel}</span>
      </header>

      {items.length === 0 ? (
        <div style={{ padding: "24px 16px 22px", display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "13px" }}>
          <span aria-hidden="true" style={{ width: "38px", height: "38px", display: "grid", placeItems: "center", borderRadius: "13px", color: "var(--aacp-muted)", background: "var(--aacp-surface-2)", border: "1px solid var(--aacp-line)" }}><HeartIcon /></span>
          <div><strong style={{ display: "block", color: "var(--aacp-fg)", fontSize: "13px" }}>Nada salvo por enquanto</strong><p style={{ margin: "4px 0 0", color: "var(--aacp-muted)", fontSize: "12px", lineHeight: 1.5 }}>Encontre algo que combine com você e guarde para decidir depois.</p></div>
          <button data-neu="control" type="button" onClick={() => onQuickReply?.("Ver Produtos")} style={{ display: "inline-flex", alignItems: "center", gap: "7px", border: "1px solid var(--aacp-line)", borderRadius: "999px", background: "var(--aacp-surface)", color: "var(--aacp-accent-text, var(--aacp-accent))", padding: "8px 12px", fontSize: "12px", fontWeight: 700, cursor: "pointer" }}>Explorar produtos <span aria-hidden="true">→</span></button>
        </div>
      ) : (
        <ul style={{ display: "flex", flexDirection: "column", gap: 0, margin: 0, padding: 0, listStyle: "none" }}>
          {items.map((item, index) => {
            const productImage = item.image ?? item.images?.[0];
            return <li key={item.id} style={{ padding: "14px 16px 15px", borderBottom: index === items.length - 1 ? 0 : "1px solid var(--aacp-line)", background: index % 2 === 0 ? "transparent" : "color-mix(in srgb, var(--aacp-surface-2) 62%, transparent)" }}>
              <article style={{ display: "grid", gridTemplateColumns: "62px minmax(0, 1fr)", gap: "12px", alignItems: "start" }}>
                <div style={{ width: "62px", height: "72px", overflow: "hidden", borderRadius: "12px", background: "var(--aacp-surface-3)", display: "grid", placeItems: "center", color: "var(--aacp-muted)", fontSize: "17px", fontWeight: 750, border: "1px solid var(--aacp-line)", boxShadow: "inset 0 1px 0 color-mix(in srgb, var(--aacp-fg) 8%, transparent)" }}>
                  {productImage ? <img src={productImage} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : item.name.slice(0, 1).toUpperCase()}
                </div>
                <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: "8px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "flex-start" }}>
                    <div style={{ minWidth: 0, paddingTop: "1px" }}><strong style={{ display: "block", color: "var(--aacp-fg)", fontSize: "13px", lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.name}</strong><div style={{ display: "flex", alignItems: "center", gap: "7px", marginTop: "5px", minHeight: "12px" }}><Rating rating={item.rating} reviewCount={item.reviewCount} />{item.description && !item.rating && <span style={{ color: "var(--aacp-muted)", fontSize: "11px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.description}</span>}</div></div>
                    <span style={{ color: "var(--aacp-accent-text, var(--aacp-accent))", fontSize: "14px", fontWeight: 800, letterSpacing: "-0.2px", whiteSpace: "nowrap", lineHeight: 1.25 }}>{item.priceFormatted}</span>
                  </div>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", color: item.inStock ? "var(--aacp-success)" : "var(--aacp-muted)", fontSize: "10.5px", fontWeight: 700, lineHeight: 1 }}><span aria-hidden="true" style={{ width: "6px", height: "6px", borderRadius: "50%", background: item.inStock ? "var(--aacp-success)" : "var(--aacp-muted)", boxShadow: item.inStock ? "0 0 0 3px color-mix(in srgb, var(--aacp-success) 11%, transparent)" : undefined }} />{item.inStock ? "Disponível para envio" : "Indisponível no momento"}</span>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", paddingTop: "1px" }}>
                    <button data-neu="control" type="button" disabled={!item.inStock} onClick={() => onQuickReply?.(`Adicionar ${item.name} ao carrinho`)} style={{ display: "inline-flex", alignItems: "center", gap: "7px", border: "1px solid color-mix(in srgb, var(--aacp-accent) 46%, var(--aacp-line))", borderRadius: "10px", background: item.inStock ? "var(--aacp-accent)" : "var(--aacp-surface-3)", color: item.inStock ? "var(--aacp-fg)" : "var(--aacp-muted)", padding: "7px 10px", fontSize: "11px", fontWeight: 750, cursor: item.inStock ? "pointer" : "not-allowed", opacity: item.inStock ? 1 : 0.62 }}><BagIcon /> Adicionar ao carrinho</button>
                    <button data-neu="text" type="button" onClick={() => onQuickReply?.(`Remover ${item.name} da lista de desejos`)} aria-label={`Remover ${item.name} da lista de desejos`} style={{ display: "inline-flex", alignItems: "center", gap: "6px", border: 0, background: "transparent", color: "var(--aacp-muted)", padding: "7px 2px", fontSize: "11px", fontWeight: 650, cursor: "pointer" }}><RemoveIcon /> Remover</button>
                  </div>
                </div>
              </article>
            </li>;
          })}
        </ul>
      )}
    </section>
  );
}
