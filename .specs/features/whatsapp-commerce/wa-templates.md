# WhatsApp Commerce — Templates Alinhados aos Componentes do Storefront

**Created:** 2026-08-21
**Source:** Storefront blocks + Widget models + shared-types
**Purpose:** Cada template WhatsApp espelha os dados retornados pelos mesmos componentes visuais

---

## Mapeamento: Componente Visual → Template WhatsApp

| Componente Storefront/Widget | Template WhatsApp |
|------------------------------|-------------------|
| `ProductCardBlock` | `WA_PRODUCT_CARD` |
| `ProductCarouselBlock` | `WA_PRODUCT_LIST` |
| `CategoryCarouselBlock` | `WA_CATEGORY_LIST` |
| `CartSummaryBlock` | `WA_CART_NOTIFICATION` |
| `CartPanel` (widget) | `WA_CART_FULL` |
| `ShippingOptionsBlock` | `WA_SHIPPING_OPTIONS` |
| `OrderConfirmationBlock` | `WA_ORDER_CONFIRMED` |
| `CrossSellBlock` | `WA_CROSS_SELL` |
| `PixWaiting` (widget) | `WA_PAYMENT_LINK` |
| `OfferBanner` (widget) | `WA_OFFER_APPLIED` |
| `CheckoutExperienceSnapshot` | `WA_STAGE_*` (por stage) |

---

## WA_PRODUCT_CARD

**Source:** `ProductCardBlock.data`
**Fields used:** `name`, `priceFormatted`, `description`, `rating`, `reviewCount`, `inStock`, `originalPriceFormatted`, `discountPercent`, `sellerName`, `variants`

```
🛍️ *{name}*
{discountPercent ? "🏷️ -{discountPercent}%" : ""}
{originalPriceFormatted ? "~{originalPriceFormatted}~" : ""}
*{priceFormatted}*

{description ? description.slice(0, 120) : ""}

{rating ? "⭐ {rating} ({reviewCount} avaliações)" : ""}
{inStock ? "🟢 Em estoque" : "🔴 Esgotado"}
{sellerName ? "🏪 Vendido por {sellerName}" : ""}
{variants?.length ? "📐 Variantes: {variants.map(v => v.value).join(", ")}" : ""}

━━━━━━━━━━━━━━━━━
1️⃣ Adicionar ao Carrinho
2️⃣ Mais Informações
3️⃣ Ver Avaliações
4️⃣ Tirar Dúvidas
5️⃣ Comparar
6️⃣ Lista de Desejos
7️⃣ Produtos Semelhantes
↩️ 0 — Voltar
```

**Regras de exibição:**
- `discountPercent` → só se > 0
- `originalPriceFormatted` → só se diferente de `priceFormatted`
- `rating` → só se existe
- `sellerName` → só em produtos marketplace
- `variants` → só se array não vazio
- Se `!inStock` → opção "Adicionar ao Carrinho" substituída por "⚠️ Avise quando disponível"

---

## WA_PRODUCT_LIST

**Source:** `ProductCarouselBlock.data.products[]`
**Fields used:** `name`, `priceFormatted`, `inStock`, `discountPercent`

```
🛍️ *{categoryName || query || "Produtos"}*

1️⃣ {products[0].name} — {products[0].priceFormatted}{products[0].discountPercent ? " 🏷️-" + products[0].discountPercent + "%" : ""}{!products[0].inStock ? " ⚠️" : ""}
2️⃣ {products[1].name} — {products[1].priceFormatted}...
3️⃣ {products[2].name} — {products[2].priceFormatted}...
4️⃣ {products[3].name} — {products[3].priceFormatted}...
5️⃣ {products[4].name} — {products[4].priceFormatted}...

{nextCursor ? "⬇️ 6 — Carregar mais" : ""}
↩️ 0 — Voltar

_Responda com o número do produto_
```

**Regras:**
- Máximo 5 produtos por página (WhatsApp readability)
- `⬇️ 6` só aparece se `nextCursor` existe
- Produto esgotado: `⚠️` ao lado do preço
- Desconto: `🏷️ -X%` inline ao lado do preço
- Nome truncado a 30 chars se necessário

---

## WA_CATEGORY_LIST

**Source:** `CategoryCarouselBlock.data.categories[]`
**Fields used:** `name`, `emoji`, `productCount`

```
📂 *Categorias*

1️⃣ {categories[0].emoji || "📦"} {categories[0].name}{categories[0].productCount ? " (" + categories[0].productCount + ")" : ""}
2️⃣ {categories[1].emoji || "📦"} {categories[1].name}...
3️⃣ {categories[2].emoji || "📦"} {categories[2].name}...
4️⃣ {categories[3].emoji || "📦"} {categories[3].name}...
5️⃣ {categories[4].emoji || "📦"} {categories[4].name}...

{more ? "⬇️ 6 — Mais categorias" : ""}
↩️ 0 — Menu principal

_Responda com o número da categoria_
```

**Regras:**
- Emoji da categoria vem do banco (`category.emoji`)
- Se não tem emoji → fallback `📦`
- `productCount` entre parênteses se disponível
- Máximo 5 por página (pode chegar a 10 se poucas categorias)

---

## WA_CART_NOTIFICATION

**Source:** `CartSummaryBlock.data`
**Fields used:** `items[-1].productName`, `itemCount`, `total`, `discount`

```
✅ *{lastItem.productName}* adicionado!

🛒 {itemCount} {itemCount === 1 ? "item" : "itens"} — *{formatCurrency(total)}*
{discount ? "🏷️ Desconto aplicado: -{formatCurrency(discount)}" : ""}

1️⃣ Ver Carrinho
2️⃣ Continuar Comprando
3️⃣ Produtos Similares
4️⃣ Aplicar Cupom
5️⃣ Finalizar Compra
```

**Regras:**
- Mostra último item adicionado em bold
- Total formatado em BRL
- Se desconto ativo → mostra economia

---

## WA_CART_FULL

**Source:** `CartPanelModel` (widget)
**Fields used:** `items[]`, `totals`

```
🛒 *Seu Pedido* ({itemCount} {itemCount === 1 ? "item" : "itens"})
━━━━━━━━━━━━━━━━━
{items.map((item, i) => 
  "• {item.quantity}x {item.name}{item.variant ? " (" + item.variant + ")" : ""}     {item.lineTotalLabel}"
).join("\n")}
━━━━━━━━━━━━━━━━━
Subtotal:       {totals.subtotalLabel}
{totals.shippingLabel !== "A calcular" ? "Envio:          " + totals.shippingLabel : "Envio:          _a calcular_"}
{totals.discountLabel ? "Desconto:      " + totals.discountLabel : ""}
{totals.serviceFeeLabel ? "Taxa serviço:   " + totals.serviceFeeLabel : ""}
━━━━━━━━━━━━━━━━━
*Total:         {totals.totalLabel}*

🔒 _Nada será cobrado agora — você revisa o valor final antes de confirmar._

1️⃣ Finalizar pedido
2️⃣ Continuar comprando
3️⃣ Remover item
4️⃣ Alterar quantidade
5️⃣ Aplicar cupom
↩️ 0 — Menu principal
```

**Regras:**
- Items formatados: `qty x nome (variant) — preço`
- Separador `━━━` antes e depois dos items
- Totals alinhados visualmente (espaçamento com tabs)
- Trust badge preservado (traduzido do widget)
- Linhas de desconto/taxa só se existem (não mostra "R$ 0,00")
- `shippingLabel = "A calcular"` → itálico

---

## WA_SHIPPING_OPTIONS

**Source:** `ShippingQuote[]` (shared-types)
**Fields used:** `carrier`, `method`, `deliveryDays`, `customerPrice`

```
📦 *Opções de envio para {destinationZip}:*

1️⃣ 🚚 {options[0].carrier} {options[0].method} ({options[0].deliveryDays} dias) — {options[0].customerPrice === 0 ? "Grátis ✨" : formatCurrency(options[0].customerPrice)}
2️⃣ 🚚 {options[1].carrier} {options[1].method} ({options[1].deliveryDays} dias) — {formatCurrency(options[1].customerPrice)}
3️⃣ 🚚 {options[2].carrier} {options[2].method} ({options[2].deliveryDays} dias) — {formatCurrency(options[2].customerPrice)}

_ou pergunte:_
4️⃣ Tem frete grátis?
5️⃣ O prazo está muito longo
6️⃣ Tem transportadora mais rápida?

_Responda com o número_
```

**Regras:**
- Frete grátis → "Grátis ✨" (destaque)
- Dias úteis sempre explícitos
- Carrier + method na mesma linha
- Quick replies de dúvida após as opções

---

## WA_ORDER_CONFIRMED

**Source:** `OrderConfirmationBlock.data` + `order.completed` event
**Fields used:** `orderId`, `items[]`, `total`, `estimatedDelivery`, `trackingCode`

```
🎉 *Pagamento confirmado!*

Pedido *#{orderId}*
━━━━━━━━━━━━━━━━━
{items.map(item => 
  "• {item.quantity}x {item.productName}     {formatCurrency(item.price * item.quantity)}"
).join("\n")}
━━━━━━━━━━━━━━━━━
*Total: {formatCurrency(total)}*

📦 *Entrega:*
• {carrier} — ~{estimatedDelivery}
• Endereço: {address.street}, {address.number}

{trackingCode ? "📬 Rastreio: " + trackingCode : "Código de rastreio será enviado aqui quando disponível."}

━━━━━━━━━━━━━━━━━
Obrigado, {customer.fullName}! 💚
━━━━━━━━━━━━━━━━━

1️⃣ Fazer novo pedido
2️⃣ Quero acompanhar o pedido
3️⃣ Voltar à loja
```

---

## WA_CROSS_SELL

**Source:** `CrossSellBlock.data` / `SuggestedProduct[]`
**Fields used:** `trigger`, `products[].name`, `products[].priceFormatted`, `products[].inStock`

```
💡 *{trigger}*

1️⃣ {products[0].name} — {products[0].priceFormatted}
2️⃣ {products[1].name} — {products[1].priceFormatted}
3️⃣ {products[2].name} — {products[2].priceFormatted}

4️⃣ Continuar sem adicionar

_Responda com o número para adicionar_
```

**Regras:**
- Trigger text vem do engine (ex: "Quem comprou X também gostou de")
- Máximo 3 produtos sugeridos (WhatsApp brevity)
- Opção de skip sempre por último
- Produtos esgotados não aparecem na sugestão

---

## WA_OFFER_APPLIED

**Source:** `OfferBanner` model
**Fields used:** `discountLabel`, `orderTotalLabel`, `shippingLabel`, `savingsLabel`

```
🏷️ *Oferta especial aplicada!*

{discountLabel} no seu pedido
{savingsLabel}

🛒 Novo total: *{orderTotalLabel}*
{shippingLabel === "R$ 0,00" ? "📦 Frete: *Grátis* ✨" : "📦 Frete: " + shippingLabel}

1️⃣ Aceitar oferta e finalizar
2️⃣ Continuar comprando
3️⃣ Recusar oferta
```

---

## WA_PAYMENT_LINK

**Source:** `PaymentIntent` (shared-types)
**Fields used:** `method`, `amount_cents`, `currency`, `expires_at`, `ticket_url` / `invoiceUrl`

### Variante PIX:
```
⚡ *Pagamento via Pix*

Clique no link para pagar:
🔗 {invoiceUrl}

💰 Valor: *{formatCurrency(amount_cents / 100)}*
⏱️ Válido por *{minutesRemaining} minutos*

━━━━━━━━━━━━━━━━━
Após o pagamento, envio a confirmação
automaticamente aqui no WhatsApp! ✅
━━━━━━━━━━━━━━━━━

⚠️ _Não compartilhe este link_
```

### Variante Cartão:
```
💳 *Pagamento via Cartão*

Clique no link para inserir os dados do cartão:
🔗 {checkoutUrl}

💰 Valor: *{formatCurrency(amount_cents / 100)}*
⏱️ Link válido por *30 minutos*
🔒 Pagamento seguro via {gateway} (SSL)

━━━━━━━━━━━━━━━━━
Após a confirmação, envio o recibo aqui! ✅
━━━━━━━━━━━━━━━━━
```

### Variante Boleto:
```
🏦 *Boleto Bancário*

Clique para visualizar/pagar:
🔗 {ticket_url}

💰 Valor: *{formatCurrency(amount_cents / 100)}*
📅 Vencimento: *{formatDate(expires_at)}*

⚠️ _O boleto pode levar até 3 dias úteis para compensar_
```

---

## WA_STAGE_DATA_COLLECTION

**Source:** `CheckoutExperienceSnapshot.stage === "data_collection"` + `copy.quick_replies`

### Solicitação de campo (pattern geral):
```
{emoji} {promptText}

{quickReplies.map((qr, i) => `${i+1}️⃣ ${qr}`).join("\n")}

_ou digite {fieldName} diretamente_
```

### Exemplos por campo:

**Nome:**
```
📝 Qual seu *nome completo*?

1️⃣ Por que precisa do meu nome?
2️⃣ Posso usar nome de empresa?
3️⃣ É seguro informar dados aqui?

_Digite seu nome_
```

**Email:**
```
📧 Qual seu *email*?
_Enviaremos o comprovante por lá_

1️⃣ Vão me mandar SPAM?
2️⃣ Posso usar outro e-mail?
3️⃣ Vocês enviam a nota por e-mail?

_Digite seu email_
```

**CPF:**
```
🆔 Qual seu *CPF*? (apenas números)
_Necessário para nota fiscal_

1️⃣ Por que o CPF é obrigatório?
2️⃣ Posso informar CNPJ?
3️⃣ É seguro enviar meu CPF?

_Digite os 11 números_
```

---

## WA_STAGE_SHIPPING

**Source:** `CheckoutExperienceSnapshot.stage === "shipping"` + `shippingOptions[]`

### CEP:
```
📍 Qual o *CEP* de entrega?

1️⃣ Como calculo o frete?
2️⃣ Entregam em todo o Brasil?
3️⃣ Não sei meu CEP, como faço?

_Digite 8 números (ex: 01310100)_
```

### Endereço encontrado:
```
📍 Encontrei seu endereço:
*{address.street} — {address.city}, {address.state}*

Está correto?

1️⃣ Sim
2️⃣ Não
```

### Número/Complemento:
```
🏠 Qual o *número*?

1️⃣ Minha casa não tem número
2️⃣ Como informo o bloco?
3️⃣ Moro em zona rural
```

---

## WA_STAGE_PAYMENT

**Source:** `CheckoutExperienceSnapshot.stage === "payment"` + `copy.quick_replies` (dinâmico)

```
📋 *Resumo do Pedido*
━━━━━━━━━━━━━━━━━

👤 {customer.fullName}
📍 {address.street}, {address.number}{address.complement ? " — " + address.complement : ""}
     {address.city}, {address.state} — {address.zip}

🛒 *Itens:*
{items.map(item => 
  "• {item.quantity}x {item.name}     {formatCurrency(item.line_total)}"
).join("\n")}
━━━━━━━━━━━━━━━━━
Subtotal:     {formatCurrency(totals.subtotal)}
Envio:        {formatCurrency(totals.shipping)}{shipping.carrier ? " (" + shipping.carrier + ", " + shipping.deliveryDays + " dias)" : ""}
{totals.discount > 0 ? "Desconto:    -" + formatCurrency(totals.discount) : ""}
━━━━━━━━━━━━━━━━━
*💰 Total: {formatCurrency(totals.total)}*

Como deseja pagar?

{paymentQuickReplies.map((qr, i) => `${i+1}️⃣ ${qr}`).join("\n")}
```

**Quick replies dinâmicas (payment stage):**
- `Tenho um cupom de desconto` → só se `couponBoxEnabled && !cart.couponCode`
- `Cartão de crédito` → sempre
- `Cartão de débito` → sempre
- `PIX` → sempre
- `Boleto` → sempre
- `Pagar com crypto` → só se `cryptoPayments.enabled`
- `Quero alterar quantidade` → só se algum item qty > 1
- `Remover item` → só se cart tem 2+ items

---

## WA_MARKETPLACE_PRODUCT

**Source:** `MarketplaceProductsBlock.data`
**Fields used:** `products[].name`, `products[].priceFormatted`, `products[].sellerName`

```
🏪 *Marketplace — Produtos de lojas parceiras*

1️⃣ {products[0].name} — {products[0].priceFormatted}
    _por {products[0].sellerName}_
2️⃣ {products[1].name} — {products[1].priceFormatted}
    _por {products[1].sellerName}_
3️⃣ {products[2].name} — {products[2].priceFormatted}
    _por {products[2].sellerName}_

⬇️ 4 — Carregar mais
↩️ 0 — Voltar

_Responda com o número_
```

---

## Função de Formatação de Preço (WhatsApp Renderer)

```typescript
function formatCurrency(value: number, currency = "BRL"): string {
  return new Intl.NumberFormat("pt-BR", { 
    style: "currency", 
    currency 
  }).format(value);
}

// Para values que vêm em centavos (catálogo):
function formatCentsAsCurrency(cents: number, currency = "BRL"): string {
  return formatCurrency(cents / 100, currency);
}

// Regra: 
// - cart totals, shipping, discount → já em reais → formatCurrency(value)
// - product.price do catálogo → em centavos → formatCentsAsCurrency(price)
// - priceFormatted → já formatado, usar direto
```

---

## Template Registry (implementação)

```typescript
type WhatsAppTemplate = 
  | "WA_PRODUCT_CARD"
  | "WA_PRODUCT_LIST"
  | "WA_CATEGORY_LIST"
  | "WA_CART_NOTIFICATION"
  | "WA_CART_FULL"
  | "WA_SHIPPING_OPTIONS"
  | "WA_ORDER_CONFIRMED"
  | "WA_CROSS_SELL"
  | "WA_PAYMENT_LINK"
  | "WA_OFFER_APPLIED"
  | "WA_STAGE_DATA_COLLECTION"
  | "WA_STAGE_SHIPPING"
  | "WA_STAGE_PAYMENT"
  | "WA_MARKETPLACE_PRODUCT";

// O WhatsAppMenuRenderer recebe o bloco tipado e renderiza o template correto
function renderWhatsAppBlock(block: StorefrontBlock | CheckoutExperience): string {
  switch (block.type) {
    case "product_card": return renderProductCard(block.data);
    case "product_carousel": return renderProductList(block.data);
    case "category_carousel": return renderCategoryList(block.data);
    case "cart_summary": return renderCartNotification(block.data);
    // ... etc
  }
}
```

---

## Notas de Alinhamento

| Aspecto | Storefront/Widget | WhatsApp | Observação |
|---------|-------------------|----------|------------|
| Imagem do produto | Hero 200px | Não enviada (Phase 1) | Phase 2: enviar como media message |
| Variant selector | Color swatches / pills | Texto "Variantes: P, M, G" | Seleção por número se necessário |
| Rating stars | ★★★★☆ visual | "⭐ 4.5 (12 avaliações)" | Texto formatado |
| Discount badge | Pill accent color | "🏷️ -15%" inline | Antes do preço |
| Stock status | Green/red dot | "🟢 Em estoque" / "🔴 Esgotado" | Emoji semântico |
| Trust badge | Shield icon + text | "🔒 _Nada será cobrado agora_" | Itálico |
| CTA buttons | Accent colored buttons | Opções numeradas | Primeiro = CTA principal |
| Quick reply chips | Rounded pills | `N️⃣ texto` por linha | Mesma lista, formato diferente |
| QR Code (Pix) | Imagem renderizada | Link externo | Buyer abre no browser |
| Cart qty controls | +/- buttons | "Alterar quantidade" como opção | Pergunta qual item depois |
| Infinite scroll | IntersectionObserver | "⬇️ N — Carregar mais" | Paginação numérica |
