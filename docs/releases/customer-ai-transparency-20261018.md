# Transparência de consumo de IA no dashboard

Status: validado no sandbox em 18/10/2026, aguardando aprovação para produção.

## Comportamento

Financeiro → Relatórios passa a mostrar sessões de voz com atividade no período e tokens de entrada e saída. O detalhamento de texto/áudio, os dias de uso e as informações de cobertura ficam recolhidos. O filtro de datas e o botão Atualizar também atualizam o consumo. Há um CSV próprio para consumo, separado do relatório de pedidos e reembolsos.

Os números vêm dos eventos de uso já registrados no servidor a partir das respostas dos provedores. O relatório não calcula uma cobrança ao cliente e não expõe custos internos, tarifas dos provedores, prompts ou identificadores de conversação.

## Contrato e isolamento

- `GET /v1/dashboard/finance/ai-usage` e `/export.csv` usam exclusivamente a loja da sessão autenticada. Apenas proprietário e administrador podem acessar.
- O período segue as datas inclusivas do Financeiro, em America/Sao_Paulo, limitado a 366 dias. As consultas compartilham um snapshot consistente.
- Apenas `server_http` e `server_sideband` entram nos totais; admissões de voz, reservas e eventos informados pelo navegador não representam consumo medido.
- Tokens de texto e áudio são partes dos totais de entrada e saída. Contagens são strings inteiras para preservar precisão.
- Zero medido, ausência de registros e metadados ausentes são estados diferentes. A tela sinaliza medição parcial, inclusive sessões encerradas sem observação e falhas de observação de voz.
- Sessões são distintas no período. Uma sessão com atividade em vários dias continua contando uma vez no total do período. Nenhum tempo de conexão é apresentado como minutos falados.

## Limite conhecido

O contador atual de admissão da franquia de voz não cobre todos os caminhos do storefront e da narração. Portanto, este relatório apresenta consumo observado e não promete saldo restante da franquia. A cobertura é declarada nos detalhes e no CSV. Esta entrega não altera planos, limites, bloqueios de uso nem o provedor de voz. A análise de infraestrutura de voz permanece adiada até a aprovação desta etapa.

## Validação

Os testes de integração usam PostgreSQL e Redis reais, sessões autenticadas e os guards da aplicação. Cobrem isolamento entre lojas e conta/loja filha, tentativas de troca de tenant, acesso anônimo, papéis de usuário, limites de período, fronteira de datas em Brasília, CSV, uso sem preço e separação entre texto e áudio.

O roteiro `apps/api/tests/customer-ai-usage-live.ts` executa exclusivamente no sandbox. Ele cria duas lojas temporárias, registra dados controlados de consumo e confere a API publicada e a tela em desktop/mobile sem interceptar respostas de API. Confere download, filtros, ausência de consumo, ausência de medição e zero medido. Remove seus registros ao terminar. Esse roteiro valida a leitura e apresentação de dados; não executa uma nova chamada paga ao provedor.

Os artefatos e resultados ficam em `.audit/customer-ai-transparency-20261018/` no workspace de operação. A checagem TypeScript de runtime da API e o typecheck/build do dashboard são obrigatórios. O typecheck geral da API também inclui testes antigos com erros de tipos fora desta alteração; isso não deve ser relatado como CI global aprovado.

A validação publicada terminou em `2026-10-18T21:13:08.496Z`, com os cinco grupos de verificações aprovados e todos os registros temporários removidos. Os bundles servidos foram comparados por SHA-256 com o build local, incluindo a configuração pública de Turnstile e a URL da API do sandbox. O indicador do dashboard identifica o ambiente como SANDBOX.

## Publicação

Sandbox: `https://app-sandbox.zyon-payments.com.br`, Financeiro → Relatórios.

A produção permanece na versão anterior. A promoção desta funcionalidade e a próxima etapa sobre voz dependem da aprovação do usuário após a revisão do sandbox.
