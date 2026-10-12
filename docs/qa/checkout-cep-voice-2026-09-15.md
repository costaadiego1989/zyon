# Confirmação de CEP e respostas de voz

## Correção

Após confirmar o endereço, o checkout mantém a sequência número → complemento → frete → pagamento. A confirmação não é reutilizada como complemento. Confirmações por texto e voz, como "sim", "confirmo" e "esse mesmo", seguem a mesma transição no servidor.

O widget usa `missing_fields` para mostrar o campo correto e encaminha confirmações de etapas da API de volta ao servidor. Respostas rápidas do frete também são lidas de `experience.copy.quick_replies`.

A sessão Realtime passa a usar 512 tokens de saída por resposta por padrão. `OPENAI_REALTIME_MAX_OUTPUT_TOKENS` permite ajuste entre 256 e 2048. O prompt recomenda até duas frases e 60 palavras, preservando os dados necessários para a etapa. O contexto inicial do carrinho limita nomes e variantes a 72 caracteres e lista até quatro itens; o agente comercial continua consultando o carrinho completo.

## Verificação local

Na raiz:

```powershell
pnpm --filter @zyon/api build
pnpm --filter @zyon/widget-v2 typecheck
pnpm --filter @zyon/widget-v2 build
pnpm --filter @zyon/storefront build
```

Em `apps/api`:

```powershell
node --loader ./tests/ready-prod-loader.mjs --test src/modules/checkout/__tests__/checkout-address-confirmation.spec.ts src/shared/openai/openai-realtime-voice.service.spec.ts ../../packages/conversation-engine/src/index.spec.ts
```

Resultado: 18 testes aprovados. Os testes de regressão reproduziram o reinício da conversa, o armazenamento indevido de "sim" como complemento e a rejeição de sinônimos de confirmação antes da correção.

Em `apps/widget_v2`:

```powershell
pnpm exec playwright test e2e/address-confirmation.spec.ts e2e/realtime-voice-payment-flow.spec.ts --workers=1 --retries=0
```

Resultado: 3 testes aprovados no Chromium. Cobrem confirmação textual e estruturada, campos de número/complemento, escolha do frete e exibição do pagamento, além da ferramenta Realtime que abre as opções visuais de pagamento.

As APIs e o transporte de voz dos testes são simulados: não há gasto com OpenAI, cobrança ou pedido real. Isso valida o fluxo de aplicação, não o reconhecimento de áudio do provedor nem uma compra real em produção.
