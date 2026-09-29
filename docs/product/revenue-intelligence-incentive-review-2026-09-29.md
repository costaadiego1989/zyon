# Decisão específica sobre o incentivo

Entrega 45, em 29/09/2026. Complementa o [financiamento recomendado](revenue-intelligence-recommended-funding-2026-09-29.md) e o [plano técnico](revenue-intelligence-implementation-plan-2026-09-24.md).

## Comportamento para o lojista

O dashboard permite registrar aprovação, recusa e cancelamento da aprovação dos valores sugeridos pelo motor. Não oferece campos para montar orçamento, desconto, público ou duração. A decisão é independente da comunicação. A confirmação diz explicitamente que o teste de incentivo ainda não começa; o estado aprovado é `approved_awaiting_activation`.

Os detalhes conservam os limites sugeridos, mostram a decisão atual e sua data e distinguem ausência de orçamento de um registro financeiro interno. Propostas antigas permanecem consultáveis, inclusive para cancelar uma aprovação anterior. Erro de leitura bloqueia novas decisões; resposta perdida permite repetir o mesmo comando. Após qualquer resposta, inclusive um recibo histórico de aprovação, a tela consulta o estado atual. Uma aprovação antiga não substitui visualmente um cancelamento posterior.

Cada decisão cria uma notificação persistida junto com o recibo. A aprovação da comunicação continua iniciando somente seu próprio teste. Abrir os detalhes não envia decisões nem gera chamadas de IA.

## API e condições

Rotas autenticadas em `/revenue-manager/strategies/:id/incentive`: `GET`, `POST /approve`, `POST /reject` e `POST /withdraw`. A loja e o autor vêm da autenticação. O comando aceita versão, hash da proposta, hash da recomendação, chave de repetição e comentário opcional; valores financeiros, regras, datas ou identidades fornecidos pelo cliente são recusados. O transporte do dashboard envia somente os quatro campos de identidade da decisão.

Novas aprovações exigem o recurso no plano, `REVENUE_INCENTIVE_REVIEW_ENABLED=true` e loja explicitamente listada em `REVENUE_INCENTIVE_REVIEW_MERCHANT_IDS`. `*` não habilita lojas. A recomendação precisa ser v2, canônica, completa, viável, vinculada ao documento congelado da análise concluída e aos limites financeiros/regras vigentes. A proposta deve ser atual, dentro da validade e pertencer a uma loja inscrita no ciclo semanal. Aprovar comunicação antes ou depois não registra consentimento para incentivo.

Uma versão recebe uma decisão inicial: aprovar ou recusar. Uma aprovação pode ser cancelada uma única vez. Recusa e cancelamento continuam disponíveis após suspensão das flags, alteração de plano ou de política. Cancelar uma aprovação antiga não exige que sua versão continue atual. Repetir exatamente uma solicitação aceita devolve seu recibo original, sem reabrir autorização; o GET e as verificações transacionais determinam o estado atual. Alterar autor, ação ou conteúdo com a mesma chave provoca conflito.

## Orçamento e persistência

Novos financiamentos e reservas agora exigem o recibo específico de aprovação, além das verificações anteriores. O orçamento vincula `review_id`, versão, política, proposta e autor que aprovou. Um recibo de outra loja, uma recusa ou um cancelamento não financiam a estratégia. O início planejado deve ocorrer depois da aprovação e antes do vencimento da proposta. Nenhuma rota de revisão cria esse orçamento ou inicia seu prazo de sete dias.

O cancelamento fecha um orçamento existente na mesma transação. Reservas pendentes continuam comprometendo o saldo até conciliação; consumo e liberação continuam possíveis. Um financiamento histórico sem `review_id` não recebe autorização retroativa nem novas reservas. A contabilidade interna ainda exige estratégia de comunicação `pending_review`; flexibilizar esse estado depende da integração da execução comercial, incluindo prevenção de interferência entre experimentos.

Migração `20260929080000_incentive_specific_review`, espelhada em `prisma/migrations` e `prisma/deploy-migrations`: recibos imutáveis, cabeça de sequência protegida e vínculo opcional nos orçamentos históricos, obrigatório para novas inserções. Os gatilhos impedem alterações/remoções, aprovação de documentos antigos ou bloqueados, substituição de versão/política, ausência de consentimento e novas reservas após cancelamento. A cabeça mutável também invalida snapshots anteriores em `REPEATABLE READ`. A aplicação revalida integralmente os documentos canônicos; os gatilhos não substituem autenticação nem avaliação de margem do checkout.

## Validação local

Passaram 265 testes: 100 de domínio e três de controlador/contrato; 78 cenários de aprovação/orçamento no PostgreSQL; 70 de revisão/publicação; cinco de execução de comunicação; nove de transporte do dashboard. Cobrem isolamento, repetição, concorrência de aprovação/recusa, cancelamento simultâneo à reserva, snapshots antigos, rollback de recibo/notificação/fechamento, expiração, alteração de regras/política e proteção da conciliação.

TypeScript da API e do dashboard, além de jornadas de navegador com HTTP controlado em 1440 e 390 px. No navegador: aprovação, recusa, cancelamento, erro de leitura, conflito, repetição de resposta perdida e preservação do cancelamento após recibo antigo. As jornadas também verificam regressões da revisão de comunicação e das métricas existentes. Não são evidência de checkout comercial ou de provedor real.

Os dois bancos locais passaram a 59 migrações. SHA-256 da migração nas duas árvores e no banco: `972b8f1feeb791986bc9e82dda229be04d7f3deb1bd63f9111e54be340d48576`. Cliente Prisma gerado somente em `.audit/revenue-weekly/client`. Logs e capturas em `.audit/revenue-weekly/specific-review-*`. Flags permanecem desativadas por padrão; sem implantação, mensagens externas ou chamada a modelo/provedor real.

## Trabalho ainda necessário

Esta aprovação registra consentimento para os termos; não torna o incentivo executável. Faltam atribuição controlada dos compradores, integração transacional com checkout/cupom/pagamento, revalidação de catálogo/custos/público/margem/empilhamento/saldo, conciliação com evidência comercial e métricas reais de uso, conversão, margem e devoluções. A alternativa de comunicação existente conserva o incentivo congelado; gerar uma nova alternativa financeira requer um fluxo próprio de proposta e nova aprovação. Aprendizado validado entre lojas, demais canais, economia integral e piloto operacional também permanecem no plano.
