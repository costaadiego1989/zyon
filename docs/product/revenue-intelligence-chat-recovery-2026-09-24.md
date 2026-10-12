**Décima quinta entrega local — recuperação de respostas textuais já gravadas**

24/09/2026. Continuação de `d0bb774`, na branch `feat/revenue-intelligence-weekly`. Resolve a interrupção entre a publicação textual do chat principal e a conclusão do recibo da requisição. A sessão pode receber a próxima mensagem depois de uma reconciliação com evidência durável, sem reenviar o texto anterior nem repetir a chamada de IA. RI-09 continua parcial; a aprovação pública e o piloto comercial permanecem bloqueados.

**Evidência e transação.** Novas admissões do chat principal recebem a política imutável `main_chat_text_only_v1`. O publicador exige que a política corresponda ao percurso utilizado. A reconciliação exige protocolo 2, mesma loja/sessão/conversa, publicação `persisted` e troca comprador/agente vinculada à requisição. Publicações anteriores com `text_only_no_personalization_v1` permanecem imutáveis e não são convertidas nem aceitas como prova do novo percurso.

Uma transação bloqueia a sessão e a requisição, grava `CheckoutChatResolution` e muda o recibo de `processing` ou `unknown` para `reconciled`. A resolução preserva o estado e a data de conclusão anteriores, a publicação usada e o horário do banco. Chaves estrangeiras, triggers e uma verificação adiada até o commit impedem prova sem transição, transição sem prova, alteração posterior e referências de outra loja. `reconciled` é terminal e mantém `responseHash` nulo: não inventa o hash da resposta HTTP que deixou de ser confirmada.

Chamadas concorrentes ou repetidas recebem o mesmo estado terminal sem criar outra resolução. A chave anterior nunca reexecuta o trabalho; uma nova chave pode avançar, sujeita às demais proteções. Se o processo original ainda tentar concluir após a recuperação, a atualização condicionada a `processing` falha e ele devolve o recibo durável em conflito HTTP 409. Uma confirmação de conclusão normal perdida também passa a retornar `completed`/409 quando esse estado é verificado no banco, em vez de informar uma incerteza já resolvida.

**Contrato de acesso.** A nova operação não recebe texto para execução nem seletores de agente. A referência é validada e copiada antes de qualquer espera.

| Entrada | Escopo autorizado |
| --- | --- |
| `POST /v1/checkouts/:checkoutId/messages/:messageId/reconcile` | Loja do principal autenticado; chave de serviço exige `checkout:write`; sessão e mensagem vêm do caminho; corpo contém `conversation_id` |
| `POST /embed/chat/reconcile` | Token com `checkout:chat`, sessão vinculada ao token e à loja; corpo contém `session_id`, `conversation_id`, `message_id` |

O resultado contém somente `chat_request` com `message_id`, estado terminal e `next_action: refresh_session`, dentro do envelope do transporte quando aplicável. `completed`, `rejected` e `reconciled` já existentes podem ser consultados mesmo com a recuperação desligada. O filtro Problem Details e o contrato compartilhado preservam o novo recibo em erros sem expor texto, oferta ou dados internos. Não há cache de resposta comercial no novo endpoint.

A lista central de modelos com escopo de loja também foi alinhada ao schema, incluindo requisições, trocas, resoluções, medições e registros de estratégia. O teste de alinhamento e um teste PostgreSQL da extensão Prisma verificam leituras, gravações e transações. Isso complementa os filtros explícitos; não equivale a RLS nem torna consultas SQL brutas automaticamente isoladas.

**Configuração e migração.** `CHECKOUT_CHAT_RECOVERY_ENABLED=false` e `CHECKOUT_CHAT_RECOVERY_MERCHANT_IDS=` mantêm a mutação desligada por padrão. Ativá-la exige uma lista explícita de lojas; `*` não concede acesso. Essas opções são independentes das flags de execução/publicação: reconhecer uma publicação já confirmada continua possível após uma pausa ou mudança de carrinho. A operação não reaplica a estratégia nem altera o carrinho.

A migration `20260924235900_checkout_chat_reconciliation` adiciona a evidência e os estados aceitos, preservando as condições anteriores do guard de publicação. Foi aplicada somente ao banco descartável. Uma futura liberação exige migration antes dos novos workers e retirada coordenada de workers antigos; o código anterior não conhece todos os estados/políticas. Desligar a flag impede novas reconciliações, mas não desfaz resoluções nem libera chaves antigas para repetição.

**Validação local.** Foram aprovados 615 testes distintos no escopo, sem skips, além do TypeScript da API. Evidências em `.audit/revenue-weekly/`, usando o cliente Prisma isolado e PostgreSQL em `127.0.0.1:5557/revenue_recovery_final_0924`. Os testes de banco rodam sequencialmente, pois truncam tabelas compartilhadas. IA e efeitos comerciais usam transportes controlados; as requisições HTTP de teste ficam no loopback.

- `recovery-integration.log`: 103 testes aprovados de execução/publicação/recuperação em PostgreSQL. Inclui concorrência, processo original ainda ativo, perda de confirmação, rollback, estado imutável, referências inválidas, publicações antigas e ausência de prova. O teste HTTP usa controlador de fixture com caso de uso, banco e filtro reais; não representa a jornada autenticada completa.
- `recovery-compatibility.log`: 36 testes aprovados de identidade de mensagem e compatibilidade do protocolo com o checkout, incluindo a leitura de recibos terminais e a conclusão normal cuja confirmação foi perdida.
- `recovery-focused.log`: 28 testes aprovados de escopo de loja, contratos HTTP, controlador público e vínculo de sessão no embed. Os guards públicos usam credenciais de fixture; não são autenticação externa real.
- `recovery-regression.log`: 448 testes aprovados de Revenue Manager, experimentos, checkout, contexto, gateway e contratos. Redis desabilitado somente no processo de teste por `REDIS_URL` com espaço.
- `recovery-typecheck.log` vazio e `recovery-typecheck-exit.txt` com 0: TypeScript da API com cliente isolado. Schema validado e cliente gerado sem alterar artefatos compartilhados. `recovery-migration-final.log` registra a aplicação; `recovery-schema-diff.log` não apresenta diferença estrutural. Triggers são verificadas pelos testes, não pelo diff do Prisma.

A suíte adicional de chat/cota permanece com 18 aprovados, oito falhas e um ignorado. A comparação com os arquivos de `d0bb774` reproduziu os mesmos nomes e campos das oito asserções (`recovery-send-current.log`, `recovery-send-head.log`, `recovery-known-failures.json`). As pendências de cadastro/OTP impedem afirmar que a jornada completa passou. Uma fixture de prova foi corrigida para usar o relógio do banco, como o código de produção, evitando que o relógio do host invalide o teste temporal.

**Limites e continuação.** Ausência de publicação, resultado incerto do provedor, resposta suprimida, percurso genérico/antigo e efeitos comerciais sem prova continuam bloqueados. Não há retomada por timeout, repetição da IA ou recuperação de pagamento. A evidência cobre o texto publicado após as etapas anteriores do checkout; não prova que todo o percurso foi livre de efeitos, nem que o comprador recebeu ou viu a resposta.

Faltam adaptar widget/WhatsApp e demais chamadores para preservar a chave, consultar o recibo e atualizar a sessão; completar ferramentas, persistência do pagamento e paridade do controle; medir entrega/exposição e custos; encerrar experimentos e ligar aprovação à ativação. Cupons, descontos e aprendizado entre lojas seguem os critérios econômicos e de privacidade do plano. Nenhuma implantação, push, merge, mensagem externa ou chamada real de IA ocorreu nesta entrega.
