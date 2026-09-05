# ADR — API / domains

Data: 2026-09-05. Status: decisão de auditoria registrada; correções propostas. Veredito: **CONDITIONAL**.

[Índice geral](<../README.md>) · [API primeiro](<README.md>) · [Evidências e limites](<../VALIDACAO.md>)

## Contexto e responsabilidade

Cadastrar, verificar e remover domínios personalizados da loja.

Inventário: 6 arquivos de implementação, 0 arquivos reconhecidos como testes, 337 linhas de implementação. 5 declarações HTTP; 5 alcançáveis pela composição estática. Contagem de testes não é cobertura de branches nem execução comprovada.

## Boundary, dependências e ownership

Imports intermodulares observados: **auth**. A lista inclui referências de tipo e é evidência de acoplamento de código, não de todas as dependências em runtime.

Acessos Prisma reconhecidos pelo extrator: `merchant`, `merchantDomain`. Nomes são modelos acessados, não prova de ownership; casts e SQL bruto podem exigir leitura adicional.

Evidência estática não prova DNS/TLS emitido, renovação, remoção segura ou exclusividade global. Zero arquivos de teste de domínio identificados; chamadas externas precisam timeout e retry controlado.

| Coesão | Controle do acoplamento | Boundary | Ownership dos dados | Prontidão |
| --- | --- | --- | --- | --- |
| 7/10 | 6/10 | 6/10 | 6/10 | 4/10 |

Notas são avaliação técnica qualitativa do código inspecionado, não métricas de carga nem garantia de segurança. Zero em knowledge-base significa ausência de evidência, não reprovação de código inexistente.

## Controles observados

Fluxo verifica tenant, resolução CNAME e estado verificado antes de configuração de domínio.

## God services, SOLID, KISS e DRY

| Classe inspecionável | Linhas da classe | Dependências no construtor | Fonte |
| --- | --- | --- | --- |
| DomainsController | 51 | 4 | [apps/api/src/modules/domains/presentation/http/domains.controller.ts:25](<../../../../../apps/api/src/modules/domains/presentation/http/domains.controller.ts#L25>) |
| RegisterDomainUseCase | 42 | 1 | [apps/api/src/modules/domains/application/use-cases/register-domain.use-case.ts:22](<../../../../../apps/api/src/modules/domains/application/use-cases/register-domain.use-case.ts#L22>) |
| VerifyDomainUseCase | 35 | 2 | [apps/api/src/modules/domains/application/use-cases/verify-domain.use-case.ts:22](<../../../../../apps/api/src/modules/domains/application/use-cases/verify-domain.use-case.ts#L22>) |

Não há candidato acima de 300 linhas/10 dependências entre as classes listadas. Isso não certifica SRP/LSP/ISP; contratos e comportamentos substituíveis precisam dos testes descritos.

DIP/boundary: revisar os imports acima e os acessos a dados com a matriz global. DRY: compartilhar contratos e política de unidade/estado, preservando regra no módulo dono. KISS/object calisthenics são critérios de legibilidade; não justificam fragmentar métodos mecanicamente ou criar microserviços.

## Transações, concorrência, segurança e resiliência

Nenhum P0/P1 específico foi confirmado na amostra deste módulo. O estado permanece CONDITIONAL por falta de prova de runtime, carga e recuperação.

Performance/índices: consultar [matriz de schema e operação](<../BANCO-E-OPERACAO.md>). Planos reais, pool, memória, CPU, cache distribuído e volume de 10.000 usuários: **REQUIRES LOAD VALIDATION**.

Observabilidade: Logger/CorrelationId e infraestrutura comum existem, mas dashboards/alertas e correlação ponta a ponta deste módulo são **INFRA VALIDATION REQUIRED**. Segurança externa, segredos configurados e recuperação de backup não foram inspecionados no ambiente produtivo.

## Decisão e consequências

1. Preservar o monólito modular e atribuir ao módulo somente sua capacidade descrita.
2. Corrigir os achados vinculados antes de habilitar/liberar os fluxos afetados.
3. Expor comunicação por portas/facades e eventos versionados; acesso direto a outro agregado deve ser substituído gradualmente.
4. Validar em banco/servidor real os cenários do gate; nenhum PASS de produção é inferido da existência de testes.

Gate específico: **Domínio já usado, takeover após remoção, challenge, emissão/renovação TLS e rollback em staging.**

Consequência: o módulo poderá ser reavaliado isoladamente após a correção, mas a liberação depende dos gates compartilhados de autenticação, tenant, persistência, build e mensageria.

## Superfície HTTP observada

| Método/path normalizado | Composição | Metadata extraída | Evidência |
| --- | --- | --- | --- |
| GET /merchants/me/domains | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/domains/presentation/http/domains.controller.ts:35](<../../../../../apps/api/src/modules/domains/presentation/http/domains.controller.ts#L35>) |
| POST /merchants/me/domains | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/domains/presentation/http/domains.controller.ts:40](<../../../../../apps/api/src/modules/domains/presentation/http/domains.controller.ts#L40>) |
| POST /merchants/me/domains/:domainId/verify | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/domains/presentation/http/domains.controller.ts:51](<../../../../../apps/api/src/modules/domains/presentation/http/domains.controller.ts#L51>) |
| DELETE /merchants/me/domains/:domainId | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/domains/presentation/http/domains.controller.ts:62](<../../../../../apps/api/src/modules/domains/presentation/http/domains.controller.ts#L62>) |
| GET /domains/check | Alcançável estaticamente | Sem metadata de guard extraída; verificar guards globais/método | [apps/api/src/modules/domains/presentation/http/domains.controller.ts:86](<../../../../../apps/api/src/modules/domains/presentation/http/domains.controller.ts#L86>) |

/v1 é removido pelo middleware de versionamento antes do roteamento; o prefixo não ativa um controller ausente nem contorna NonProductionRoute. Paths listados são declarações estáticas; boot Nest e colisões precisam de smoke.



## Reavaliação

Executar o gate específico, os critérios dos achados e testes relevantes da [sequência de correções](<../PLANO-DE-CORRECAO.md>). Guardar commit, configuração não secreta, comandos, resultado e evidência de banco/provedor. A auditoria atual não realizou essas correções.
