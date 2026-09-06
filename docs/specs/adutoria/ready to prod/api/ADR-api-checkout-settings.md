# ADR — API / checkout-settings

Data: 2026-09-05. Status: decisão de auditoria registrada; correções propostas. Veredito: **FAIL**.

[Índice geral](<../README.md>) · [API primeiro](<README.md>) · [Evidências e limites](<../VALIDACAO.md>)

## Contexto e responsabilidade

Configurar experiência, regras visuais e gatilhos do checkout.

Inventário: 9 arquivos de implementação, 5 arquivos reconhecidos como testes, 1214 linhas de implementação. 5 declarações HTTP; 5 alcançáveis pela composição estática. Contagem de testes não é cobertura de branches nem execução comprovada.

## Boundary, dependências e ownership

Imports intermodulares observados: **integrations**. A lista inclui referências de tipo e é evidência de acoplamento de código, não de todas as dependências em runtime.

Acessos Prisma reconhecidos pelo extrator: `checkoutSetting`. Nomes são modelos acessados, não prova de ownership; casts e SQL bruto podem exigir leitura adicional.

Controle no servidor existe, mas dashboard busca ETag novo ao salvar. Widget transforma gatilho em desconto local sem consultar autorização; settings não deve carregar regra financeira duplicada.

| Coesão | Controle do acoplamento | Boundary | Ownership dos dados | Prontidão |
| --- | --- | --- | --- | --- |
| 8/10 | 6/10 | 7/10 | 7/10 | 4/10 |

Notas são avaliação técnica qualitativa do código inspecionado, não métricas de carga nem garantia de segurança. Zero em knowledge-base significa ausência de evidência, não reprovação de código inexistente.

## Controles observados

DTOs e contexto separado; GET ETag e PUT com If-Match; repositório possui update condicional por updatedAt.

## God services, SOLID, KISS e DRY

| Classe inspecionável | Linhas da classe | Dependências no construtor | Fonte |
| --- | --- | --- | --- |
| CheckoutSettingsEntity | 199 | 1 | [apps/api/src/modules/checkout-settings/domain/entities/checkout-settings.entity.ts:51](<../../../../../apps/api/src/modules/checkout-settings/domain/entities/checkout-settings.entity.ts#L51>) |
| CheckoutSettingsController | 138 | 5 | [apps/api/src/modules/checkout-settings/presentation/http/checkout-settings.controller.ts:105](<../../../../../apps/api/src/modules/checkout-settings/presentation/http/checkout-settings.controller.ts#L105>) |
| WidgetConfigDto | 70 | 0 | [apps/api/src/modules/checkout-settings/presentation/http/checkout-settings.dto.ts:289](<../../../../../apps/api/src/modules/checkout-settings/presentation/http/checkout-settings.dto.ts#L289>) |

Não há candidato acima de 300 linhas/10 dependências entre as classes listadas. Isso não certifica SRP/LSP/ISP; contratos e comportamentos substituíveis precisam dos testes descritos.

DIP/boundary: revisar os imports acima e os acessos a dados com a matriz global. DRY: compartilhar contratos e política de unidade/estado, preservando regra no módulo dono. KISS/object calisthenics são critérios de legibilidade; não justificam fragmentar métodos mecanicamente ou criar microserviços.

## Transações, concorrência, segurança e resiliência

- [DASH-005](<../dashboard/ADR-dashboard.md#dash-005>) (P2): Salvar configurações busca ETag novo e pode sobrescrever edição concorrente.
- [W2-010](<../widget_v2/ADR-widget_v2.md#w2-010>) (P2): Desconto é anunciado sem autorização persistida.

Performance/índices: consultar [matriz de schema e operação](<../BANCO-E-OPERACAO.md>). Planos reais, pool, memória, CPU, cache distribuído e volume de 10.000 usuários: **REQUIRES LOAD VALIDATION**.

Observabilidade: Logger/CorrelationId e infraestrutura comum existem, mas dashboards/alertas e correlação ponta a ponta deste módulo são **INFRA VALIDATION REQUIRED**. Segurança externa, segredos configurados e recuperação de backup não foram inspecionados no ambiente produtivo.

## Decisão e consequências

1. Preservar o monólito modular e atribuir ao módulo somente sua capacidade descrita.
2. Corrigir os achados vinculados antes de habilitar/liberar os fluxos afetados.
3. Expor comunicação por portas/facades e eventos versionados; acesso direto a outro agregado deve ser substituído gradualmente.
4. Validar em banco/servidor real os cenários do gate; nenhum PASS de produção é inferido da existência de testes.

Gate específico: **Teste consumidor ETag obsoleto, validação das regras, default conservador e consistência entre dashboard/widget.**

Consequência: o módulo poderá ser reavaliado isoladamente após a correção, mas a liberação depende dos gates compartilhados de autenticação, tenant, persistência, build e mensageria.

## Superfície HTTP observada

| Método/path normalizado | Composição | Metadata extraída | Evidência |
| --- | --- | --- | --- |
| GET /checkout-settings/widget-config | Alcançável estaticamente | PublicRoute() | [apps/api/src/modules/checkout-settings/presentation/http/checkout-settings.controller.ts:50](<../../../../../apps/api/src/modules/checkout-settings/presentation/http/checkout-settings.controller.ts#L50>) |
| GET /checkout-settings | Alcançável estaticamente | UseGuards(TenantCredentialGuard,TenantAccessGuard) | [apps/api/src/modules/checkout-settings/presentation/http/checkout-settings.controller.ts:119](<../../../../../apps/api/src/modules/checkout-settings/presentation/http/checkout-settings.controller.ts#L119>) |
| PUT /checkout-settings | Alcançável estaticamente | UseGuards(TenantCredentialGuard,TenantAccessGuard); Idempotent() | [apps/api/src/modules/checkout-settings/presentation/http/checkout-settings.controller.ts:146](<../../../../../apps/api/src/modules/checkout-settings/presentation/http/checkout-settings.controller.ts#L146>) |
| POST /checkout-settings/reset | Alcançável estaticamente | UseGuards(TenantCredentialGuard,TenantAccessGuard); Idempotent() | [apps/api/src/modules/checkout-settings/presentation/http/checkout-settings.controller.ts:188](<../../../../../apps/api/src/modules/checkout-settings/presentation/http/checkout-settings.controller.ts#L188>) |
| GET /checkout-settings/context | Alcançável estaticamente | UseGuards(TenantCredentialGuard,TenantAccessGuard) | [apps/api/src/modules/checkout-settings/presentation/http/checkout-settings.controller.ts:224](<../../../../../apps/api/src/modules/checkout-settings/presentation/http/checkout-settings.controller.ts#L224>) |

/v1 é removido pelo middleware de versionamento antes do roteamento; o prefixo não ativa um controller ausente nem contorna NonProductionRoute. Paths listados são declarações estáticas; boot Nest e colisões precisam de smoke.



## Reavaliação

Executar o gate específico, os critérios dos achados e testes relevantes da [sequência de correções](<../PLANO-DE-CORRECAO.md>). Guardar commit, configuração não secreta, comandos, resultado e evidência de banco/provedor. A auditoria atual não realizou essas correções.
