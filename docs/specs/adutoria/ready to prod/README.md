# ADRs de auditoria — Ready to Prod

**Decisão: NO-GO. API: F — CRITICAL. Dashboard, storefront e widget_v2: FAIL.**

**Implementação iniciada:** a branch isolada `fix/ready-to-prod-audit` contém o primeiro lote de correções da API. Consulte [estado das correções, testes e pendências](CORRECOES.md). O parecer de produção continua NO-GO.

Auditoria original de 2026-09-05, sobre a árvore de trabalho modificada do commit base `dcb8150aae34b8284178d9d257e4ac174654d965`. A API foi a primeira etapa; depois seus contratos foram cruzados com os três fronts. Na etapa de auditoria nenhum código de aplicação foi corrigido e nenhuma implantação/transação externa foi executada. Os ADRs e manifests originais preservam esse retrato anterior aos patches; não representam os hashes atuais da branch de correção.

O pacote registra **68 achados: 11 P0, 41 P1 e 16 P2**, com arquivo/linha, evidência, impacto, causa, recomendação, risco e critério de aceite. Não foram adicionados P3/P4 para preencher categorias. Severidade descreve impacto; confirmação estática, reprodução local e validação ainda ausente estão separadas.

## Ordem de leitura

1. [API — índice dos módulos](api/README.md): 42 módulos com TypeScript, knowledge-base sem implementação ativa e infraestrutura compartilhada, total de 44 ADRs.
2. [Dashboard](dashboard/ADR-dashboard.md): relatório do app e 27 ADRs de módulos/infraestrutura do front.
3. [Storefront](storefront/ADR-storefront.md): relatório e nove ADRs de capacidades.
4. [Widget v2](widget_v2/ADR-widget_v2.md): relatório e oito ADRs de capacidades.
5. [Contratos cruzados](CONTRATOS.md), [plano de correção](PLANO-DE-CORRECAO.md) e [validação executada](VALIDACAO.md).

## Bloqueadores P0

| ID | Módulo | Defeito |
| --- | --- | --- |
| [API-001](<api/ADR-api-catalog.md#api-001>) | catalog | Reserva e mídia permitem operar recursos de outra loja |
| [API-002](<api/ADR-api-catalog.md#api-002>) | catalog | Reserva concorrente pode ultrapassar estoque disponível |
| [API-003](<api/ADR-api-stories.md#api-003>) | stories | Atualização e arquivamento ignoram o tenant recebido |
| [API-004](<api/ADR-api-storefront.md#api-004>) | storefront | WebSocket aceita salas de conversa sem autenticação ou vínculo |
| [API-005](<api/ADR-api-storefront.md#api-005>) | storefront | Flag de legado expõe consultas e mutações administrativas sem autenticação |
| [API-006](<api/ADR-api-marketplace.md#api-006>) | marketplace | Chargeback administrativo não recebe nem valida a loja |
| [API-007](<api/ADR-api-returns.md#api-007>) | returns | Reembolso é declarado concluído sem devolver dinheiro |
| [API-008](<api/ADR-api-marketplace.md#api-008>) | marketplace | Job marca transferência como realizada sem provedor |
| [API-041](<api/ADR-api-support.md#api-041>) | support | Gateway permite ouvir tickets e enviar mensagens como merchant sem autenticação |
| [API-042](<api/ADR-api-checkout.md#api-042>) | checkout | E-mail conhecido é tratado como prova de identidade do comprador |
| [API-043](<api/ADR-api-checkout.md#api-043>) | checkout | Preço e frete iniciais podem vir do cliente sem revalidação de catálogo |

As exposições dependentes de ENABLE_LEGACY_ROUTES e configuração de serviço estão identificadas no próprio achado. A auditoria não consultou segredos/flags efetivos de produção nem demonstrou exploração em ambiente externo.

## Resultado dos controles executados

| Controle | Resultado |
| --- | --- |
| Inventário | 1.942 fontes nos quatro apps; 538 handlers declarados, 402 alcançáveis em composição estática; 281 call sites dos fronts. |
| Typecheck API | FAIL: minimatch ausente; diagnóstico com types node também falha por Prisma Client local sem tipos válidos e erros adicionais. |
| Typecheck dashboard | FAIL: cinco TS2345 por etapas de onboarding incompatíveis. |
| Typecheck storefront / widget_v2 | PASS em ambos; isso não certifica contrato nem build/deploy. |
| Testes JWT existentes | 8 passaram. |
| Seleção de testes de domínio API | 81 passaram e 5 falharam, incluindo uma suíte impedida por shipping-engine/dist ausente. |
| Testes dashboard | 415 passaram e 33 falharam; executados com configLoader runner. |
| Reproduções de defeitos | 6/6 confirmaram comportamentos defeituosos; testes passam porque caracterizam os bugs. |
| Dependências runtime | 78 ocorrências do registry: 35 high, 39 moderate, 4 low; explorabilidade não certificada. |
| E2E / banco / provedores / carga / restore | UNVERIFIED; não executados. |

## Escopo e confiança

É uma revisão estática ampla, por módulo, com reproduções e checagens locais. Todos os diretórios solicitados têm inventário e decisão; não representa leitura exaustiva de cada linha, pentest completo ou certificação de produção. Campos não comprovados foram registrados como UNVERIFIED, REQUIRES LOAD VALIDATION ou INFRA VALIDATION REQUIRED. O roteiro anexado de 90 seções está rastreado em [COBERTURA-DO-ROTEIRO.md](COBERTURA-DO-ROTEIRO.md).

A árvore já tinha alterações extensas antes da auditoria. O manifesto guarda hashes dos arquivos lidos e verificou ausência de mudança nas 1.942 fontes durante esta execução. ADRs antigos/comentários “fix” não foram aceitos como prova de correção sem confrontar o código.

## Documentos de apoio

- [Arquitetura e dez regras do monólito modular](ARQUITETURA.md).
- [Decisão BullMQ/RabbitMQ](ADR-ASYNC.md): KEEP BULLMQ, corrigindo garantias de entrega e consumers.
- [Banco e operação](BANCO-E-OPERACAO.md): baseline ativa contempla 118 modelos, aplicação real não validada.
- [Top 10 por categoria de risco](TOP-10-RISCOS.md).
- [Matriz de prontidão](MATRIZ-READY-TO-PROD.md).
- [Índice de todos os achados](ACHADOS.md).
- [Evidências reproduzíveis](evidence/README.md).

A próxima etapa é corrigir os achados na ordem proposta e reavaliar cada módulo com os critérios registrados. Os ADRs documentam a decisão técnica desta auditoria; não representam aceite de risco ou aprovação de produção pelo responsável do sistema.
