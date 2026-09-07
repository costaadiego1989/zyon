# ref-structure.md — Barba de Respeito Product Page Structure

URL: https://barbaderespeito.com.br/products/blend-original-shampoo-ice-220-ml
Title: Blend Original Para Crescimento de Barba + Shampoo Para Barba Ice 220 ml
Captured: 2026-09-07

## Section List (in render order)

| # | Section | Type | Y offset (px) | Notes |
|---|---------|------|---------------|-------|
| 1 | Announcement bar (utility) | Text marquee (duplicated 20x — A11y noise) | 0 | "Frete Grátis acima de R$149,90*" + "Barba na cara ou sua grana de volta." |
| 2 | Header | Sticky | ~0 | Search + Logo + Conta/Carrinho + Primary nav (4 categories) |
| 3 | **HERO: Gallery + Buy box** | Two-column | ~150 | Left: 10 thumbnails + main image + Zoom + Avançar arrow. Right: Title + 14% OFF + price/installments + Add-to-cart + Coupon "BARBA15" + trust carousel (6) + 7 FAQ accordions |
| 4 | **Compare os tamanhos** | Side-by-side + image | 1499 | "Blend Original ou Blendzão?" — 30ml vs 100ml with illustration + 90ml promo |
| 5 | **Aprovado por +2.000.000** | Hero stat | 2010 | "10 anos no mercado • resultados permanentes • sem minoxidil" |
| 6 | **Videos — Resultados Reais** | 4-up grid | 2182 | 4 article cards: "EM ALTA 534k+", "256k+", "598k+", "134k+" |
| 7 | **Depoimentos / Testimonials** | Carousel (8 slides) | 2867 | "NÃO SOMOS NÓS QUEM ESTAMOS FALANDO!" — 4.5/5 (4272 reviews) + 8 testimonial cards with VERIFICADO badge, optional photo |
| 8 | **Antes/Depois Slider** | Interactive image-comparison | 3489 | "SE LIGA NESSE RESULTADO COM APENAS 4 MESES DE USO" — slider 52% + 90% stat + 4 benefit list items |
| 9 | **Funciona pra você que** (Para quem é) | 3-article grid | 4050 | 3 articles: "Tem medo de efeitos colaterais" / "Não tem boa genética" / "Já tentou vários produtos" |
| 10 | **Principais Ativos** (Ingredientes) | 3-article grid | 4638 | 3 articles with emoji: Vitaminas H/B7, Ativos Naturais, Fórmula Exclusiva |
| 11 | **Tabs (PDP detail)** | Tabs | 5068 | 4 buttons: Descrição \| Principais Características \| Modo de Uso \| Principais Dúvidas (only one panel shows at a time) |
| 12 | **Avaliações de clientes** | Reviews block | ~5300 | Shopify native — "ainda sem avaliações" + "Escrever uma avaliação" button |
| 13 | **Footer** | Standard | ~5500 | Newsletter signup, Links Úteis, Políticas, Contato, Social (IG/FB/YT/X/TikTok) |

## Structural Counts

| Item | Count |
|------|-------|
| Testimonials in carousel | 8 slides (1/8 … 8/8) |
| FAQ items in buy box | 7 (accordions) |
| FAQ items in detail tabs | 1 panel (Principais Dúvidas) |
| Videos | 4 (each tagged "EM ALTA" with view count) |
| Gallery images | 10 thumbnails |
| Trust badges | 6 (Satisfação Garantida, Registro ANVISA, Resultado Permanente, Pagamento Seguro, Envio Rápido, Compra Protegida) |
| Tab panels | 4 (Descrição, Características, Modo de Uso, Dúvidas) |
| Customer reviews shown | 0 ("ainda sem avaliações" — none) |
| Comparison tables | 0 (visual side-by-side, not tabular) |

## Presence / Absence

- Comparison table: **No** (visual comparison only — 30ml vs 100ml illustration)
- Sticky buy box: **Yes** — `.product-single__sticky` position:sticky top:20px
- Sticky header: **Yes** — `.header-section` position:sticky top:0
- Sticky bottom CTA bar: **No** (not detected)
- Tabs: **Yes** (4-tab PDP detail — Descrição / Características / Modo de Uso / Dúvidas)
- Accordions: **Yes** (7 in buy box, 1 panel-style in Dúvidas tab)
- Carousels: **Yes** (announcement bar text marquee, trust badge carousel, video grid (4 visible), testimonials carousel 8 slides)
- Image-compare slider: **Yes** (Antes/Depois with 52% handle, drag interaction)
- Video player: **Embedded video thumbnails** with "Reproduzir vídeo" buttons (Shopify-style video embeds, not iframe)
- Lightbox / Zoom: **Yes** ("Zoom" button visible on main gallery image)
- "Você também pode gostar" / Related products: **No** (not present in this PDP)
- Breadcrumbs: **No** (not visible)
- Stock/Inventory indicator: **No**
- Variant selector (size/color): **No** (single product)
- Quantity selector: **No visible** (Add-to-cart is a single button, not Qty+Add)
- Promo banner: **Coupon "BARBA15" 15% off** (10 anos aniversário block in buy box) + percentage off badge "14% OFF" near title
- Newsletter popup: **Yes** (Edrone iframe popup — 5% OFF) — dismissed during capture
- Exit-intent / modal: **Yes** (`prime-modal` fixed)
- Sticky elements total: header + buy box + iframe predictive + modals

## Notable Layout Decisions

1. **Sticky buy box** on desktop — the right column (title/price/CTA/trust/FAQ) is `position: sticky; top: 20px` so it follows the user through the long content stream. Strong CRO pattern.
2. **No related-products carousel** below the tabs. Footer flows directly from reviews. This is unusual for PDPs.
3. **Custom content sections** (all section IDs e356 / e376 / e381 / e420 / e630 / e663 / e684) are implemented as Shopify sections (page blocks) — easy to add/reorder in admin.
4. **Testimonial carousel is 1-card-wide** with 8 slides, dot pagination (6 dots visible) + prev/next arrows. Each card has avatar, name, city, star rating, quote, "VERIFICADO" badge, optional user photo.
5. **Before/After is a custom interactive slider** at 52% (manual drag), paired with a 90% stat and a 4-item benefit list — this is a dedicated result-section, not the same as gallery.
6. **FAQ appears twice** — once in the buy box (7 quick Q's, native `<details>` accordions) and once in the "Principais Dúvidas" tab. Likely the same content duplicated for SEO + convenience.
7. **Tabs (Descrição | Características | Modo de Uso | Dúvidas)** are radio-style toggle buttons — only one panel visible at a time. "ainda sem avaliações" is a Shopify native reviews block that shows 0 reviews for this product.
8. **Videos are 4 thumbnails** (vertical format like TikTok/Reels) with "EM ALTA" badge + view count (534k+, 256k+, 598k+, 134k+) — social-proof-first video pattern.
9. **Announcement bar uses aggressive text-marquee** — same text repeated 20x in the A11y tree (Shopify slider with 2 frames looped).
10. **No "Quantidade" input** next to Add-to-cart. Single-click purchase.
