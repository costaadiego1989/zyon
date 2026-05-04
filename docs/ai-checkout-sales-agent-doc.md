# AI Checkout Sales Agent

## Checkout conversacional, negociador, inteligente em frete e embedável para aumentar conversão em e-commerce

**Versão:** 1.0  
**Data:** 2026-04-30  
**Produto:** AI Checkout Sales Agent  
**Conceito:** um agente de vendas autônomo no checkout, com inteligência de negociação, frete, pagamento, recuperação e proteção de margem.

---

# 1. Visão geral

O **AI Checkout Sales Agent** é uma camada inteligente e embedável de checkout conversacional que substitui ou complementa o checkout tradicional com um agente autônomo de vendas.

Esse agente conversa com o comprador, entende objeções, detecta risco de abandono, negocia ofertas, controla frete, sugere meios de pagamento, aplica descontos autorizados e conduz o usuário até a compra.

Este produto não é apenas um chatbot. É um sistema de decisão comercial em tempo real.

Ele combina:

- Conversa com IA.
- Regras comerciais.
- Proteção de margem.
- Inteligência de frete.
- Otimização de pagamento.
- Detecção de abandono.
- Recuperação omnichannel.
- Analytics de conversão.

---

# 2. Definição do produto

## 2.1 O que é

Um **AI Sales Closer para checkout**: um agente de vendas sênior, embedável em lojas online, que atua durante o checkout para converter usuários indecisos, negociar condições e recuperar compras abandonadas.

## 2.2 Problema que resolve

E-commerces perdem receita por:

- Abandono de carrinho.
- Frete caro ou inesperado.
- Falta de confiança.
- Dúvidas não respondidas no checkout.
- Falha de pagamento.
- Falta de negociação.
- Checkout frio e passivo.
- Cupons genéricos que reduzem margem sem critério.

O checkout tradicional é estático. Ele espera o usuário comprar.  
O AI Checkout Sales Agent atua como um vendedor que tenta fechar a venda no momento mais crítico.

## 2.3 Por que soluções atuais não bastam

### Stripe, Mercado Pago, PayPal, Adyen

Resolvem pagamento, não negociação.

### Shopify, WooCommerce, VTEX, Nuvemshop

Resolvem infraestrutura de loja e checkout, mas não têm um agente comercial autônomo especializado em conversão, objeção, frete, margem e fechamento.

### Chatbots

Respondem dúvidas, mas normalmente não:

- Calculam margem.
- Negociam dentro de regras.
- Aplicam desconto controlado.
- Otimizam frete.
- Recuperam pagamento.
- Medem receita incremental.

### Apps de desconto

Aplicam cupom, mas não sabem se o cliente realmente precisava de desconto.

### Apps de frete

Calculam frete, mas não negociam frete como alavanca de conversão.

---

# 3. Posicionamento

## 3.1 Categoria

**AI Checkout Conversion Platform**

## 3.2 Pitch curto

Transforme seu checkout em um vendedor IA que conversa, negocia, controla frete, protege margem e fecha vendas em tempo real.

## 3.3 Pitch expandido

O AI Checkout Sales Agent é uma camada de checkout inteligente que identifica hesitação, entende objeções como preço, frete e confiança, negocia ofertas autorizadas, sugere meios de pagamento e recupera carrinhos abandonados por WhatsApp, e-mail ou SMS.

## 3.4 Promessa principal

Aumentar conversão sem destruir margem.

---

# 4. Princípios do produto

1. **LLM conversa, regra decide.**
2. **Nenhum desconto sem autorização.**
3. **Nenhum frete grátis sem cálculo de margem.**
4. **Nenhuma promessa sem fonte confiável.**
5. **O agente deve vender, não apenas responder.**
6. **Toda decisão deve ser auditável.**
7. **O lojista controla os limites.**
8. **A IA deve reduzir fricção, não aumentar.**
9. **Checkout precisa ser rápido.**
10. **Conversão e margem devem andar juntas.**

---

# 5. Framework de execução estilo Superpowers

A documentação será organizada como um conjunto de “skills” do sistema, inspirado em frameworks agentivos de desenvolvimento: cada habilidade tem gatilho, entrada, processo, saída e gate de segurança.

## 5.1 Superpowers principais

- Detectar hesitação.
- Diagnosticar objeção.
- Negociar preço.
- Controlar frete.
- Proteger margem.
- Otimizar pagamento.
- Fechar compra.
- Recuperar abandono.
- Aprender com conversas.

---

# 6. Core Features

---

# 6.1 Conversational Checkout

## Descrição

Interface de checkout baseada em chat, embutida na loja, onde o usuário pode finalizar a compra conversando com um agente IA.

## Modos de uso

### 1. Modo assistente

O checkout tradicional continua visível. O agente aparece como suporte comercial.

### 2. Modo híbrido

O usuário vê checkout tradicional, mas o agente interfere quando detecta hesitação.

### 3. Modo conversacional completo

O checkout inteiro vira conversa.

### 4. Modo recovery

O agente continua a conversa fora do site, por WhatsApp, e-mail ou SMS.

## Recomendação para MVP

Começar pelo **modo híbrido**.

Motivo: menor atrito de integração, menor risco de UX e mais fácil provar aumento de conversão.

## Quando o chat deve abrir

O chat não deve abrir imediatamente para todo mundo.

Deve abrir quando houver sinais como:

- Inatividade no checkout.
- Clique no campo de cupom.
- Movimento de saída.
- Retorno para etapa anterior.
- Erro de pagamento.
- Visualização de frete alto.
- Abandono iminente.
- Usuário digitando dúvida.
- Alto valor de carrinho.

## Exemplo de abordagem inicial

> Vi que você está finalizando o pedido. Posso te ajudar a encontrar a melhor condição para concluir agora?

---

# 6.2 Decision Engine

## Descrição

O Decision Engine é o cérebro comercial do produto.

Ele decide:

- Se o agente deve intervir.
- Qual objeção está acontecendo.
- Se pode oferecer desconto.
- Se pode oferecer frete grátis.
- Se pode oferecer frete subsidiado.
- Se deve sugerir parcelamento.
- Se deve recuperar por WhatsApp.
- Se deve escalar para humano.

## Inputs

- Valor do carrinho.
- Itens do carrinho.
- Margem por SKU.
- Custo do produto.
- Custo de frete.
- Região de entrega.
- Prazo de entrega.
- Histórico do cliente.
- Dispositivo.
- Origem de tráfego.
- Tempo parado.
- Cliques em cupom.
- Erros de pagamento.
- Estoque.
- Campanhas ativas.
- Regras do lojista.
- Score de abandono.

## Outputs

- Abrir chat.
- Não abrir chat.
- Oferecer desconto.
- Oferecer frete grátis.
- Oferecer frete parcial.
- Oferecer brinde.
- Oferecer parcelamento.
- Explicar benefício.
- Recuperar depois.
- Bloquear oferta.

## Separação entre IA e regra

### IA faz

- Conversa.
- Interpretação de linguagem.
- Classificação de objeção.
- Adaptação de tom.
- Explicação da proposta.

### Regra faz

- Aprovação de desconto.
- Aprovação de frete grátis.
- Cálculo de margem.
- Limite de oferta.
- Validação de estoque.
- Validação de prazo.
- Auditoria.

---

# 6.3 Negotiation Engine

## Descrição

Sistema que permite o agente negociar com o comprador dentro de limites comerciais definidos.

## Tipos de negociação

- Desconto percentual.
- Desconto fixo.
- Frete grátis.
- Frete parcial.
- Brinde.
- Upgrade de envio.
- Parcelamento.
- Pix com desconto.
- Oferta por tempo limitado.

## Regras base

- Nunca ultrapassar desconto máximo.
- Nunca reduzir margem abaixo do mínimo.
- Nunca acumular benefícios sem autorização.
- Nunca aplicar frete grátis se o custo inviabilizar a venda.
- Nunca prometer entrega sem SLA real.

## Exemplo de política

```json
{
  "merchant_id": "mrc_123",
  "max_discount_percent": 12,
  "minimum_margin_percent": 38,
  "allow_free_shipping": true,
  "allow_shipping_discount": true,
  "allow_bonus_item": true,
  "allow_stack_discount_and_free_shipping": false
}
```

## Exemplo de negociação

Usuário:

> Está caro. Tem desconto?

Agente:

> Consigo verificar uma condição melhor para você. Você prefere desconto no produto ou ajuda no frete?

Usuário:

> O frete também está caro.

Agente consulta Decision Engine.

Resposta:

> Para esse carrinho, consigo liberar frete grátis ou 8% de desconto. O melhor para você agora é o frete grátis, porque economiza R$32,90. Quer que eu aplique?

---

# 6.4 Payment Optimization

## Descrição

O agente também deve ajudar o usuário a pagar com menos fricção.

## Recursos

- Sugerir Pix com desconto.
- Sugerir parcelamento.
- Sugerir outro cartão.
- Recuperar falha de pagamento.
- Criar link de pagamento.
- Explicar segurança.
- Reforçar garantia.

## Exemplo

Evento: cartão recusado.

Agente:

> O pagamento não passou, mas isso acontece bastante por autenticação ou limite do banco. Posso te oferecer Pix com aprovação imediata ou tentar outro cartão. Qual prefere?

---

# 6.5 Abandonment Detection

## Descrição

Sistema que calcula em tempo real a probabilidade de abandono.

## Sinais

- Inatividade.
- Clique em cupom.
- Frete visto e abandono.
- Cartão recusado.
- Aba alternada.
- Movimento de saída.
- Tempo alto no checkout.
- Campo obrigatório com erro.
- Usuário volta para produto.
- Valor alto.
- Cliente novo.
- Mobile.

## Exemplo de score

```json
{
  "session_id": "chk_789",
  "abandonment_score": 0.82,
  "main_reason": "shipping_cost_objection",
  "recommended_action": "offer_shipping_discount"
}
```

---

# 6.6 Recovery System

## Descrição

Se o usuário abandonar, o agente continua a conversa fora do site.

## Canais

- WhatsApp.
- E-mail.
- SMS.
- Push notification.
- Messenger, futuramente.

## Exemplo WhatsApp

> Você deixou o Kit Premium no carrinho. Consegui manter uma condição especial por mais 2 horas: frete grátis ou 8% off. Quer finalizar pelo link seguro?

## Regras

- Só enviar se houver consentimento.
- Respeitar LGPD/GDPR.
- Não fazer spam.
- Expirar oferta.
- Registrar atribuição.

---

# 7. Controle completo de frete

Esta seção é crítica. O frete deve ser tratado como uma alavanca comercial tão importante quanto desconto.

Muitas compras são abandonadas não porque o produto está caro, mas porque o frete aparece como uma surpresa negativa no checkout.

O agente precisa controlar e negociar o frete em todos os passos.

---

# 7.1 Objetivo da inteligência de frete

O objetivo não é sempre dar frete grátis.

O objetivo é escolher a melhor ação para converter sem destruir margem.

Possíveis ações:

- Explicar o frete.
- Comparar opções de entrega.
- Oferecer frete grátis.
- Oferecer frete parcial.
- Oferecer upgrade de entrega.
- Sugerir adicionar item para atingir frete grátis.
- Trocar desconto por frete.
- Bloquear frete grátis quando inviável.
- Recuperar abandono causado por frete.

---

# 7.2 Devemos ter frete no produto?

## Resposta curta

Sim. O produto deve controlar frete desde o MVP, mas não precisa começar com motor logístico completo.

## O que incluir no MVP

- Detectar objeção de frete.
- Ler custo e prazo do frete.
- Saber quando frete grátis é permitido.
- Comparar desconto vs frete grátis.
- Aplicar cupom de frete grátis ou desconto equivalente.
- Medir conversão por tipo de oferta.

## O que deixar para fases futuras

- Roteamento avançado entre transportadoras.
- Cotação própria de frete.
- Otimização logística por CD.
- Promessa dinâmica de entrega.
- Cálculo preditivo de atraso.
- Consolidação multi-warehouse.

## Decisão estratégica

No MVP, o produto não deve tentar virar uma plataforma logística.

Ele deve virar uma **camada comercial inteligente sobre o frete existente** da loja.

---

# 7.3 Frete como objeção

## Sinais de objeção de frete

- Usuário para depois de ver o frete.
- Usuário muda CEP várias vezes.
- Usuário clica em opções de entrega e não avança.
- Usuário pergunta “por que o frete está caro?”.
- Usuário abandona após cálculo de frete.
- Usuário remove itens após ver frete.
- Usuário volta para o carrinho.
- Usuário pesquisa cupom após ver frete.

## Classificação

```json
{
  "objection": "shipping_cost",
  "confidence": 0.88,
  "shipping_cost": 32.90,
  "cart_value": 189.90,
  "shipping_ratio": 0.173,
  "recommended_action": "offer_shipping_discount"
}
```

## Indicador importante

`shipping_ratio = shipping_cost / cart_value`

Exemplo:

- Carrinho: R$189,90
- Frete: R$32,90
- Ratio: 17,3%

Quanto maior esse ratio, maior o risco de abandono por frete.

---

# 7.4 Frete grátis: quando oferecer

Frete grátis deve ser oferecido quando:

1. O usuário demonstra hesitação por frete.
2. O custo do frete cabe na margem.
3. O carrinho tem valor suficiente.
4. O produto tem margem saudável.
5. O cliente tem alta intenção de compra.
6. A oferta aumenta a chance de conversão.
7. Não existe desconto melhor para o cliente e para a loja.

## Exemplo de regra

```json
{
  "rule": "free_shipping_allowed",
  "conditions": {
    "cart_value_greater_than": 250,
    "minimum_margin_after_shipping": 0.38,
    "abandonment_score_greater_than": 0.7,
    "shipping_cost_less_than": 45
  },
  "action": "offer_free_shipping"
}
```

---

# 7.5 Frete grátis: quando não oferecer

Não oferecer frete grátis quando:

- Margem pós-frete fica abaixo do mínimo.
- Produto tem margem baixa.
- Carrinho é muito pequeno.
- Frete é desproporcionalmente alto.
- Região tem custo logístico extremo.
- Cliente ainda não demonstrou objeção.
- Já existe desconto alto aplicado.
- Produto está em liquidação.
- Política da marca não permite.
- Frete grátis estimularia comportamento ruim, como abandono proposital para receber benefício.

## Exemplo de bloqueio

```json
{
  "requested_offer": "free_shipping",
  "approved": false,
  "reason": "minimum_margin_violation",
  "margin_before": 0.41,
  "margin_after": 0.27,
  "fallback_offer": "5_percent_discount"
}
```

Mensagem do agente:

> Frete grátis total eu não consigo liberar nesse pedido sem sair da política da loja. Mas consegui uma condição melhor: R$15 de desconto no frete se você finalizar agora. Quer aplicar?

---

# 7.6 Tipos de oferta de frete

## 1. Frete grátis total

Melhor quando:

- Custo de frete é baixo ou moderado.
- Carrinho tem margem alta.
- Abandono por frete é evidente.

Mensagem:

> Consegui liberar frete grátis para esse pedido. Quer que eu aplique agora?

## 2. Frete parcialmente subsidiado

Melhor quando:

- Frete grátis destruiria margem.
- Ainda há espaço para reduzir fricção.

Mensagem:

> Frete grátis total não consigo liberar, mas consegui reduzir R$20 do frete. Seu envio cai de R$39,90 para R$19,90.

## 3. Frete grátis acima de valor mínimo

Melhor quando:

- Aumentar ticket médio é melhor que dar desconto.

Mensagem:

> Falta R$42 para liberar frete grátis. Posso te sugerir um item útil para completar o carrinho?

## 4. Upgrade de frete

Melhor quando:

- Cliente valoriza prazo.
- Frete expresso pode converter melhor que desconto.

Mensagem:

> Posso manter o valor do frete normal e liberar envio expresso para você receber antes. Quer essa opção?

## 5. Frete como alternativa ao desconto

Melhor quando:

- Cliente pediu desconto, mas economia no frete é maior.

Mensagem:

> Para esse pedido, o frete grátis economiza mais que o desconto disponível. Posso aplicar o frete grátis agora?

---

# 7.7 Cálculo de margem com frete

O sistema precisa calcular se a oferta de frete é viável.

## Fórmula conceitual

```text
margem_final = receita_liquida - custo_produto - custo_frete_subsidiado - taxas_pagamento
```

## Exemplo

Carrinho:

- Produto: R$300
- Custo do produto: R$120
- Frete cobrado do cliente: R$29,90
- Custo real do frete: R$35
- Taxa de pagamento: R$12

Sem frete grátis:

```text
receita = 300 + 29,90
custos = 120 + 35 + 12
lucro = 162,90
```

Com frete grátis:

```text
receita = 300
custos = 120 + 35 + 12
lucro = 133
```

O agente só pode oferecer frete grátis se o lucro/margem continuar acima do mínimo definido.

---

# 7.8 Comparador de melhor oferta

O sistema deve comparar:

- 5% de desconto.
- 10% de desconto.
- Frete grátis.
- Frete parcial.
- Brinde.
- Parcelamento.

## Exemplo

Carrinho: R$300  
Frete: R$35

- 5% off = economia de R$15.
- 10% off = economia de R$30.
- Frete grátis = economia de R$35.

Nesse caso, frete grátis pode parecer melhor para o cliente. Mas para a loja, depende do custo real do frete e da margem.

## Resposta do sistema

```json
{
  "best_customer_offer": "free_shipping",
  "best_merchant_offer": "5_percent_discount",
  "recommended_offer": "free_shipping",
  "reason": "higher_perceived_value_with_acceptable_margin"
}
```

---

# 7.9 Shipping Decision Engine

## Inputs

```json
{
  "cart_value": 300,
  "cart_margin": 0.58,
  "shipping_price_to_customer": 35,
  "shipping_real_cost": 37,
  "region": "SP",
  "delivery_days": 5,
  "customer_type": "new",
  "abandonment_score": 0.82,
  "objection": "shipping_cost",
  "current_discount": 0,
  "merchant_rules": {
    "allow_free_shipping": true,
    "max_shipping_subsidy": 40,
    "minimum_margin_after_shipping": 0.38,
    "free_shipping_min_cart_value": 250
  }
}
```

## Output

```json
{
  "shipping_action": "offer_free_shipping",
  "approved": true,
  "shipping_subsidy": 37,
  "margin_after_offer": 0.44,
  "expires_in_minutes": 15,
  "message_strategy": "position_as_special_checkout_condition"
}
```

---

# 7.10 Fluxo de frete no checkout

## Passo 1 — Usuário informa CEP

Sistema captura:

- CEP.
- Região.
- Opções de frete.
- Custo.
- Prazo.

## Passo 2 — Sistema calcula impacto

- Frete como percentual do carrinho.
- Custo real do frete.
- Margem pós-subsídio.
- Risco de abandono.

## Passo 3 — Agente monitora reação

Sinais:

- Usuário para.
- Usuário troca CEP.
- Usuário volta.
- Usuário clica em cupom.
- Usuário tenta sair.

## Passo 4 — Decision Engine escolhe ação

Possibilidades:

- Não fazer nada.
- Explicar frete.
- Oferecer frete grátis.
- Oferecer redução.
- Sugerir item para liberar frete.
- Sugerir retirada, se houver.
- Sugerir prazo diferente.

## Passo 5 — Agente conversa

Exemplo:

> Vi que o frete ficou em R$39,90. Para esse pedido, consegui reduzir para R$19,90 se você finalizar agora. Quer que eu aplique?

## Passo 6 — Aplicação

- Criar cupom de frete.
- Aplicar regra no carrinho.
- Atualizar total.
- Registrar evento.

## Passo 7 — Medição

Registrar:

- Oferta exibida.
- Oferta aceita.
- Conversão.
- Margem final.
- Receita incremental.

---

# 7.11 API de frete

## POST `/shipping/evaluate`

Request:

```json
{
  "merchant_id": "mrc_123",
  "session_id": "chk_789",
  "cart": {
    "value": 300,
    "items": [
      {
        "sku": "kit-premium",
        "price": 300,
        "cost": 120,
        "quantity": 1
      }
    ]
  },
  "shipping": {
    "customer_price": 35,
    "real_cost": 37,
    "carrier": "Correios",
    "method": "PAC",
    "delivery_days": 5,
    "destination_zip": "01400-000"
  },
  "behavior": {
    "idle_seconds_after_shipping": 42,
    "coupon_field_clicked": true,
    "exit_intent": false
  }
}
```

Response:

```json
{
  "approved": true,
  "action": "offer_free_shipping",
  "reason": "high_shipping_objection_with_acceptable_margin",
  "shipping_subsidy": 37,
  "margin_after_offer": 0.44,
  "message": "Consegui liberar frete grátis para esse pedido. Quer que eu aplique agora?"
}
```

---

## POST `/shipping/apply-offer`

Request:

```json
{
  "merchant_id": "mrc_123",
  "session_id": "chk_789",
  "shipping_offer_id": "shipoff_123"
}
```

Response:

```json
{
  "success": true,
  "offer_type": "free_shipping",
  "discount_code": "FRETEGRATIS-CHK789",
  "old_shipping_price": 35,
  "new_shipping_price": 0,
  "expires_at": "2026-04-30T19:45:00-03:00"
}
```

---

## POST `/shipping/compare-offers`

Request:

```json
{
  "merchant_id": "mrc_123",
  "session_id": "chk_789",
  "cart_value": 300,
  "shipping_price": 35,
  "available_offers": [
    "5_percent_discount",
    "10_percent_discount",
    "free_shipping",
    "shipping_discount_20"
  ]
}
```

Response:

```json
{
  "recommended_offer": "free_shipping",
  "customer_savings": 35,
  "merchant_margin_after_offer": 0.44,
  "reason": "free_shipping_has_highest_perceived_value_and_margin_is_safe"
}
```

---

# 7.12 Regras de frete configuráveis no dashboard

O lojista deve configurar:

- Permitir frete grátis: sim/não.
- Valor mínimo para frete grátis.
- Margem mínima após frete grátis.
- Subsídio máximo por pedido.
- Regiões bloqueadas.
- Produtos bloqueados.
- Campanhas com frete grátis.
- Se pode acumular com desconto.
- Se pode oferecer frete parcial.
- Expiração da oferta.
- Número máximo de ofertas por usuário.

## Exemplo

```json
{
  "shipping_rules": {
    "allow_free_shipping": true,
    "free_shipping_min_cart_value": 250,
    "minimum_margin_after_free_shipping": 0.38,
    "max_shipping_subsidy": 45,
    "blocked_regions": ["RR", "AP"],
    "allow_stack_with_product_discount": false,
    "allow_partial_shipping_discount": true,
    "max_partial_shipping_discount": 25,
    "offer_expiration_minutes": 15
  }
}
```

---

# 7.13 Conversas específicas sobre frete

## Caso 1 — Frete caro

Usuário:

> O frete está caro.

Agente:

> Entendi. O frete ficou em R$39,90. Vou verificar se consigo melhorar essa condição para você.

Sistema autoriza frete parcial.

Agente:

> Consegui reduzir R$20 do frete. Ele cai para R$19,90 se você finalizar nesta sessão. Quer que eu aplique?

---

## Caso 2 — Frete grátis autorizado

Usuário:

> Tem frete grátis?

Agente:

> Para esse carrinho, sim. Consegui liberar frete grátis agora. Quer que eu aplique automaticamente?

---

## Caso 3 — Frete grátis não autorizado

Usuário:

> Quero frete grátis.

Agente:

> Frete grátis total eu não consigo liberar nesse pedido, mas posso reduzir R$15 do envio ou te mostrar um item que libera frete grátis ao completar o valor mínimo. Qual prefere?

---

## Caso 4 — Falta pouco para frete grátis

Agente:

> Falta R$38 para liberar frete grátis. Posso sugerir um produto complementar que faz sentido com o que você já escolheu?

---

## Caso 5 — Frete mais importante que desconto

Agente:

> Nesse pedido, o frete grátis te dá uma economia maior do que o desconto disponível. Posso aplicar frete grátis e manter o produto no valor atual?

---

# 7.14 Métricas de frete

Medir:

- Taxa de abandono após cálculo de frete.
- Taxa de aceitação de frete grátis.
- Taxa de aceitação de frete parcial.
- Conversão com frete grátis.
- Conversão com desconto no produto.
- Margem após subsídio de frete.
- Receita incremental por oferta de frete.
- Ticket médio após sugestão para atingir frete grátis.
- Regiões com maior abandono por frete.
- Transportadoras com maior impacto negativo.

---

# 7.15 Frete e upsell

O agente pode usar frete para aumentar ticket médio.

Exemplo:

> Falta R$42 para liberar frete grátis. O item mais comprado junto com esse produto custa R$49 e já libera o envio. Quer adicionar?

Regras:

- Não sugerir item aleatório.
- Priorizar produtos de alta margem.
- Priorizar produtos leves.
- Priorizar produtos complementares.
- Evitar itens que aumentem muito o custo logístico.

---

# 7.16 Frete e estoque

O sistema deve considerar:

- Estoque por centro de distribuição.
- Região do cliente.
- Prazo estimado.
- Custo real de envio.
- Produto volumoso.
- Produto pesado.
- Produto frágil.

No MVP, isso pode ser simplificado usando dados que a plataforma de e-commerce já fornece.

---

# 7.17 Frete e promessa de entrega

O agente nunca deve prometer prazo sem fonte.

Permitido:

> A opção atual mostra entrega estimada em até 5 dias úteis.

Proibido:

> Vai chegar com certeza em 3 dias.

Regra:

- O agente só repete prazo retornado pela API de frete.
- Se houver incerteza, usa linguagem estimada.
- Se houver atraso, não inventa justificativa.

---

# 8. User Journey completo

---

# 8.1 Usuário entra no checkout pela primeira vez

1. Usuário chega ao checkout.
2. SDK inicia sessão.
3. Sistema identifica carrinho, valor, produto e origem.
4. Agente fica silencioso.
5. Usuário começa preenchimento.
6. Agente só intervém se necessário.

Mensagem possível:

> Estou por aqui se quiser ajuda para finalizar ou encontrar a melhor condição.

---

# 8.2 Usuário hesita no preço

1. Usuário para no total.
2. Clica no cupom.
3. Fica 40 segundos inativo.
4. Abandonment score sobe.
5. Agente abre conversa.

Mensagem:

> Posso tentar melhorar a condição desse pedido para você finalizar agora. Você prefere desconto ou parcelamento mais leve?

---

# 8.3 Usuário hesita no frete

1. Usuário calcula frete.
2. Frete aparece alto.
3. Usuário para.
4. Decision Engine avalia margem.
5. Agente oferece ação.

Mensagem:

> Vi que o frete ficou em R$39,90. Consegui reduzir para R$19,90 se você finalizar agora. Quer aplicar?

---

# 8.4 Usuário tem objeção de confiança

Usuário:

> É seguro comprar aqui?

Agente:

> Sim. O pagamento é processado em ambiente seguro, e você tem garantia de 30 dias conforme a política da loja. Posso te mostrar as opções de pagamento mais seguras?

---

# 8.5 Usuário pede desconto alto

Usuário:

> Me dá 25% que eu compro.

Agente:

> 25% eu não consigo liberar sem sair da política da loja. Meu melhor acordo autorizado agora é 10% ou frete grátis, dependendo do que for melhor para você. Quer que eu compare?

---

# 8.6 Conversão

1. Usuário aceita oferta.
2. Sistema aplica cupom.
3. Total atualiza.
4. Agente conduz ao pagamento.
5. Pedido é criado.
6. Sistema registra receita atribuída.

Mensagem:

> Pronto, apliquei a condição. Agora é só concluir o pagamento por aqui.

---

# 8.7 Abandono e recuperação

1. Usuário sai.
2. Sistema espera delay.
3. Recupera contexto.
4. Escolhe canal autorizado.
5. Envia mensagem.
6. Usuário volta por link rastreado.
7. Conversa continua.

Mensagem:

> Você deixou o pedido quase pronto. Consegui manter sua condição por mais 2 horas. Quer finalizar pelo link seguro?

---

# 9. Arquitetura do sistema

```text
[Loja / Checkout]
      |
      | JS SDK / Widget Embed
      v
[AI Checkout Widget]
      |
      | eventos em tempo real
      v
[Event Gateway]
      |
      v
[Behavior Stream] ---> [Abandonment Scorer]
      |                       |
      v                       v
[Decision Engine] <---- [Rules & Margin Engine]
      |                       |
      |                       v
      |              [Shipping Decision Engine]
      |
      v
[Conversation Orchestrator] ---> [LLM]
      |
      v
[Offer Engine]
      |
      v
[Commerce Adapter Layer]
  |        |        |
Shopify  Woo     Custom API
  |
[Payment Layer]
  |        |
Stripe   Mercado Pago / Adyen / PayPal
  |
[Order Created]
      |
      v
[Analytics + Learning Loop]
```

---

# 10. Componentes técnicos

## 10.1 Widget

Responsável por:

- Renderizar chat.
- Capturar eventos.
- Exibir propostas.
- Aplicar ações.
- Atualizar UI.
- Manter sessão.

## 10.2 Event Gateway

Recebe eventos do checkout.

Eventos:

- `checkout_started`
- `cart_viewed`
- `shipping_calculated`
- `shipping_option_selected`
- `shipping_objection_detected`
- `coupon_field_clicked`
- `payment_method_selected`
- `payment_failed`
- `exit_intent_detected`
- `idle_30_seconds`
- `offer_viewed`
- `offer_accepted`
- `order_completed`
- `checkout_abandoned`

## 10.3 Decision Engine

Motor central de decisão.

## 10.4 Shipping Decision Engine

Submotor específico de frete.

## 10.5 Conversation Orchestrator

Coordena LLM, regras e mensagens.

## 10.6 Offer Engine

Cria e aplica ofertas.

## 10.7 Commerce Adapter

Integra com Shopify, WooCommerce, VTEX, Nuvemshop ou API custom.

## 10.8 Payment Adapter

Integra com gateways de pagamento.

## 10.9 Analytics

Mede impacto.

---

# 11. Stack recomendada

## MVP

- TypeScript.
- Node.js.
- NestJS ou Fastify.
- PostgreSQL.
- Redis.
- React/Preact para widget.
- Web Components.
- OpenAI/LLM API.
- Stripe/Mercado Pago/Pagar.me.
- Shopify ou WooCommerce como primeira integração.

## Escala

- Kafka ou Redpanda.
- ClickHouse para analytics.
- Feature store.
- Workers assíncronos.
- Multi-tenant isolation.
- Observabilidade com OpenTelemetry.

---

# 12. Monólito modular vs microserviços

## Recomendação inicial

Começar com **monólito modular**.

Estrutura:

```text
/apps
  /api
  /dashboard
  /widget

/packages
  /decision-engine
  /shipping-engine
  /rules-engine
  /conversation-engine
  /commerce-adapters
  /payment-adapters
  /analytics
  /shared-types
```

Separar microserviços apenas quando houver escala real.

---

# 13. Design da IA

## Onde usar IA

- Conversa.
- Diagnóstico de objeção.
- Personalização de tom.
- Explicação de ofertas.
- Recovery por mensagem.
- Resumo de sessão.

## Onde não usar IA

- Cálculo de margem.
- Autorização de desconto.
- Autorização de frete grátis.
- Estoque.
- Prazo de entrega.
- Pagamento.
- Antifraude.

## Prompt base

```text
Você é um gerente sênior de vendas no checkout.
Seu objetivo é ajudar o cliente a concluir a compra com confiança.
Você deve identificar objeções, remover fricção e propor ofertas apenas quando autorizadas pelo Decision Engine.

Regras:
- Nunca invente descontos.
- Nunca invente frete grátis.
- Nunca invente prazo de entrega.
- Nunca prometa estoque sem dados.
- Nunca pressione de forma abusiva.
- Seja direto, comercial e útil.
- Se o cliente pedir desconto, consulte a oferta autorizada.
- Se o cliente reclamar do frete, consulte o Shipping Decision Engine.
- Se não houver oferta autorizada, ofereça alternativas.
```

---

# 14. Integrações

## E-commerce

- Shopify.
- WooCommerce.
- Nuvemshop.
- Loja Integrada.
- VTEX.
- Magento.
- Custom API.

## Pagamentos

- Stripe.
- Mercado Pago.
- Pagar.me.
- Adyen.
- PayPal.
- PagSeguro.
- EBANX.

## Frete e logística

- Melhor Envio.
- Frenet.
- Intelipost.
- Correios.
- Loggi.
- Jadlog.
- APIs nativas da plataforma.

## Mensageria

- WhatsApp Business API.
- Twilio.
- Zenvia.
- SendGrid.
- Customer.io.
- Klaviyo.
- RD Station.

---

# 15. Dashboard do lojista

## 15.1 Overview

- Conversas iniciadas.
- Receita incremental.
- Conversão com agente.
- Conversão sem agente.
- Desconto médio.
- Frete subsidiado médio.
- Margem preservada.
- Top objeções.
- Abandono por frete.
- Conversão por tipo de oferta.

## 15.2 Regras comerciais

- Desconto máximo.
- Margem mínima.
- Produtos bloqueados.
- Regras por categoria.
- Regras por cliente.
- Acúmulo de ofertas.

## 15.3 Regras de frete

- Permitir frete grátis.
- Valor mínimo.
- Subsídio máximo.
- Margem mínima.
- Regiões bloqueadas.
- Produtos bloqueados.
- Acumular com desconto.
- Oferecer frete parcial.

## 15.4 Brand Voice

- Consultivo.
- Agressivo.
- Premium.
- Jovem.
- Técnico.
- Luxo.
- Popular.

## 15.5 Conversas

- Histórico.
- Oferta aplicada.
- Motivo da decisão.
- Margem antes/depois.
- Resultado.

---

# 16. API Design

## POST `/start-checkout`

```json
{
  "merchant_id": "mrc_123",
  "session_id": "chk_789",
  "customer": {
    "id": "cus_456",
    "email": "ana@email.com",
    "is_returning": false
  },
  "cart": {
    "currency": "BRL",
    "total": 420,
    "items": [
      {
        "sku": "kit-premium",
        "name": "Kit Premium",
        "price": 420,
        "quantity": 1
      }
    ]
  }
}
```

Response:

```json
{
  "conversation_id": "conv_123",
  "agent_enabled": true,
  "initial_mode": "silent",
  "tracking_token": "trk_abc"
}
```

---

## POST `/track-event`

```json
{
  "merchant_id": "mrc_123",
  "session_id": "chk_789",
  "event": "shipping_calculated",
  "metadata": {
    "cart_value": 300,
    "shipping_price": 35,
    "delivery_days": 5,
    "device": "mobile"
  }
}
```

Response:

```json
{
  "received": true,
  "abandonment_score": 0.67,
  "trigger_agent": false
}
```

---

## POST `/decision`

```json
{
  "session_id": "chk_789",
  "context": {
    "cart_value": 420,
    "idle_seconds": 48,
    "coupon_field_clicked": true,
    "shipping_price": 35,
    "device": "mobile"
  }
}
```

Response:

```json
{
  "decision_id": "dec_456",
  "action": "trigger_agent",
  "reason": "high_price_and_shipping_hesitation",
  "abandonment_score": 0.79
}
```

---

## POST `/negotiate`

```json
{
  "session_id": "chk_789",
  "conversation_id": "conv_123",
  "user_message": "O frete está caro, tem como melhorar?"
}
```

Response:

```json
{
  "message": "Consigo reduzir R$20 do frete para este pedido. Quer que eu aplique agora?",
  "authorized_offer": {
    "type": "shipping_discount_fixed",
    "value": 20,
    "expires_in_minutes": 15
  },
  "actions": [
    {
      "label": "Aplicar desconto no frete",
      "type": "apply_shipping_discount"
    },
    {
      "label": "Ver outras opções",
      "type": "show_alternatives"
    }
  ]
}
```

---

## POST `/apply-discount`

```json
{
  "merchant_id": "mrc_123",
  "session_id": "chk_789",
  "offer_id": "off_999"
}
```

Response:

```json
{
  "success": true,
  "discount_code": "AI8-CHK789",
  "new_total": 386.4,
  "expires_at": "2026-04-30T19:45:00-03:00"
}
```

---

## POST `/shipping/evaluate`

```json
{
  "merchant_id": "mrc_123",
  "session_id": "chk_789",
  "cart_value": 300,
  "shipping_price": 35,
  "shipping_real_cost": 37,
  "abandonment_score": 0.82
}
```

Response:

```json
{
  "approved": true,
  "action": "offer_free_shipping",
  "shipping_subsidy": 37,
  "margin_after_offer": 0.44
}
```

---

# 17. MVP Strategy

## MVP verdadeiro

O MVP deve ser uma camada sobre checkout existente.

## Incluir

- Widget embedável.
- Tracking de eventos.
- Agente conversacional.
- Regras de desconto.
- Regras básicas de frete.
- Aplicação de cupom.
- Aplicação de frete grátis ou frete parcial.
- Detecção simples de abandono.
- Dashboard básico.
- Shopify ou WooCommerce.

## Cortar inicialmente

- Checkout 100% conversacional.
- Motor logístico completo.
- Multi-CD.
- Multi-gateway avançado.
- ML próprio.
- Omnichannel completo.
- Marketplace de playbooks.

---

# 18. Roadmap

## 0–30 dias

- Widget.
- API de sessão.
- Chat com LLM.
- Regras simples.
- Oferta de desconto.
- Oferta de frete grátis manual/controlada.
- Dashboard mínimo.

## 31–60 dias

- Plugin Shopify ou WooCommerce.
- Eventos reais.
- Shipping Decision Engine básico.
- Cupom dinâmico.
- Analytics.
- Logs.

## 61–90 dias

- A/B testing.
- Recovery por WhatsApp/e-mail.
- Classificação de objeções.
- Relatório de receita incremental.
- Payment failure rescue.

## 90–180 dias

- Multi-merchant.
- Billing SaaS.
- Playbooks por vertical.
- Integrações CRM.
- Modelos melhores de scoring.

---

# 19. Business Model

## Modelo recomendado

SaaS + success fee.

## Starter

- R$199–499/mês.
- Conversas limitadas.
- 1 loja.
- Regras básicas.

## Growth

- R$799–1.999/mês.
- Conversas maiores.
- Frete inteligente.
- Recovery.
- A/B testing.
- Success fee sobre receita incremental.

## Scale

- R$3.000+/mês.
- Multi-loja.
- SLA.
- Integrações.
- Playbooks avançados.

## Enterprise

- Setup fee.
- Contrato anual.
- Segurança.
- Compliance.
- Customização.

---

# 20. ICP inicial

Melhor cliente inicial:

- E-commerce DTC.
- Tráfego pago relevante.
- Ticket médio acima de R$150.
- Margem acima de 40%.
- Alto abandono no checkout.
- Forte objeção de frete/preço.

Verticais boas:

- Cosméticos.
- Suplementos.
- Moda premium.
- Pet premium.
- Infoprodutos.
- Cursos.
- Decoração.
- Produtos de recorrência.

---

# 21. Go-to-market

## Mensagem

> Coloque um vendedor IA no seu checkout para negociar preço, frete e pagamento antes do cliente abandonar.

## Oferta inicial

- Instalação rápida.
- Teste com holdout.
- Pagamento baseado em receita incremental.
- Relatório claro de conversão.

## Canais

- Agências de performance.
- Agências Shopify/WooCommerce.
- Comunidades de e-commerce.
- Conteúdo de CRO.
- Auditoria gratuita de checkout.
- Calculadora de abandono por frete.

---

# 22. Riscos e mitigação

## Risco: agente irritante

Mitigação:

- Abrir apenas com sinais.
- Cooldown.
- Botão de fechar.
- A/B testing.

## Risco: destruir margem

Mitigação:

- Margem mínima.
- Regras determinísticas.
- Bloqueios.
- Logs.

## Risco: frete grátis excessivo

Mitigação:

- Subsídio máximo.
- Valor mínimo.
- Margem pós-frete.
- Bloqueio por região.

## Risco: IA inventar promessa

Mitigação:

- Guardrails.
- RAG limitado.
- Function calling.
- Validação de dados.

## Risco: atribuição contestada

Mitigação:

- Grupo de controle.
- Eventos auditáveis.
- Janela de atribuição.

## Risco: integração complexa

Mitigação:

- Começar com cupom.
- Uma plataforma.
- Um gateway.
- MVP modular.

---

# 23. Moat

## 1. Dados proprietários de objeções

O sistema aprende quais objeções aparecem por categoria, SKU, região e canal.

## 2. Dados de frete

O produto saberá:

- Quais regiões abandonam por frete.
- Qual subsídio converte.
- Quando frete grátis supera desconto.
- Qual valor mínimo aumenta ticket.

## 3. Playbooks por vertical

- Cosméticos.
- Suplementos.
- Moda.
- Cursos.
- Pet.

## 4. Integrações

Quanto mais integrado ao stack comercial, maior o custo de troca.

## 5. Decision Engine

A vantagem não é só o LLM. É o motor de decisão comercial.

---

# 24. Métricas principais

## North Star

Receita incremental recuperada pelo agente.

## Métricas secundárias

- Conversão no checkout.
- Receita por conversa.
- Taxa de aceitação de oferta.
- Desconto médio.
- Frete subsidiado médio.
- Margem preservada.
- Conversão após objeção de frete.
- Conversão após objeção de preço.
- Abandono após cálculo de frete.
- Ticket médio.
- Receita recuperada por WhatsApp.

---

# 25. PRD inicial recomendado

## PRD-001 — AI Checkout Sales Agent MVP: Conversational Discount & Shipping Closer

### Objetivo

Provar que um agente IA no checkout aumenta conversão ao negociar preço e frete com proteção de margem.

### Escopo

- Widget.
- Chat.
- Eventos.
- Decision Engine básico.
- Shipping Decision Engine básico.
- Regras de desconto.
- Regras de frete.
- Aplicação de cupom.
- Dashboard.
- Analytics.

### Fora de escopo

- Checkout completo conversacional.
- Logística avançada.
- Multi-CD.
- ML próprio.
- Omnichannel completo.

### Critério de sucesso

- Aumento de conversão estatisticamente relevante.
- Margem preservada.
- Receita incremental positiva.
- Adoção pelo lojista.
- Baixa rejeição do chat.

---

# 26. Recomendação final

O produto deve nascer como uma camada de **conversão comercial inteligente**, não como chatbot e não como plataforma logística.

A primeira tese deve ser:

> O checkout perde vendas porque não negocia. Nosso agente negocia preço, frete e pagamento com regras, margem e inteligência.

A parte de frete deve existir desde o início porque frete é uma das maiores objeções do checkout.

Mas no MVP, o frete deve ser tratado como:

- Detecção de objeção.
- Decisão comercial.
- Oferta controlada.
- Aplicação via cupom/regra.
- Medição de impacto.

Não como operação logística completa.

## Decisão final sobre frete

**Sim, teremos frete no produto.**

Mas em fases:

### MVP

- Frete como alavanca de conversão.
- Frete grátis autorizado por regra.
- Frete parcial.
- Comparação desconto vs frete.
- Proteção de margem.

### Futuro

- Otimização logística.
- Melhor transportadora.
- Promessa dinâmica.
- Multi-CD.
- Previsão de atraso.

Essa abordagem mantém o produto focado em receita, conversão e velocidade de lançamento.
