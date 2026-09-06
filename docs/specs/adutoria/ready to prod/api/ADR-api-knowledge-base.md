# ADR — API / knowledge-base

Data: 2026-09-05. Status: decisão de auditoria registrada; correções propostas. Veredito: **UNVERIFIED / CAPACIDADE NÃO IDENTIFICADA**.

[Índice geral](<../README.md>) · [API primeiro](<README.md>) · [Evidências e limites](<../VALIDACAO.md>)

## Contexto e responsabilidade

Diretório reservado a conhecimento do agente, sem fontes TypeScript no snapshot.

Nenhuma implementação TypeScript, controller ou provider identificado na estrutura atual; diretórios vazios não representam funcionalidade pronta.

## Boundary, dependências e ownership

Nenhum import intermodular TypeScript extraído neste diretório.

O extrator não reconheceu acessos Prisma diretos; isso não comprova ausência de persistência indireta/SQL.

UNVERIFIED como capacidade de negócio: não existe implementação ativa identificada para avaliar persistência, segurança ou integração. Não pontuar ausência como PASS.

| Coesão | Controle do acoplamento | Boundary | Ownership dos dados | Prontidão |
| --- | --- | --- | --- | --- |
| 0/10 | 0/10 | 0/10 | 0/10 | 0/10 |

Notas são avaliação técnica qualitativa do código inspecionado, não métricas de carga nem garantia de segurança. Zero em knowledge-base significa ausência de evidência, não reprovação de código inexistente.

## Controles observados

Somente estrutura de diretórios observada; não foi encontrado provider/controller TypeScript ativo.

## God services, SOLID, KISS e DRY

Sem classes para avaliar.

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

Gate específico: **Confirmar se foi removido ou ainda faz parte do produto; se requerido, especificar ingestão, recuperação tenant-scoped, atualização e expurgo antes de implementar.**

Consequência: o módulo poderá ser reavaliado isoladamente após a correção, mas a liberação depende dos gates compartilhados de autenticação, tenant, persistência, build e mensageria.

## Superfície HTTP observada

Nenhuma rota HTTP declarada; avaliar consumo interno, eventos/jobs ou ausência de wiring.

/v1 é removido pelo middleware de versionamento antes do roteamento; o prefixo não ativa um controller ausente nem contorna NonProductionRoute. Paths listados são declarações estáticas; boot Nest e colisões precisam de smoke.



## Reavaliação

Executar o gate específico, os critérios dos achados e testes relevantes da [sequência de correções](<../PLANO-DE-CORRECAO.md>). Guardar commit, configuração não secreta, comandos, resultado e evidência de banco/provedor. A auditoria atual não realizou essas correções.
