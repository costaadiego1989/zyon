# Checkout editável e compra rápida por voz — 05/10/2026

Publicado na Railway e na Vercel com código `120c9630b279a2d43b3ea7a5da6d473797510210`. A validação final de disponibilidade ocorreu em 05/10/2026 às 22:55 UTC. A release preserva as alterações legais e de privacidade de `6f654cde6f3e38bce63a6cbd81ea6272e28641df`.

## Comportamento entregue

- A voz espera a aplicação das preferências de compra rápida antes de iniciar. Quando o Pix já está disponível, orienta a conclusão na tela e permite solicitar alterações; não reinicia a coleta de frete por causa de mensagens antigas.
- O checkout envia seu estado atual para a sessão de voz antes de saudações, respostas e resultados de ferramentas. As atualizações são serializadas para impedir que uma resposta antiga substitua instruções mais recentes. Se a atualização falhar, a voz é interrompida com uma mensagem para o comprador, preservando o resultado comercial.
- Storefront e checkout compartilham o filtro de entrada e o controle de respostas. Silêncio, transcrição vazia, falha de transcrição e segmentos identificados como ruído ou respiração não disparam respostas. Respostas não concorrem entre si; uma fala aceita pode interromper a resposta em andamento.
- O microfone solicita cancelamento de eco e supressão de ruído, com ganho automático desativado. O Realtime usa redução de ruído `near_field`, transcrição em português e VAD com limiar `0.72`, prefixo de `350 ms` e silêncio de `900 ms`. `create_response` e `interrupt_response` automáticos ficam desativados; a entrada reconhecida controla a resposta.
- Compradores podem solicitar por texto ou voz mudanças de pagamento, frete, endereço e cupom. Botões de alteração também ficam disponíveis enquanto o pagamento está pendente. O carrinho recebe valores e benefícios da resposta comercial autorizada.
- É possível salvar um endereço identificado, como “Trabalho”, para um comprador com e-mail verificado. O endereço principal é preservado; a conta permite até cinco endereços.

O endpoint assinado `POST /embed/realtime/context` valida o vínculo entre lojista, sessão e nonce e o direito de uso de voz. Ele devolve somente instruções atuais; não cria um segredo Realtime nem uma nova sessão cobrável de voz.

## Pagamento pendente e limites dos provedores

Uma alteração que invalida o pagamento precisa confirmar o cancelamento do pagamento ainda não concluído antes de limpar o QR e reabrir o checkout. A verificação de estado impede sobrescrever uma aprovação concorrente. Se o provedor não confirmar o cancelamento, o pagamento atual é preservado e a alteração é bloqueada.

O fluxo contempla estados elegíveis de PaymentIntent Stripe, cobrança Asaas e pagamento direto numérico Mercado Pago. Preferências hospedadas do Mercado Pago e o fluxo crypto permanecem bloqueados para esta alteração quando não existe cancelamento seguro disponível.

Não foram alterados reconciliação, estorno, handlers de webhook financeiro, Kong ou configurações de infraestrutura. O cancelamento de um pagamento não concluído, necessário para editar o checkout, não efetua estorno.

## Evidência e alcance dos testes

| Camada | Resultado | Alcance |
| --- | --- | --- |
| Testes focados da API | 122 passaram; 1 ignorado | Edição, cancelamento, pagamento, benefícios, endereços e voz. Não representa aprovação da suíte completa do repositório. |
| PostgreSQL local | 5 passaram; nenhum ignorado | Concorrência e idempotência, cupom, desconto progressivo, não acumulação indevida e endereço nomeado com principal preservado. |
| Playwright controlado | 22 passaram | APIs/provedor simulados; larguras de 320 a 1440 px, incluindo voz em 390 e 1280 px, CEP, carrinho, edição e ciclo do microfone. |
| Builds | API e frontend concluídos | Prisma/Nest, biblioteca do widget e Next; typecheck do widget aprovado. |
| Stripe TEST real | Cancelamento confirmado e repetição idempotente | PaymentIntent de teste; nenhum pagamento submetido e nenhum cliente criado. |
| OpenAI Realtime real | Configuração aceita; fala reconhecida; nenhuma resposta ao ruído testado | Áudio sintético em português e ruído sintético em duas intensidades. A ferramenta comercial foi simulada. |
| HTTP de contexto no sandbox | Aprovado | Sessão sintética: Pix atual, troca de pagamento, troca de endereço e rejeição de nonce de outra sessão com 401. |
| HTTP de contexto em produção | Aprovado | Mesmo fluxo por HTTP real; migração do rótulo de endereço presente. Sem criação de segredo de voz ou pagamento. |
| Navegador no sandbox | 390 e 1280 px sem erro JavaScript ou overflow | Conta de QA autenticada por token sintético; seleção do sérum de 50 ml, carrinho e entrada no checkout até o pedido de CEP. |
| Navegador público em produção | 390 e 1280 px sem erro JavaScript, resposta HTTP malsucedida ou overflow | Loja Athom, catálogo, header e stories. Sem aviso de upgrade de voz Growth ou rodapé “Powered by Zyon”. |

No sandbox, a imagem do sérum carregou e o resumo exibiu R$ 189,90 em produtos + R$ 0,99 de taxa = R$ 190,89. A solicitação de CEP apareceu uma vez. Essa loja de sandbox não tem a assinatura Scale da loja de produção; seu rodapé de marca é esperado. O endpoint público de FAQ retornou 403 no sandbox, uma limitação de configuração que não apareceu no navegador público de produção.

As sessões sintéticas de QA não comprovam login com OTP, entrega de e-mail, compra real ou captura por microfone físico. Não foram submetidos pagamentos reais. O cancelamento Asaas não teve validação contra o provedor real por falta de chave sandbox disponível. Respiração, eco, ambientes e aparelhos físicos ainda precisam de validação com microfone; não se afirma reconhecimento perfeito.

### Evidências anexas

- [Checkout mobile no sandbox](evidence/checkout-edit-voice-20261005/sandbox-checkout-mobile.png).
- [Checkout desktop no sandbox](evidence/checkout-edit-voice-20261005/sandbox-checkout-desktop.png).
- [Áudio sintético no OpenAI Realtime real](evidence/checkout-edit-voice-20261005/realtime-provider-qa.json).
- [Contexto por HTTP em produção](evidence/checkout-edit-voice-20261005/production-context-qa.json).
- [Cancelamento no Stripe TEST](evidence/checkout-edit-voice-20261005/stripe-test-cancellation.json).

## Cupom e desconto progressivo

O cupom de teste `ONEBUY10` foi criado para a Athom com 10% de desconto, compra mínima de R$ 100, uma utilização total e uma por comprador. Aplica-se somente ao SKU do sérum de 50 ml `APL-NUCLEO-696a583b-e0b8-4956-aea7-4f15037de32b-large`. Expira em **06/10/2026 às 19:10:43, horário de Brasília**.

Uma transação no PostgreSQL de produção, usando o caso de uso comercial e as regras reais da loja, autorizou R$ 18,99 de desconto sobre R$ 189,90 e registrou o benefício “Cupom ONEBUY10”. Todas as alterações de sessão e reserva dessa validação foram revertidas; o teste não consumiu a utilização do cupom.

O desconto progressivo foi validado no PostgreSQL local: uma regra de 15% respeitou o limite de 10% da loja, concedendo R$ 30 sobre R$ 300. Repetições e mudanças do meio de pagamento não acumularam o desconto. Nenhuma nova política progressiva foi ativada na loja de produção.

## Publicações verificadas

| Componente | Deploy | Estado |
| --- | --- | --- |
| API produção Railway | `c695934c-eb87-4603-b24b-931728740313` | SUCCESS; `/health` público 200 |
| Storefront produção Vercel | `dpl_4JtuqmNPHrAT7D3zvGz1CNNkgAEB` | READY; alias `storefront.zyon-payments.com.br` |
| Widget produção Vercel | `dpl_74mdTxPf9zqNZWfEm8hfLpqfQfW4` | READY; aliases `widget.zyon-payments.com.br` e `zyon-widget-v2.vercel.app` |
| API sandbox Railway | `58422998-d96b-430e-8288-0df727b17333` | SUCCESS no gate de sandbox |
| Storefront sandbox Vercel | `dpl_2jMmiCjzgTqhjopuAvY94AsPG7og` | READY no gate de sandbox |

Loja validada: <https://storefront.zyon-payments.com.br/store/athom-technologies>.

Os commits funcionais são `50340e1` (backend/endereço/cancelamento), `e28b60c` (edição no chat) e `26abde2` (voz e ruído). O commit integrado `120c963` preserva a publicação concorrente de políticas e privacidade. Documentação posterior não altera o código publicado.

A conta sintética de comprador e as fixtures privadas de lojista foram removidas. As sessões de QA sem pagamento permanecem no histórico de auditoria. A chave SSH temporária criada para esta validação foi revogada; nenhuma chave de outro agente foi alterada.

Referências do protocolo utilizadas: [VAD](https://developers.openai.com/api/docs/guides/realtime-vad), [eventos do cliente](https://developers.openai.com/api/reference/resources/realtime/client-events) e [transcrição Realtime](https://developers.openai.com/api/docs/guides/realtime-transcription).
