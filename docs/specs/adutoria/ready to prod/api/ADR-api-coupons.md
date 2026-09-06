# ADR — API / coupons

Data: 2026-09-05. Status: decisão de auditoria registrada; correções propostas. Veredito: **FAIL**.

[Índice geral](<../README.md>) · [API primeiro](<README.md>) · [Evidências e limites](<../VALIDACAO.md>)

## Contexto e responsabilidade

Validar elegibilidade, aplicar e resgatar cupons.

Inventário: 24 arquivos de implementação, 15 arquivos reconhecidos como testes, 1274 linhas de implementação. 5 declarações HTTP; 5 alcançáveis pela composição estática. Contagem de testes não é cobertura de branches nem execução comprovada.

## Boundary, dependências e ownership

Imports intermodulares observados: **auth, checkout, embed, merchant, payment**. A lista inclui referências de tipo e é evidência de acoplamento de código, não de todas as dependências em runtime.

Acessos Prisma reconhecidos pelo extrator: `checkoutEvent`, `coupon`, `couponRedemption`. Nomes são modelos acessados, não prova de ownership; casts e SQL bruto podem exigir leitura adicional.

Limite global/buyer é read-check-write e consumo/evento não é atômico. Teste de desconto percentual falhou com expectativa 30 versus resultado 15; decisão de limite deve ser alinhada ao contrato comercial, sem alterar regra só para deixar teste verde.

| Coesão | Controle do acoplamento | Boundary | Ownership dos dados | Prontidão |
| --- | --- | --- | --- | --- |
| 8/10 | 6/10 | 6/10 | 6/10 | 3/10 |

Notas são avaliação técnica qualitativa do código inspecionado, não métricas de carga nem garantia de segurança. Zero em knowledge-base significa ausência de evidência, não reprovação de código inexistente.

## Controles observados

Entidades/políticas fazem cálculo e limites de benefício; há suítes de regras e redemption.

## God services, SOLID, KISS e DRY

| Classe inspecionável | Linhas da classe | Dependências no construtor | Fonte |
| --- | --- | --- | --- |
| ApplyCouponUseCase | 105 | 4 | [apps/api/src/modules/coupons/application/use-cases/apply-coupon.use-case.ts:26](<../../../../../apps/api/src/modules/coupons/application/use-cases/apply-coupon.use-case.ts#L26>) |
| WidgetCouponsController | 85 | 6 | [apps/api/src/modules/coupons/presentation/http/widget-coupons.controller.ts:14](<../../../../../apps/api/src/modules/coupons/presentation/http/widget-coupons.controller.ts#L14>) |
| CouponRedemptionEntity | 48 | 1 | [apps/api/src/modules/coupons/domain/entities/coupon-redemption.entity.ts:20](<../../../../../apps/api/src/modules/coupons/domain/entities/coupon-redemption.entity.ts#L20>) |

Não há candidato acima de 300 linhas/10 dependências entre as classes listadas. Isso não certifica SRP/LSP/ISP; contratos e comportamentos substituíveis precisam dos testes descritos.

DIP/boundary: revisar os imports acima e os acessos a dados com a matriz global. DRY: compartilhar contratos e política de unidade/estado, preservando regra no módulo dono. KISS/object calisthenics são critérios de legibilidade; não justificam fragmentar métodos mecanicamente ou criar microserviços.

## Transações, concorrência, segurança e resiliência

- [API-021](<ADR-api-coupons.md#api-021>) (P1): Limites de uso podem ser excedidos em sessões concorrentes.

Performance/índices: consultar [matriz de schema e operação](<../BANCO-E-OPERACAO.md>). Planos reais, pool, memória, CPU, cache distribuído e volume de 10.000 usuários: **REQUIRES LOAD VALIDATION**.

Observabilidade: Logger/CorrelationId e infraestrutura comum existem, mas dashboards/alertas e correlação ponta a ponta deste módulo são **INFRA VALIDATION REQUIRED**. Segurança externa, segredos configurados e recuperação de backup não foram inspecionados no ambiente produtivo.

## Decisão e consequências

1. Preservar o monólito modular e atribuir ao módulo somente sua capacidade descrita.
2. Corrigir os achados vinculados antes de habilitar/liberar os fluxos afetados.
3. Expor comunicação por portas/facades e eventos versionados; acesso direto a outro agregado deve ser substituído gradualmente.
4. Validar em banco/servidor real os cenários do gate; nenhum PASS de produção é inferido da existência de testes.

Gate específico: **Corrida por última utilização, cap financeiro, expiração, cancelamento e replay de consumo em banco.**

Consequência: o módulo poderá ser reavaliado isoladamente após a correção, mas a liberação depende dos gates compartilhados de autenticação, tenant, persistência, build e mensageria.

## Superfície HTTP observada

| Método/path normalizado | Composição | Metadata extraída | Evidência |
| --- | --- | --- | --- |
| POST /merchant/coupons | Alcançável estaticamente | UseGuards(AuthGuard); UseGuards(PlanLimitGuard) | [apps/api/src/modules/coupons/presentation/http/merchant-coupons.controller.ts:18](<../../../../../apps/api/src/modules/coupons/presentation/http/merchant-coupons.controller.ts#L18>) |
| GET /merchant/coupons | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/coupons/presentation/http/merchant-coupons.controller.ts:26](<../../../../../apps/api/src/modules/coupons/presentation/http/merchant-coupons.controller.ts#L26>) |
| PATCH /merchant/coupons/:id | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/coupons/presentation/http/merchant-coupons.controller.ts:33](<../../../../../apps/api/src/modules/coupons/presentation/http/merchant-coupons.controller.ts#L33>) |
| DELETE /merchant/coupons/:id | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/coupons/presentation/http/merchant-coupons.controller.ts:39](<../../../../../apps/api/src/modules/coupons/presentation/http/merchant-coupons.controller.ts#L39>) |
| POST /embed/coupons/apply | Alcançável estaticamente | UseGuards(EmbedAuthGuard) | [apps/api/src/modules/coupons/presentation/http/widget-coupons.controller.ts:28](<../../../../../apps/api/src/modules/coupons/presentation/http/widget-coupons.controller.ts#L28>) |

/v1 é removido pelo middleware de versionamento antes do roteamento; o prefixo não ativa um controller ausente nem contorna NonProductionRoute. Paths listados são declarações estáticas; boot Nest e colisões precisam de smoke.

<a id="api-021"></a>

## API-021 — Limites de uso podem ser excedidos em sessões concorrentes

| Campo | Registro |
| --- | --- |
| ID | API-021 |
| SEVERITY | P1 |
| MODULE | coupons |
| FILE(S) | [apps/api/src/modules/coupons/application/use-cases/apply-coupon.use-case.ts:35](<../../../../../apps/api/src/modules/coupons/application/use-cases/apply-coupon.use-case.ts#L35>)<br>[apps/api/src/modules/coupons/application/use-cases/redeem-coupon.use-case.ts:19](<../../../../../apps/api/src/modules/coupons/application/use-cases/redeem-coupon.use-case.ts#L19>) |
| ISSUE | Limites de uso podem ser excedidos em sessões concorrentes |
| EVIDENCE | Apply lê contadores global/por buyer e depois grava redemption. Unicidade por sessão não limita duas sessões distintas. Redeem grava estado, contador e outbox em passos separados. |
| VERIFICATION | CONFIRMED_STATIC |
| PRODUCTION IMPACT | Cupom de uso único pode ser consumido mais vezes e falhas intermediárias podem desalinhar contador/evento. |
| ROOT CAUSE | Invariante global implementada como consultas seguidas de gravação sem reserva atômica. |
| RECOMMENDED FIX | Reservar cota global/buyer em transação com CAS/lock e chave única de redemption; consumo, contador e evento devem compartilhar commit. |
| COMPLEXITY | L (S: pequena; M: média; L: ampla, sem estimativa de prazo) |
| RISK OF CHANGE | Alto |
| BLOCKS PROD? | YES |
| CRITÉRIO DE ACEITE | Com maxUses=1, duas sessões/buyers paralelos produzem um consumo; crash em cada fronteira não altera cota nem publica em duplicidade. |

Decisão: bloquear a liberação da capacidade afetada até cumprir o critério de aceite. Correção ainda não implementada nesta auditoria.


## Reavaliação

Executar o gate específico, os critérios dos achados e testes relevantes da [sequência de correções](<../PLANO-DE-CORRECAO.md>). Guardar commit, configuração não secreta, comandos, resultado e evidência de banco/provedor. A auditoria atual não realizou essas correções.
