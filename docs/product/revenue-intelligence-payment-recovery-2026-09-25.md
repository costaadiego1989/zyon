# Revenue Intelligence — recuperação do pagamento existente

Décima oitava entrega local, no worktree `AACP-revenue-intelligence`, branch `feat/revenue-intelligence-weekly`. O checkout consegue retomar um resultado financeiro já persistido depois da perda da resposta do chat. Sem implantação, ativação, chamadas pagas de IA, pagamentos ou mensagens externas.

## Comportamento entregue

A recuperação consulta a intenção financeira vinculada à mensagem original por `chat:<requestId>`. Não chama o provedor, não repete ferramentas e não cria outra chave de pagamento. Um recibo interrompido só é reconciliado quando há prova compatível no banco. Criação pendente ou incerta continua bloqueada até que o serviço financeiro existente resolva a mesma intenção.

O widget consulta o estado do chat e busca o resultado financeiro por uma rota autenticada, somente de leitura. Reutiliza os componentes existentes de PIX, boleto, cartão e cripto. Tanto uma resposta normal de seleção de pagamento quanto a retomada após perda da resposta usam esse percurso. Enquanto a recuperação está pendente, os fallbacks locais de criação de cobrança ficam bloqueados. A recuperação ocorre em segundo plano, sem botão “Verificar conversa”.

Pagamento aprovado aparece como “Pagamento confirmado.”; não é apresentado como pedido concluído, pois a confirmação financeira não comprova conclusão do pedido ou entrega. Recusa, cancelamento, reembolso e contestação não reapresentam controles para pagar. O payload financeiro não é salvo no armazenamento do navegador.

## Provas e autorização

- A seleção captura método, impressão do carrinho e hash do contexto comercial junto com as mensagens. O contexto inclui carrinho, frete, comprador, identidade global, conversa e método; exclui apenas `customer.asaasCustomerId`, que o preparo normal do pagamento pode acrescentar.
- A leitura exige a mesma loja/sessão/conversa, chave financeira, método, carrinho, moeda e total. O pagamento deve ter criação concluída, identificador do provedor, versão válida e estado financeiro conhecido.
- Alterar dados da compra invalida a projeção. Uma tentativa financeira posterior também impede reapresentar a cobrança antiga, inclusive quando a tentativa nova não tem prova de chat após rollback da flag. Isso não deduplica cobranças entre todos os canais.
- O registro imutável `CheckoutChatPaymentResolution` preserva intenção, versão, estado financeiro e recibo anterior. Prova e recibo reconciliado são gravados juntos; o banco rejeita mutação, prova forjada e conclusão sem evidência. A ordem de bloqueio é sessão, requisição e pagamento. Um processo atrasado não pode sobrescrever o recibo reconciliado.
- `GET /embed/chat/payment` exige `payment:intents:create`, a mesma autoridade que permite obter credenciais ao criar o pagamento, além da origem permitida e da vinculação assinada à loja/sessão. `checkout:chat` e a permissão limitada de leitura do status não bastam. Respostas usam `Cache-Control: no-store`.
- O estado do chat transporta apenas `payment_intent_id`. A rota financeira projeta ID, método, estado, valor, moeda e campos permitidos para o comprador; não expõe o payload de criação nem campos privados adicionais nas transferências.

## Persistência e compatibilidade

Migration aditiva `20260925020000_checkout_chat_payment_recovery`, posterior às migrations de requisições, trocas de mensagens, recuperação textual e seleção de pagamento. Acrescenta os campos nullable da prova, tabela de resolução, funções e restrições transacionais. A atualização do schema/cliente é necessária antes de executar este código, mesmo com a flag desligada, pois a leitura consulta as novas colunas.

A captura e a reconciliação financeira exigem `CHECKOUT_CHAT_PAYMENT_RECOVERY_ENABLED=true` e a loja explicitamente listada em `CHECKOUT_CHAT_RECOVERY_MERCHANT_IDS`; `*` não habilita lojas. O protocolo durável e suas demais condições continuam aplicáveis. Não há backfill de prova em mensagens antigas. Depois de reconciliado, o resultado continua legível após desligar a flag, sujeito às mesmas verificações comerciais e de autorização.

O baseline passa a `checkout-payment-routing-v2`; propostas congeladas na versão anterior não herdam silenciosamente o novo comportamento. Nenhuma proposta histórica foi reescrita.

A migration foi aplicada somente ao PostgreSQL descartável `revenue_recovery_final_0924`, porta local 5557, por execução do SQL. O banco de teste foi preparado a partir de schema/SQL e não tem histórico equivalente de `migrate deploy`; esta entrega não constitui ensaio completo de toda a cadeia de migrations. O diff do banco com o schema isolado ficou vazio. O cliente Prisma foi gerado em `apps/api/.audit/revenue-weekly/client`, preservando as dependências compartilhadas.

## Validação local

| Conjunto | Evidência |
| --- | --- |
| Revenue Manager, experimentos, baseline, preparo financeiro e middleware de loja | 385 testes aprovados |
| Recuperação financeira, requisições duráveis, controller e autorização embed | 80 testes aprovados, incluindo 24 cenários financeiros em PostgreSQL |
| Execução/publicação/recuperação de estratégia em PostgreSQL | 114 cenários aprovados entre a execução inicial e a retomada direcionada descrita abaixo |
| Cliente do widget | 9 testes aprovados |
| Navegador com HTTP local controlado | 17 cenários distintos aprovados entre a execução inicial e a correção direcionada descrita abaixo |
| TypeScript API/widget, schema Prisma e `git diff --check` | Aprovados |

São 605 testes distintos aprovados, sem contar novamente as reexecuções. A regressão PostgreSQL inicial aprovou os 23 cenários financeiros existentes naquele momento e 111 cenários de estratégia antes de parar em uma simulação de concorrência. O teste segurava o novo bloqueio de sessão enquanto esperava a própria recuperação; foi corrigido para pausar antes da transação de finalização. Esse cenário e os dois seguintes passaram na execução direcionada. A suite financeira foi ampliada para 24 casos e reexecutada integralmente com os demais testes da API, totalizando os 80 acima. Não houve execução única final dos 114 cenários de estratégia.

No navegador, a execução inicial passou em 16 cenários e revelou que um pagamento aprovado exibia indevidamente a tela de pedido concluído. A projeção foi corrigida e esse cenário passou. PIX, boleto e cartão hospedado também foram reexecutados após a correção, com screenshots em 320 px. Não houve uma segunda execução integral dos 17 cenários. A suite inclui retomada após perda/reload, resposta normal, indisponibilidade temporária, estados finais, limite de tentativas, offline, visibilidade e integração existente de voz. Os quatro métodos financeiros foram exercitados na API; carteira cripto, SDK Stripe, webhook e pagamento em provedor real não foram exercitados.

Os testes financeiros usam repositórios Prisma reais e `ResumePaymentCreationService` real com um provedor controlado. Um cenário usa também o `ChatResponseBuilder` real. A incerteza é resolvida pela mesma intenção, sem nova criação. Os testes do navegador usam o widget real e um servidor HTTP local de respostas controladas; não representam uma compra completa conectada à API real.

Os 385 testes unitários usaram `REDIS_URL` em branco após trim, para evitar que os testes existentes de agendador abrissem uma fila que depois substituem por uma implementação controlada. Essa execução não valida BullMQ/Redis real. A falha preexistente de ordem de campos de cadastro documentada na entrega 17 não foi alterada nem reclassificada como aprovada; aquele teste não pertence ao escopo executado aqui.

Logs locais: `.audit/revenue-weekly/payment-recovery-{unit,suite-final,strategy,final,client,browser,approved-browser,visual}.log`. O log `final` preserva uma falha da primeira versão do novo fixture financeiro; esse fixture foi corrigido e aprovado em `suite-final`. Auditoria, screenshots e cliente gerado não entram no commit.

## Pendências para o primeiro ciclo comercial

RI-09 permanece parcial: paridade completa do controle/ferramentas, outros chamadores, proteção de todas as gravações de sessão e comprovação de entrega/exposição. RI-10 ainda precisa conectar resultados econômicos, regras de parada e decisão de continuidade. A aprovação pública permanece bloqueada até a ligação segura com a ativação durável e seus requisitos.

A retomada do widget faz tentativas limitadas. O reconciliador financeiro existente roda a cada 15 minutos e seleciona intenções paradas por pelo menos 30 minutos; portanto uma criação incerta pode continuar indisponível depois das tentativas do widget e exigir uma nova visita após a resolução. Esta entrega não muda essa política operacional nem garante disponibilidade imediata após timeout. Expiração/renovação de credenciais, troca de método em falha e deduplicação entre todos os canais continuam fora deste escopo.

Não há piloto comercial concluído, revenue lift demonstrado, cupons/descontos experimentais ativos ou aprendizado compartilhado entre lojas. Esses itens mantêm os critérios do plano técnico.
