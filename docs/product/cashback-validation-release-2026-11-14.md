# Validação e publicação do cashback

O cashback é crédito em BRL para novas compras na mesma loja. Site e WhatsApp
usam o mesmo comprador canônico e a mesma carteira por loja. Todas as lojas
começam com o programa desligado; não há preenchimento de regras comerciais
pelo sistema e todos os planos podem configurar o módulo.

## Seeds de validação

O comando compilado é `node dist/seeds/cashback-validation-seed.js`, executado
em `apps/api`. Após o build local da API, execute também
`node apps/api/prisma/seeds/cashback-validation-build.mjs` na raiz para checar
os tipos e compilar o seed sem executá-lo. O Docker já executa esse helper. A rotina
não deve ser adicionada à inicialização do serviço.

Os parâmetros obrigatórios são `CASHBACK_QA_ENV`, `CASHBACK_QA_DATABASE_URL`,
`CASHBACK_QA_CONFIRM=qa-cashback-v1`, `CASHBACK_QA_OWNER_PASSWORD` e um destino
privado para `CASHBACK_QA_MANIFEST_PATH`. A senha deve ser gerada fora do
repositório. Em homologação também são obrigatórios `CASHBACK_QA_EXPECT_HOST`
e `CASHBACK_QA_EXPECT_DATABASE`, conferidos contra o alvo real e o ambiente de
implantação. A rotina recusa produção, parâmetros de redirecionamento da URL,
namespace incorreto e colisões com entidades que não pertençam ao seed.

São 15 lojas QA, dois compradores, um alias anterior do WhatsApp e 60 itens de
catálogo: produtos físicos, serviços, digitais e comida. Os identificadores
começam com `qa-cashback-v1-`. O telefone representa uma pré-condição sintética;
não comprova posse de OTP ou entrega da Meta. Consentimentos de marketing são
revogados e os templates das lojas QA, incluindo o registro do seed, ficam
inativos. Nenhuma conexão de pagamento é criada. A repetição revalida o catálogo
completo e desativa novos templates dessas mesmas lojas, mesmo após uma
atualização anterior. O manifest persistido é conferido contra as 15 lojas
exatas antes de qualquer operação derivada; IDs externos ou com sufixos são recusados.

O manifest contém lojas, compradores, nonces, casos, valores esperados e os
pedidos/pagamentos explicitamente sintéticos. Não contém JWTs ou a senha do
lojista. Arquivos privados de autenticação são emitidos separadamente para a
automação, usando os serviços reais de autenticação e sessões persistidas.

A extensão `cashback-experience-v1` traz revisões reais e checklists vazio,
parcial e completo, relatório com datas e dias zerados, e um período histórico
que mantém saldos e orçamento atuais. As quatro escolhas parciais são fixtures
explícitas de QA; não são valores iniciais para lojas reais. O vencimento
de três dias declara a passagem de R$ 5 disponíveis/R$ 5 expirados para
R$ 0/R$ 10 em `referenceAt + 2 dias`. Os valores imediatos originais permanecem
no manifest; valide o estado atual com essa política temporal, sem regravar
ledger ou substituir expectativas por valores encontrados no banco.

## Valores de referência

| Cenário | Produtos | Cupom | Regra | Cashback | Mercadoria paga | Cashback previsto |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Teto específico de 30% | R$ 100 | R$ 10 | R$ 5 | R$ 15 | R$ 70 | R$ 3,50 |
| Respeitar teto geral de 20% | R$ 100 | R$ 10 | R$ 5 | R$ 5 | R$ 80 | R$ 4 |

Frete e taxa de serviço não geram cashback. O cenário de pagamento sintético
usa taxa de R$ 0,99 separada. O catálogo, os limites individuais, a margem, as
permissões por origem e o saldo continuam sendo conferidos mesmo quando o
lojista escolhe um teto específico.

Há casos de proibição de cupom/regra, margem mínima, programa desativado,
rascunho, pausa, encerramento, isolamento, vencimento, liberação por entrega,
estorno parcial, perda promocional e pagamento pendente. Nos casos pendentes,
`cashback_payment_requires_reconciliation` é uma observação esperada da
fixture: nenhum teste deve liberar um compromisso financeiro incerto para
produzir um relatório sem alertas.

## Sequência de publicação

1. Construir uma candidata isolada a partir dos componentes realmente servidos.
   Conferir os hashes de origem e preservar alterações concorrentes.
2. Aplicar schema e restrições SQL reais em PostgreSQL dedicado. Executar o
   seed compilado duas vezes e comparar integralmente o ledger antes dos gestos
   de escrita. Rodar API compilada, autorização independente e navegador real.
3. Publicar a revisão imutável em homologação. Aguardar implantação e health,
   conferir fontes e bundles servidos, executar os seeds duas vezes e repetir
   as jornadas autenticadas. Observar também um ciclo automático dos jobs.
4. Promover essa mesma revisão somente com homologação aprovada. Em produção,
   conferir revisão, migrations, saúde e leitura autenticada; não executar
   seeds nem ativar cashback em lojas reais.

A validação distingue serviços/PostgreSQL reais de pré-condições sintéticas de
PSP, pedidos e WhatsApp. Não implica cobrança, estorno externo, envio de
campanha ou aceitação de um comprador real pela Meta.

Os relatórios de execução e diagnósticos ficam em
`.specs/features/cashback-release/evidence/`, fora do artefato publicado. O
controle `scripts/cashback-release-check.mjs` lê os relatórios e recusa uma
etapa incompleta; ele próprio não implanta, migra ou popula bancos.
