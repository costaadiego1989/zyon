# ADR — API / merchant

Data: 2026-09-05. Status: decisão de auditoria registrada; correções propostas. Veredito: **FAIL**.

[Índice geral](<../README.md>) · [API primeiro](<README.md>) · [Evidências e limites](<../VALIDACAO.md>)

## Contexto e responsabilidade

Perfil da loja, regras, branding e configuração comercial.

Inventário: 17 arquivos de implementação, 4 arquivos reconhecidos como testes, 1279 linhas de implementação. 12 declarações HTTP; 12 alcançáveis pela composição estática. Contagem de testes não é cobertura de branches nem execução comprovada.

## Boundary, dependências e ownership

Imports intermodulares observados: **auth, payment**. A lista inclui referências de tipo e é evidência de acoplamento de código, não de todas as dependências em runtime.

Acessos Prisma reconhecidos pelo extrator: `agentRule`, `merchant`, `merchantRule`. Nomes são modelos acessados, não prova de ownership; casts e SQL bruto podem exigir leitura adicional.

Módulo acumula configurações de loja, pagamentos, domínio e cross-sell. Caminhos duplicados de store settings e geração de conteúdo exigem uma porta única de escrita para evitar regras inconsistentes.

| Coesão | Controle do acoplamento | Boundary | Ownership dos dados | Prontidão |
| --- | --- | --- | --- | --- |
| 5/10 | 4/10 | 5/10 | 6/10 | 4/10 |

Notas são avaliação técnica qualitativa do código inspecionado, não métricas de carga nem garantia de segurança. Zero em knowledge-base significa ausência de evidência, não reprovação de código inexistente.

## Controles observados

Defaults/conversores delimitam campos do perfil e regras; autenticação e derivação de tenant nas rotas me.

## God services, SOLID, KISS e DRY

| Classe inspecionável | Linhas da classe | Dependências no construtor | Fonte |
| --- | --- | --- | --- |
| MerchantController | 252 | 7 | [apps/api/src/modules/merchant/presentation/merchant.controller.ts:26](<../../../../../apps/api/src/modules/merchant/presentation/merchant.controller.ts#L26>) |
| PrismaMerchantRepository | 102 | 1 | [apps/api/src/modules/merchant/infrastructure/prisma-merchant.repository.ts:10](<../../../../../apps/api/src/modules/merchant/infrastructure/prisma-merchant.repository.ts#L10>) |
| UpdateMerchantRulesDto | 84 | 0 | [apps/api/src/modules/merchant/presentation/dto/update-merchant-rules.dto.ts:43](<../../../../../apps/api/src/modules/merchant/presentation/dto/update-merchant-rules.dto.ts#L43>) |

Não há candidato acima de 300 linhas/10 dependências entre as classes listadas. Isso não certifica SRP/LSP/ISP; contratos e comportamentos substituíveis precisam dos testes descritos.

DIP/boundary: revisar os imports acima e os acessos a dados com a matriz global. DRY: compartilhar contratos e política de unidade/estado, preservando regra no módulo dono. KISS/object calisthenics são critérios de legibilidade; não justificam fragmentar métodos mecanicamente ou criar microserviços.

## Transações, concorrência, segurança e resiliência

- [API-031](<ADR-api-store-settings.md#api-031>) (P2): Unicidade do slug depende de consulta sem constraint.
- [API-011](<ADR-api-team.md#api-011>) (P1): Papéis e remoção de membro não chegam ao principal de autenticação.
- [DASH-005](<../dashboard/ADR-dashboard.md#dash-005>) (P2): Salvar configurações busca ETag novo e pode sobrescrever edição concorrente.

Performance/índices: consultar [matriz de schema e operação](<../BANCO-E-OPERACAO.md>). Planos reais, pool, memória, CPU, cache distribuído e volume de 10.000 usuários: **REQUIRES LOAD VALIDATION**.

Observabilidade: Logger/CorrelationId e infraestrutura comum existem, mas dashboards/alertas e correlação ponta a ponta deste módulo são **INFRA VALIDATION REQUIRED**. Segurança externa, segredos configurados e recuperação de backup não foram inspecionados no ambiente produtivo.

## Decisão e consequências

1. Preservar o monólito modular e atribuir ao módulo somente sua capacidade descrita.
2. Corrigir os achados vinculados antes de habilitar/liberar os fluxos afetados.
3. Expor comunicação por portas/facades e eventos versionados; acesso direto a outro agregado deve ser substituído gradualmente.
4. Validar em banco/servidor real os cenários do gate; nenhum PASS de produção é inferido da existência de testes.

Gate específico: **Atualizações concorrentes de regras/branding, whitelist de campos e isolamento de credenciais devem ser verificados por rota.**

Consequência: o módulo poderá ser reavaliado isoladamente após a correção, mas a liberação depende dos gates compartilhados de autenticação, tenant, persistência, build e mensageria.

## Superfície HTTP observada

| Método/path normalizado | Composição | Metadata extraída | Evidência |
| --- | --- | --- | --- |
| POST /merchants/me/crypto-payments/enable | Alcançável estaticamente | UseGuards(AuthGuard); UseGuards(PlanLimitGuard) | [apps/api/src/modules/merchant/presentation/http/crypto-payments.controller.ts:33](<../../../../../apps/api/src/modules/merchant/presentation/http/crypto-payments.controller.ts#L33>) |
| GET /merchants/me | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/merchant/presentation/merchant.controller.ts:40](<../../../../../apps/api/src/modules/merchant/presentation/merchant.controller.ts#L40>) |
| GET /merchants/me/rules | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/merchant/presentation/merchant.controller.ts:66](<../../../../../apps/api/src/modules/merchant/presentation/merchant.controller.ts#L66>) |
| PUT /merchants/me/rules | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/merchant/presentation/merchant.controller.ts:91](<../../../../../apps/api/src/modules/merchant/presentation/merchant.controller.ts#L91>) |
| GET /merchants/me/theme | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/merchant/presentation/merchant.controller.ts:117](<../../../../../apps/api/src/modules/merchant/presentation/merchant.controller.ts#L117>) |
| PUT /merchants/me/theme | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/merchant/presentation/merchant.controller.ts:135](<../../../../../apps/api/src/modules/merchant/presentation/merchant.controller.ts#L135>) |
| POST /merchants/me/logo | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/merchant/presentation/merchant.controller.ts:157](<../../../../../apps/api/src/modules/merchant/presentation/merchant.controller.ts#L157>) |
| PUT /merchants/me/store-category | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/merchant/presentation/merchant.controller.ts:173](<../../../../../apps/api/src/modules/merchant/presentation/merchant.controller.ts#L173>) |
| GET /merchants/me/store-settings | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/merchant/presentation/merchant.controller.ts:181](<../../../../../apps/api/src/modules/merchant/presentation/merchant.controller.ts#L181>) |
| PUT /merchants/me/name | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/merchant/presentation/merchant.controller.ts:186](<../../../../../apps/api/src/modules/merchant/presentation/merchant.controller.ts#L186>) |
| PUT /merchants/me/store-settings | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/merchant/presentation/merchant.controller.ts:198](<../../../../../apps/api/src/modules/merchant/presentation/merchant.controller.ts#L198>) |
| POST /merchants/me/generate-policy | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/merchant/presentation/merchant.controller.ts:206](<../../../../../apps/api/src/modules/merchant/presentation/merchant.controller.ts#L206>) |

/v1 é removido pelo middleware de versionamento antes do roteamento; o prefixo não ativa um controller ausente nem contorna NonProductionRoute. Paths listados são declarações estáticas; boot Nest e colisões precisam de smoke.



## Reavaliação

Executar o gate específico, os critérios dos achados e testes relevantes da [sequência de correções](<../PLANO-DE-CORRECAO.md>). Guardar commit, configuração não secreta, comandos, resultado e evidência de banco/provedor. A auditoria atual não realizou essas correções.
