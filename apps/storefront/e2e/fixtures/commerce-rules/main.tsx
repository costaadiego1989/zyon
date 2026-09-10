import { useState } from "react";
import { createRoot } from "react-dom/client";
import ProductCardBlock from "../../../src/components/blocks/ProductCardBlock";
import CartSummaryBlock from "../../../src/components/blocks/CartSummaryBlock";
import RichProductContentRenderer from "../../../src/components/blocks/RichProductContentRenderer";
import CrossSellBlock from "../../../src/components/blocks/CrossSellBlock";
import { CartProvider } from "../../../src/lib/cart-store";

const notices = [{ ruleId: "quantity", message: "Se quantidade total no carrinho a partir de 2 itens: até 15% de desconto no carrinho." },
  { ruleId: "pix", message: "Se pagamento igual a Pix e valor dos produtos no carrinho acima de R$ 100,00: frete grátis." }];
function Fixture() {
  const [count, setCount] = useState(1);
  const [selection, setSelection] = useState("");
  const [postCart, setPostCart] = useState(true);
  const [added, setAdded] = useState(false);
  return <main>
    <h1>Validação dos componentes de comércio</h1>
    <section aria-label="Produto"><ProductCardBlock block={{ type: "product_card", data: { id: "product", name: "Produto com regras",
      price: 10000, priceFormatted: "R$ 100,00", inStock: true, detailed: true, ruleNotices: notices } }}
      onQuickReply={() => { setAdded(true); setCount(2); }} /></section>
    <section aria-label="Produto com conteúdo"><RichProductContentRenderer blocks={[]} faqs={[]} testimonials={[]} videos={[]} purchase={{
      productName: "Produto com conteúdo", defaultVariantId: "v1", priceReais: 100, variants: [{ id: "v1", attributes: {}, available: true, priceReais: 100, currency: "BRL", lowStock: false }],
      images: [], optionGroups: [], ruleNotices: notices,
    }} narrationEnabled={false} /></section>
    <label><input type="checkbox" checked={postCart} onChange={(e) => setPostCart(e.target.checked)} />Sugestões após adicionar</label>
    <section aria-label="Carrinho"><CartSummaryBlock block={{ type: "cart_summary", data: {
      items: [{ variantId: "v1", productName: "Produto com regras", quantity: count, price: 100, subtotal: count * 100 }],
      itemCount: count, total: count === 1 ? 100 : 190, discount: count === 1 ? 0 : 10,
      nextNudge: count === 1 ? { message: "Adicione mais 1 item para até 15% de desconto no carrinho", kind: "cart_item_count", gap: 1, reachable: true } : undefined,
      activeRules: count === 2 ? [{ message: "R$ 10,00 de desconto aplicado" }] : [],
    } }} /></section>
    <button onClick={() => { setCount(1); setAdded(false); }}>Reduzir quantidade</button>
    {added && postCart ? <section aria-label="Complementos"><CrossSellBlock block={{ type: "cross_sell", data: {
      trigger: "Produtos que podem complementar seu pedido", products: [{ id: "variant-complement", name: "Complemento real", price: 25, priceFormatted: "R$ 25,00", inStock: true }],
    } }} onQuickReply={setSelection} /></section> : null}
    <output>{selection}</output>
  </main>;
}
const style = document.createElement("style");
style.textContent = ":root { --aacp-fg:#182322; --aacp-muted:#586561; --aacp-accent:#14766c; --aacp-line:#d6dedb; --aacp-surface:#fff; --aacp-surface-2:#f4f7f6; --aacp-font:Arial; --aacp-bg:#fff } * { box-sizing:border-box } body { margin:0; font-family:Arial; color:var(--aacp-fg) } main { width:min(100%,680px); margin:auto; padding:16px } section { margin-block:24px }";
document.head.append(style);
createRoot(document.getElementById("root")!).render(<CartProvider><Fixture /></CartProvider>);
