# ADR — API / self-checkout

Data: 2026-09-05. Status: decisão de auditoria registrada; correções propostas. Veredito: **FAIL**.

[Índice geral](<../README.md>) · [API primeiro](<README.md>) · [Evidências e limites](<../VALIDACAO.md>)

## Contexto e responsabilidade

Jornada alternativa de checkout e autenticação de comprador.

Inventário: 32 arquivos de implementação, 9 arquivos reconhecidos como testes, 1409 linhas de implementação. 12 declarações HTTP; 0 alcançáveis pela composição estática. Contagem de testes não é cobertura de branches nem execução comprovada.

## Boundary, dependências e ownership

Nenhum import intermodular TypeScript extraído neste diretório.

Acessos Prisma reconhecidos pelo extrator: `selfCheckoutBuyerUser`, `selfCheckoutSavedAddress`, `selfCheckoutSavedPaymentMethod`, `selfCheckoutTemplate`, `selfCheckoutWallet`. Nomes são modelos acessados, não prova de ownership; casts e SQL bruto podem exigir leitura adicional.

Doze handlers não montados; guard usa req.buyer, enquanto BuyerReturns lê req.buyerUser. Jornada duplicada pode divergir do embed e das sessões buyer atuais.

| Coesão | Controle do acoplamento | Boundary | Ownership dos dados | Prontidão |
| --- | --- | --- | --- | --- |
| 5/10 | 4/10 | 4/10 | 4/10 | 2/10 |

Notas são avaliação técnica qualitativa do código inspecionado, não métricas de carga nem garantia de segurança. Zero em knowledge-base significa ausência de evidência, não reprovação de código inexistente.

## Controles observados

Há entidades/portas e guard buyer próprios.

## God services, SOLID, KISS e DRY

| Classe inspecionável | Linhas da classe | Dependências no construtor | Fonte |
| --- | --- | --- | --- |
| PrismaBuyerWalletRepository | 97 | 1 | [apps/api/src/modules/self-checkout/infrastructure/repositories/prisma-buyer-wallet.repository.ts:6](<../../../../../apps/api/src/modules/self-checkout/infrastructure/repositories/prisma-buyer-wallet.repository.ts#L6>) |
| BuyerMeController | 86 | 10 | [apps/api/src/modules/self-checkout/presentation/http/buyer-me.controller.ts:23](<../../../../../apps/api/src/modules/self-checkout/presentation/http/buyer-me.controller.ts#L23>) |
| PrismaBuyerTemplateRepository | 58 | 1 | [apps/api/src/modules/self-checkout/infrastructure/repositories/prisma-buyer-template.repository.ts:6](<../../../../../apps/api/src/modules/self-checkout/infrastructure/repositories/prisma-buyer-template.repository.ts#L6>) |

Não há candidato acima de 300 linhas/10 dependências entre as classes listadas. Isso não certifica SRP/LSP/ISP; contratos e comportamentos substituíveis precisam dos testes descritos.

DIP/boundary: revisar os imports acima e os acessos a dados com a matriz global. DRY: compartilhar contratos e política de unidade/estado, preservando regra no módulo dono. KISS/object calisthenics são critérios de legibilidade; não justificam fragmentar métodos mecanicamente ou criar microserviços.

## Transações, concorrência, segurança e resiliência

- [SF-005](<../storefront/ADR-storefront.md#sf-005>) (P1): Devolução do comprador chama controller não montado.
- [API-036](<ADR-api-public-api.md#api-036>) (P1): Maioria dos controllers públicos não entra no AppModule.

Performance/índices: consultar [matriz de schema e operação](<../BANCO-E-OPERACAO.md>). Planos reais, pool, memória, CPU, cache distribuído e volume de 10.000 usuários: **REQUIRES LOAD VALIDATION**.

Observabilidade: Logger/CorrelationId e infraestrutura comum existem, mas dashboards/alertas e correlação ponta a ponta deste módulo são **INFRA VALIDATION REQUIRED**. Segurança externa, segredos configurados e recuperação de backup não foram inspecionados no ambiente produtivo.

## Decisão e consequências

1. Preservar o monólito modular e atribuir ao módulo somente sua capacidade descrita.
2. Corrigir os achados vinculados antes de habilitar/liberar os fluxos afetados.
3. Expor comunicação por portas/facades e eventos versionados; acesso direto a outro agregado deve ser substituído gradualmente.
4. Validar em banco/servidor real os cenários do gate; nenhum PASS de produção é inferido da existência de testes.

Gate específico: **Decidir suportar ou aposentar; se suportada, alinhar principal/cookie/DTO e testar mesma invariância financeira do embed.**

Consequência: o módulo poderá ser reavaliado isoladamente após a correção, mas a liberação depende dos gates compartilhados de autenticação, tenant, persistência, build e mensageria.

## Superfície HTTP observada

| Método/path normalizado | Composição | Metadata extraída | Evidência |
| --- | --- | --- | --- |
| POST /buyer/register | Não montada | Sem metadata de guard extraída; verificar guards globais/método | [apps/api/src/modules/self-checkout/presentation/http/buyer-auth.controller.ts:43](<../../../../../apps/api/src/modules/self-checkout/presentation/http/buyer-auth.controller.ts#L43>) |
| POST /buyer/login | Não montada | Sem metadata de guard extraída; verificar guards globais/método | [apps/api/src/modules/self-checkout/presentation/http/buyer-auth.controller.ts:50](<../../../../../apps/api/src/modules/self-checkout/presentation/http/buyer-auth.controller.ts#L50>) |
| GET /me/wallet/addresses | Não montada | UseGuards(BuyerAuthGuard) | [apps/api/src/modules/self-checkout/presentation/http/buyer-me.controller.ts:40](<../../../../../apps/api/src/modules/self-checkout/presentation/http/buyer-me.controller.ts#L40>) |
| POST /me/wallet/addresses | Não montada | UseGuards(BuyerAuthGuard) | [apps/api/src/modules/self-checkout/presentation/http/buyer-me.controller.ts:46](<../../../../../apps/api/src/modules/self-checkout/presentation/http/buyer-me.controller.ts#L46>) |
| DELETE /me/wallet/addresses/:id | Não montada | UseGuards(BuyerAuthGuard) | [apps/api/src/modules/self-checkout/presentation/http/buyer-me.controller.ts:51](<../../../../../apps/api/src/modules/self-checkout/presentation/http/buyer-me.controller.ts#L51>) |
| GET /me/wallet/payment-methods | Não montada | UseGuards(BuyerAuthGuard) | [apps/api/src/modules/self-checkout/presentation/http/buyer-me.controller.ts:57](<../../../../../apps/api/src/modules/self-checkout/presentation/http/buyer-me.controller.ts#L57>) |
| POST /me/wallet/payment-methods | Não montada | UseGuards(BuyerAuthGuard) | [apps/api/src/modules/self-checkout/presentation/http/buyer-me.controller.ts:67](<../../../../../apps/api/src/modules/self-checkout/presentation/http/buyer-me.controller.ts#L67>) |
| DELETE /me/wallet/payment-methods/:id | Não montada | UseGuards(BuyerAuthGuard) | [apps/api/src/modules/self-checkout/presentation/http/buyer-me.controller.ts:79](<../../../../../apps/api/src/modules/self-checkout/presentation/http/buyer-me.controller.ts#L79>) |
| GET /me/templates | Não montada | UseGuards(BuyerAuthGuard) | [apps/api/src/modules/self-checkout/presentation/http/buyer-me.controller.ts:85](<../../../../../apps/api/src/modules/self-checkout/presentation/http/buyer-me.controller.ts#L85>) |
| POST /me/templates | Não montada | UseGuards(BuyerAuthGuard) | [apps/api/src/modules/self-checkout/presentation/http/buyer-me.controller.ts:90](<../../../../../apps/api/src/modules/self-checkout/presentation/http/buyer-me.controller.ts#L90>) |
| POST /me/templates/:id/execute | Não montada | UseGuards(BuyerAuthGuard) | [apps/api/src/modules/self-checkout/presentation/http/buyer-me.controller.ts:95](<../../../../../apps/api/src/modules/self-checkout/presentation/http/buyer-me.controller.ts#L95>) |
| POST /me/consent | Não montada | UseGuards(BuyerAuthGuard) | [apps/api/src/modules/self-checkout/presentation/http/buyer-me.controller.ts:104](<../../../../../apps/api/src/modules/self-checkout/presentation/http/buyer-me.controller.ts#L104>) |

/v1 é removido pelo middleware de versionamento antes do roteamento; o prefixo não ativa um controller ausente nem contorna NonProductionRoute. Paths listados são declarações estáticas; boot Nest e colisões precisam de smoke.



## Reavaliação

Executar o gate específico, os critérios dos achados e testes relevantes da [sequência de correções](<../PLANO-DE-CORRECAO.md>). Guardar commit, configuração não secreta, comandos, resultado e evidência de banco/provedor. A auditoria atual não realizou essas correções.
