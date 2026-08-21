# WhatsApp Commerce — UI Text Components & Journey Walkthrough

**Created:** 2026-08-21
**Format:** Text mockups of each WhatsApp message template
**Purpose:** Approve formatting, emoji system, and flow before implementation

---

## Quick Replies Mapeadas → Opções Numeradas (por Stage)

### STOREFRONT ENGINE (14 stages — browsing/catálogo)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ STAGE: welcome                                                               │
├─────────────────────────────────────────────────────────────────────────────┤
│ 1️⃣ Ver Produtos                                                              │
│ 2️⃣ Encontrar Produto                                                         │
│ 3️⃣ Categorias                                                                │
│ 4️⃣ Prazo de Entrega                                                          │
│ 5️⃣ Trocas e Devoluções                                                       │
│ 6️⃣ Rastrear Pedido                                                           │
│ 7️⃣ Meus Dados                                                                │
│ 8️⃣ Ofertas                                                                   │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ STAGE: browsing (após busca/listagem de produtos)                            │
├─────────────────────────────────────────────────────────────────────────────┤
│ 1️⃣ Selecionar Produto                                                        │
│ 2️⃣ Filtrar Produtos                                                          │
│ 3️⃣ Categorias                                                                │
│ 4️⃣ Ofertas do Dia                                                            │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ STAGE: filter (quando filtro está ativo)                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│ 1️⃣ Por Preço                                                                 │
│ 2️⃣ Por Avaliação                                                             │
│ 3️⃣ Mais Vendidos                                                             │
│ 4️⃣ Novidades                                                                 │
│ 5️⃣ Frete Grátis                                                              │
│ 6️⃣ Por Desconto                                                              │
│ 7️⃣ Limpar Filtros                                                            │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ STAGE: categories (lista de categorias)                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│ 1️⃣ Encontrar um Produto                                                      │
│ 2️⃣ Categorias em Promoção                                                    │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ STAGE: product_detail (visualizando um produto)                              │
├─────────────────────────────────────────────────────────────────────────────┤
│ 1️⃣ Adicionar ao Carrinho                                                     │
│ 2️⃣ Mais Informações                                                          │
│ 3️⃣ Ver Avaliações                                                            │
│ 4️⃣ Tirar Dúvidas                                                             │
│ 5️⃣ Comparar                                                                  │
│ 6️⃣ Lista de Desejos                                                          │
│ 7️⃣ Produtos Semelhantes                                                      │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ STAGE: more_info (detalhes extras do produto)                                │
├─────────────────────────────────────────────────────────────────────────────┤
│ 1️⃣ Especificações Técnicas                                                   │
│ 2️⃣ Dimensões e Peso                                                          │
│ 3️⃣ Material                                                                  │
│ 4️⃣ Garantia                                                                  │
│ 5️⃣ Prazo de Entrega                                                          │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ STAGE: reviews (avaliações)                                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│ 1️⃣ Escrever Avaliação                                                        │
│ 2️⃣ Positivas                                                                 │
│ 3️⃣ Negativas                                                                 │
│ 4️⃣ Ordenar por Recentes                                                      │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ STAGE: added_to_cart (produto adicionado)                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│ 1️⃣ Ver Carrinho                                                              │
│ 2️⃣ Continuar Comprando                                                       │
│ 3️⃣ Produtos Similares                                                        │
│ 4️⃣ Aplicar Cupom                                                             │
│ 5️⃣ Finalizar Compra                                                          │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ STAGE: post_purchase (pós-compra)                                            │
├─────────────────────────────────────────────────────────────────────────────┤
│ 1️⃣ Rastrear Pedido                                                           │
│ 2️⃣ Nota Fiscal                                                               │
│ 3️⃣ Alterar Endereço                                                          │
│ 4️⃣ Cancelar Pedido                                                           │
│ 5️⃣ Avaliar Produto                                                           │
│ 6️⃣ Suporte                                                                   │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ STAGE: support                                                               │
├─────────────────────────────────────────────────────────────────────────────┤
│ 1️⃣ FAQ                                                                       │
│ 2️⃣ Falar com Humano                                                          │
│ 3️⃣ Reportar Problema                                                         │
│ 4️⃣ Status do Pedido                                                          │
└─────────────────────────────────────────────────────────────────────────────┘

FALLBACK (quando nenhum stage match):
│ 1️⃣ Ver Produtos                                                              │
│ 2️⃣ Categorias                                                                │
│ 3️⃣ Meus Dados                                                                │
│ 4️⃣ Suporte                                                                   │
```

### CHECKOUT ENGINE (4 stages — coleta dados → pagamento)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ STAGE: data_collection (campo: nome)                                         │
├─────────────────────────────────────────────────────────────────────────────┤
│ 1️⃣ Por que precisa do meu nome?                                              │
│ 2️⃣ Posso usar nome de empresa?                                               │
│ 3️⃣ É seguro informar dados aqui?                                             │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ STAGE: data_collection (campo: email)                                        │
├─────────────────────────────────────────────────────────────────────────────┤
│ 1️⃣ Vão me mandar SPAM?                                                       │
│ 2️⃣ Posso usar outro e-mail?                                                  │
│ 3️⃣ Vocês enviam a nota por e-mail?                                           │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ STAGE: data_collection (campo: CPF)                                          │
├─────────────────────────────────────────────────────────────────────────────┤
│ 1️⃣ Por que o CPF é obrigatório?                                              │
│ 2️⃣ Posso informar CNPJ?                                                      │
│ 3️⃣ É seguro enviar meu CPF?                                                  │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ STAGE: data_collection (campo: telefone)                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│ 1️⃣ Vocês vão me ligar?                                                       │
│ 2️⃣ Mandam rastreio por WhatsApp?                                             │
│ 3️⃣ Por que precisa ser celular?                                              │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ STAGE: data_collection (campo: OTP email)                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│ 1️⃣ Reenviar código de e-mail                                                 │
│ 2️⃣ Não recebi o código                                                       │
│ 3️⃣ Qual e-mail foi usado?                                                    │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ STAGE: data_collection (campo: OTP SMS)                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│ 1️⃣ Reenviar código SMS                                                       │
│ 2️⃣ Não recebi o SMS                                                          │
│ 3️⃣ Posso usar outro número?                                                  │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ STAGE: shipping (campo: CEP)                                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│ 1️⃣ Como calculo o frete?                                                     │
│ 2️⃣ Entregam em todo o Brasil?                                                │
│ 3️⃣ Não sei meu CEP, como faço?                                               │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ STAGE: shipping (campo: confirmar endereço)                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│ 1️⃣ Sim                                                                       │
│ 2️⃣ Não                                                                       │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ STAGE: shipping (campo: número/complemento)                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│ 1️⃣ Minha casa não tem número                                                 │
│ 2️⃣ Como informo o bloco?                                                     │
│ 3️⃣ Moro em zona rural                                                        │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ STAGE: shipping (campo: frete — opções dinâmicas)                            │
├─────────────────────────────────────────────────────────────────────────────┤
│ 1️⃣ PAC (8 dias) — R$ 15,90                                                   │
│ 2️⃣ Sedex (3 dias) — R$ 28,50                                                 │
│ 3️⃣ Transportadora (5 dias) — R$ 22,00                                        │
│                                                                              │
│ _ou pergunte:_                                                               │
│ 4️⃣ Tem frete grátis?                                                         │
│ 5️⃣ O prazo está muito longo                                                  │
│ 6️⃣ Tem transportadora mais rápida?                                           │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ STAGE: payment (formas de pagamento — dinâmico por merchant)                 │
├─────────────────────────────────────────────────────────────────────────────┤
│ 1️⃣ Tenho um cupom de desconto     ← só se couponBox enabled                 │
│ 2️⃣ Cartão de crédito                                                         │
│ 3️⃣ Cartão de débito                                                          │
│ 4️⃣ PIX                                                                       │
│ 5️⃣ Boleto                                                                    │
│ 6️⃣ Pagar com crypto               ← só se crypto enabled                    │
│ 7️⃣ Quero alterar quantidade        ← só se item qty > 1                     │
│ 8️⃣ Remover item                    ← só se cart tem 2+ itens                │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ STAGE: completed (pedido finalizado)                                         │
├─────────────────────────────────────────────────────────────────────────────┤
│ 1️⃣ Obrigado!                                                                 │
│ 2️⃣ Quero acompanhar o pedido                                                 │
│ 3️⃣ Voltar à loja                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### REGRAS DE RENDERIZAÇÃO

1. **Cada resposta do bot SEMPRE termina com quick replies do stage atual**
2. Quick replies do banco são renderizadas como `N️⃣ texto` (1-indexed)
3. Se o stage tem quick replies dinâmicas (frete, payment), elas substituem o default
4. `↩️ 0 — Voltar` adicionado automaticamente quando há menu anterior
5. `⬇️ N — Carregar mais` adicionado quando lista de produtos é paginada
6. Merchant pode customizar quick replies via dashboard (CRUD) — o WhatsApp renderer usa a versão do banco
7. Máximo 10 opções por mensagem (WhatsApp readability)
8. Se buyer digita texto livre quando menu está ativo → LLM interpreta (não força número)

---

## Design System — Text Formatting Rules

### Typography Rules (WhatsApp Markdown)
```
*bold*        → títulos, valores, nomes de produto
_italic_      → observações, prazos
~strikethrough~ → preço antigo (desconto)
```monospace```   → códigos, links técnicos
```

### Emoji System (consistente em toda jornada)

| Contexto | Emoji | Uso |
|----------|-------|-----|
| Saudação | 👋 | Boas vindas |
| Produto | 🛍️ | Listagem de produtos |
| Categoria | 📂 | Nome de categoria |
| Comida | 🍕🍔🥤 | Food service (contextual ao tipo) |
| Carrinho | 🛒 | Status do carrinho |
| Sucesso | ✅ | Confirmação de ação |
| Pagamento | 💳 | Opções de pagamento |
| Pix | ⚡ | Pagamento Pix |
| Entrega | 📦 | Envio/frete |
| Tempo | ⏱️ | Prazos, timers |
| Alerta | ⚠️ | Atenção, validação |
| Celebração | 🎉 | Pedido confirmado |
| Loja | 🏪 | Nome do merchant |
| Voltar | ↩️ | Opção voltar |
| Carregar mais | ⬇️ | Mais itens |

### Formatação de Menu Numerado

```
┌─ Template de Menu ─────────────────────┐
│                                         │
│  [emoji] *Título da Seção*              │
│  ─────────────────────                  │
│  1️⃣ Opção um                           │
│  2️⃣ Opção dois                          │
│  3️⃣ Opção três                          │
│                                         │
│  ⬇️ Mais opções                         │
│  ↩️ 0 — Voltar                          │
│                                         │
│  _Responda com o número_                │
└─────────────────────────────────────────┘
```

### Formatação de Produto

```
┌─ Template de Produto ──────────────────┐
│                                         │
│  🛍️ *Nome do Produto*                   │
│  R$ XX,XX                               │
│                                         │
│  Descrição curta do produto em 1-2      │
│  linhas máximo.                         │
│                                         │
│  1️⃣ Adicionar ao carrinho               │
│  2️⃣ Ver detalhes                         │
│  ↩️ 0 — Voltar                          │
│                                         │
└─────────────────────────────────────────┘
```

### Formatação de Carrinho

```
┌─ Template de Carrinho ─────────────────┐
│                                         │
│  🛒 *Seu Carrinho*                      │
│  ─────────────────────                  │
│  • 2x Pizza Margherita     R$ 84,00    │
│  • 1x Coca-Cola 2L         R$ 12,00    │
│  ─────────────────────                  │
│  Subtotal:          R$ 96,00           │
│  Envio:             _a calcular_        │
│  *Total:            R$ 96,00*          │
│                                         │
│  1️⃣ Finalizar pedido                    │
│  2️⃣ Continuar comprando                 │
│  3️⃣ Remover item                        │
│  4️⃣ Aplicar cupom                       │
│                                         │
└─────────────────────────────────────────┘
```

---

## Jornada Completa — Cada Tela

---

### TELA 01: Boas Vindas (primeira mensagem do buyer)

**Buyer envia:** `Oi`

**Bot responde:**
```
👋 Olá! Bem-vindo à *Casa da Pizza*!

Sou o assistente virtual e posso te ajudar a fazer seu pedido. O que gostaria de fazer?

1️⃣ Ver cardápio
2️⃣ Buscar produto
3️⃣ Ver promoções
4️⃣ Rastrear pedido
5️⃣ Falar com atendente

_Responda com o número ou digite o que procura_
```

**Notas:** Quick replies do stage "welcome" convertidas para números. Merchant name em bold. Tom amigável mas direto.

---

### TELA 02: Categorias (buyer responde "1")

**Buyer envia:** `1`

**Bot responde:**
```
📂 *Categorias*

1️⃣ 🍕 Pizzas
2️⃣ 🍔 Hambúrgueres
3️⃣ 🥤 Bebidas
4️⃣ 🍰 Sobremesas
5️⃣ 🎁 Combos

↩️ 0 — Menu principal

_Responda com o número da categoria_
```

---

### TELA 03: Lista de Produtos (buyer responde "1" → Pizzas)

**Buyer envia:** `1`

**Bot responde:**
```
🍕 *Pizzas*

1️⃣ Calabresa — R$ 45,00
2️⃣ Margherita — R$ 42,00
3️⃣ Frango c/ Catupiry — R$ 48,00
4️⃣ Portuguesa — R$ 47,00
5️⃣ Pepperoni — R$ 50,00

⬇️ 6 — Carregar mais
↩️ 0 — Voltar às categorias

_Responda com o número do produto_
```

---

### TELA 04: Detalhe do Produto (buyer responde "2" → Margherita)

**Buyer envia:** `2`

**Bot responde:**
```
🍕 *Pizza Margherita*
*R$ 42,00*

Massa artesanal, molho de tomate San Marzano, mussarela de búfala, manjericão fresco e azeite extra virgem.

⏱️ Preparo: ~30 min

1️⃣ Adicionar ao carrinho
2️⃣ Escolher tamanho/borda
3️⃣ Ver avaliações
↩️ 0 — Voltar

_Responda com o número_
```

---

### TELA 04B: Variações Food Service (se produto tipo food)

**Buyer responde "2" (Escolher tamanho/borda):**

```
🍕 *Pizza Margherita — Personalizar*

📏 *Tamanho:*
1️⃣ Média (6 fatias) — R$ 42,00
2️⃣ Grande (8 fatias) — R$ 55,00
3️⃣ Família (12 fatias) — R$ 72,00

_Responda com o número do tamanho_
```

**Buyer responde "2" (Grande):**

```
✅ Grande selecionado!

🧀 *Borda:*
1️⃣ Sem borda (incluso)
2️⃣ Catupiry (+R$ 6,00)
3️⃣ Cheddar (+R$ 6,00)
4️⃣ Chocolate (+R$ 8,00)

_Responda com o número_
```

**Buyer responde "1" (Sem borda):**

```
✅ *Resumo do produto:*

🍕 Pizza Margherita
• Tamanho: Grande (8 fatias)
• Borda: Sem borda
• *Valor: R$ 55,00*

1️⃣ ✅ Confirmar e adicionar
2️⃣ ✏️ Alterar opções
↩️ 0 — Cancelar

_Responda com o número_
```

---

### TELA 05: Produto Adicionado ao Carrinho

**Buyer envia:** `1` (Adicionar/Confirmar)

**Bot responde:**
```
✅ *Margherita* adicionada ao carrinho!

🛒 Carrinho: 1 item — R$ 55,00

1️⃣ Finalizar pedido
2️⃣ Continuar comprando
3️⃣ Ver carrinho completo

_Responda com o número_
```

---

### TELA 06: Carrinho Completo (buyer responde "3")

**Buyer envia:** `3`

**Bot responde:**
```
🛒 *Seu Carrinho*
━━━━━━━━━━━━━━━━━
• 1x Pizza Margherita (Grande)     R$ 55,00
• 2x Coca-Cola 2L                  R$ 24,00
━━━━━━━━━━━━━━━━━
*Subtotal: R$ 79,00*
Envio: _a calcular_

1️⃣ Finalizar pedido
2️⃣ Continuar comprando
3️⃣ Remover item
4️⃣ Aplicar cupom
↩️ 0 — Menu principal

_Responda com o número_
```

---

### TELA 07: Início do Checkout — Dados Pessoais

**Buyer envia:** `1` (Finalizar pedido)

**Bot responde:**
```
💳 *Vamos finalizar seu pedido!*

Para prosseguir, preciso de alguns dados.

📝 Qual seu *nome completo*?
```

**Buyer envia:** `João da Silva`

```
✅ Nome registrado!

📧 E qual seu *email*?
_Usaremos para enviar o comprovante_
```

**Buyer envia:** `joao@email.com`

```
✅ Email registrado!

🆔 E o *CPF*? (apenas números)
_Necessário para nota fiscal_
```

**Buyer envia:** `12345678900`

```
✅ Dados completos! Vamos ao endereço de entrega.

📍 Qual o *CEP* de entrega?
```

---

### TELA 08: Endereço + Frete

**Buyer envia:** `01310100`

**Bot responde:**
```
📍 Endereço encontrado:
*Av. Paulista — São Paulo, SP*

Qual o *número*?
```

**Buyer envia:** `1000`

```
E tem *complemento*? (apto, bloco, ref)
_Se não tem, responda "não"_
```

**Buyer envia:** `Apto 42`

```
📦 *Opções de envio:*

1️⃣ 🚚 Motoboy (45 min) — R$ 8,90
2️⃣ 📦 Retirar na loja — Grátis

_Responda com o número_
```

---

### TELA 09: Resumo + Pagamento

**Buyer envia:** `1` (Motoboy)

**Bot responde:**
```
📋 *Resumo do Pedido*
━━━━━━━━━━━━━━━━━

👤 João da Silva
📍 Av. Paulista, 1000 — Apto 42
     São Paulo, SP — 01310-100

🛒 *Itens:*
• 1x Pizza Margherita (Grande)     R$ 55,00
• 2x Coca-Cola 2L                  R$ 24,00
━━━━━━━━━━━━━━━━━
Subtotal:                    R$ 79,00
Envio (Motoboy, 45 min):     R$ 8,90
━━━━━━━━━━━━━━━━━
*💰 Total: R$ 87,90*

Como deseja pagar?

1️⃣ ⚡ Pix
2️⃣ 💳 Cartão de crédito
3️⃣ 🏦 Boleto

_Responda com o número_
```

---

### TELA 10: Link de Pagamento

**Buyer envia:** `1` (Pix)

**Bot responde:**
```
⚡ *Pagamento via Pix*

Clique no link abaixo para pagar:

🔗 https://pay.asaas.com/i/abc123xyz

💰 Valor: *R$ 87,90*
⏱️ Link válido por *30 minutos*

━━━━━━━━━━━━━━━━━
Após o pagamento, envio a confirmação
automaticamente aqui no WhatsApp! ✅
━━━━━━━━━━━━━━━━━

⚠️ _Não compartilhe este link_
```

---

### TELA 11: Confirmação de Pagamento

**(Webhook de pagamento chega — bot envia proativamente):**

```
🎉 *Pagamento confirmado!*

Seu pedido #12847 foi recebido com sucesso.

━━━━━━━━━━━━━━━━━
📋 *Detalhes:*
• 1x Pizza Margherita (Grande)
• 2x Coca-Cola 2L
• Total: R$ 87,90 (Pix)
━━━━━━━━━━━━━━━━━

📦 *Entrega:*
• Motoboy — ~45 minutos
• Endereço: Av. Paulista, 1000 — Apto 42

Quando seu pedido sair para entrega,
envio o código de rastreio aqui. 🚚

━━━━━━━━━━━━━━━━━
Obrigado pela compra, João! 💚
━━━━━━━━━━━━━━━━━

1️⃣ Fazer novo pedido
2️⃣ Falar com atendente
```

---

### TELA 12: Erro / Validação

**Exemplos de mensagens de erro:**

```
⚠️ Não encontrei esse CPF. Verifique se digitou corretamente (11 números, sem pontos).

_Digite novamente:_
```

```
⚠️ CEP não encontrado. Verifique se está correto (8 números).

_Digite novamente ou responda 0 para voltar:_
```

```
⚠️ O link de pagamento expirou.

1️⃣ Gerar novo link
2️⃣ Trocar forma de pagamento
↩️ 0 — Voltar ao resumo
```

---

### TELA 13: Busca Natural (free text)

**Buyer envia:** `tem pizza de calabresa?`

**Bot responde:**
```
🔍 Encontrei:

🍕 *Pizza Calabresa*
R$ 45,00 — Massa tradicional, calabresa fatiada, cebola e azeitonas.

1️⃣ Adicionar ao carrinho
2️⃣ Escolher tamanho/borda
3️⃣ Ver mais opções de pizza
↩️ 0 — Menu principal

_Responda com o número_
```

---

### TELA 14: Cupom

**Buyer envia:** `4` (Aplicar cupom no carrinho)

**Bot responde:**
```
🎟️ Digite o *código do cupom*:
```

**Buyer envia:** `PRIMEIRACOMPRA`

```
✅ Cupom *PRIMEIRACOMPRA* aplicado!
Desconto de 10% — Economia de R$ 7,90

🛒 *Carrinho atualizado:*
Subtotal:    ~R$ 79,00~  → R$ 71,10
Envio:       R$ 8,90
*Total:      R$ 80,00*

1️⃣ Finalizar pedido
2️⃣ Continuar comprando
```

---

### TELA 15: Remover Item

**Buyer envia:** `3` (Remover item no carrinho)

**Bot responde:**
```
Qual item deseja remover?

1️⃣ Pizza Margherita (Grande) — R$ 55,00
2️⃣ Coca-Cola 2L (x2) — R$ 24,00
↩️ 0 — Cancelar

_Responda com o número_
```

**Buyer envia:** `2`

```
✅ *Coca-Cola 2L* removida do carrinho.

🛒 Carrinho: 1 item — R$ 55,00

1️⃣ Finalizar pedido
2️⃣ Continuar comprando
```

---

## Regras de Formatação

### 1. Separadores
- `━━━━━━━━━━━━━━━━━` para seções financeiras (resumo, total)
- Linha em branco entre blocos lógicos

### 2. Hierarquia
- `*bold*` para títulos de seção e valores monetários
- Emoji no início de cada bloco
- Números com emoji (`1️⃣ 2️⃣ 3️⃣`) para opções
- `↩️ 0` sempre por último como "voltar"
- `⬇️ 6` ou similar para "carregar mais"

### 3. Tamanho
- Máximo 1024 caracteres por mensagem (limite WhatsApp)
- Se exceder → dividir em 2 mensagens (primeira com conteúdo, segunda com opções)
- Nunca mais que 10 opções numeradas por menu

### 4. Tom de Voz
- Direto, amigável, profissional
- Sem excesso de emoji (1-2 por bloco, não por linha)
- Confirmações curtas (`✅ Adicionado!`)
- Erros claros com instrução de correção
- Sempre terminar com instrução do que fazer (`_Responda com..._`)

### 5. Preços
- Sempre `R$ XX,00` (com centavos)
- Preço original riscado quando desconto: `~R$ 79,00~`
- Total em bold: `*R$ 87,90*`

### 6. Quick Replies → Números

Mapeamento do banco:
```
StoreQuickRepliesConfig.stages["welcome"].replies = [
  "Ver Produtos",      → 1️⃣ Ver cardápio
  "Encontrar Produto", → 2️⃣ Buscar produto
  "Categorias",        → mapped to categoria flow
  "Ofertas",           → 3️⃣ Ver promoções
  ...
]
```

Cada quick reply do banco é uma opção numerada. O `WhatsAppMenuRenderer` converte usando o index.

---

## Estados Especiais

### Sessão Expirada (24h sem atividade)

```
👋 Olá de novo! Sua sessão anterior expirou.

Gostaria de retomar de onde parou?
_Seu carrinho anterior tinha 2 itens (R$ 79,00)_

1️⃣ Retomar carrinho anterior
2️⃣ Começar novo pedido
```

### Handoff para Humano

```
🙋 Entendi! Vou transferir você para um atendente.

Aguarde um momento, por favor.
_Tempo médio de espera: ~5 minutos_

Enquanto isso, posso ajudar com algo mais?
```

### Mensagem Não Compreendida

```
🤔 Não entendi sua mensagem.

Você pode:
1️⃣ Ver o cardápio
2️⃣ Ver seu carrinho
3️⃣ Falar com atendente

_Ou tente reformular sua pergunta_
```

---

## Validações por Campo

| Campo | Validação | Mensagem de erro |
|-------|-----------|-----------------|
| Nome | 2+ tokens, sem números | "Nome precisa ter nome e sobrenome, sem números" |
| Email | Regex válido | "Formato de email inválido. Ex: nome@email.com" |
| CPF | 11 dígitos | "CPF precisa ter 11 números, sem pontos" |
| CEP | 8 dígitos | "CEP precisa ter 8 números" |
| Número end. | 1-6 dígitos ou "S/N" | "Número do endereço inválido" |

---

## Métricas por Mensagem

Cada mensagem enviada deve trackear:
- `whatsapp.message.sent` — tipo (menu/confirmação/erro/pagamento)
- `whatsapp.menu.selected` — qual opção o buyer escolheu
- `whatsapp.freetext.used` — buyer digitou texto livre (indica que menu não bastou)
- `whatsapp.session.stage_changed` — transição entre stages
- `whatsapp.payment.link_sent` — link de pagamento gerado
- `whatsapp.payment.confirmed` — pagamento confirmado via webhook
