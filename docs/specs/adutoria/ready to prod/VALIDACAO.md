# Validação executada e limites

Data: 2026-09-05. Windows/PowerShell, Node v22.20.0. Comandos foram executados sobre árvore já modificada. Nenhum banco real foi migrado, nenhum pagamento/estorno externo foi feito e nenhum segredo real foi impresso.

## Resultados

| Comando/controle | Resultado | Interpretação |
| --- | --- | --- |
| pnpm.cmd --filter @zyon/api exec tsc -p tsconfig.json --noEmit | FAIL | TS2688: implicit type minimatch ausente. Gate padrão não passou. |
| Mesmo comando com --types node (diagnóstico) | FAIL | Contorna só a descoberta implícita para diagnosticar: Prisma Client local sem InputJsonValue/model types e outros erros. Não substitui comando oficial nem identifica sozinho defeito de produção. |
| pnpm.cmd --filter @zyon/dashboard exec tsc -p tsconfig.json --noEmit | FAIL | Cinco TS2345 relacionados a embed/publish nos hooks de onboarding. |
| pnpm.cmd --filter @zyon/storefront exec tsc --noEmit --incremental false | PASS | Exit 0. Não executa build Next nem browser. |
| pnpm.cmd --filter @zyon/widget-v2 exec tsc --noEmit | PASS | Exit 0. Casts de payload permitem que contratos errados compilem. |
| API JWT via loader isolado | 8 PASS | Testes existentes; não cobrem o replay de refresh identificado. |
| 16 arquivos selecionados de domínio/guard API via loader | 81 PASS / 5 FAIL | 4 assertions falharam (coupon, plan limit e dois billing); uma suíte de shipping não carregou por dist ausente. |
| pnpm.cmd --filter @zyon/dashboard exec vitest run | Não iniciou a suíte | esbuild: acesso negado ao resolver vitest.config.ts. |
| pnpm.cmd --filter @zyon/dashboard exec vitest run --configLoader runner | 415 PASS / 33 FAIL | 22 arquivos: 16 passaram, 6 falharam. Falhas incluem expectativas de texto/estrutura, fixtures e data; requer triagem, não 33 bugs de produção presumidos. |
| Seis reproduções locais | 6 PASS caracterizando bugs | Mocks de fetch/repositório e um servidor loopback, sem usar serviços externos. |
| pnpm.cmd audit --prod --json | Exit 1 | Registry reportou 78 ocorrências em 768 dependências, 35 high, 39 moderate, 4 low. Sem critical reportado não significa sistema seguro. |
| Grafo, contratos, schema, hashes | Extração estática concluída | 1942 fontes; 538 declarações/402 alcançáveis; 281 calls; 118 modelos; baseline ativa com DDL de todos. |
| Build dos quatro apps, E2E, carga, crash real, migration/restore | UNVERIFIED | Não executados; API/dashboard já têm gate de tipos falhando e ambiente não forneceu infraestrutura isolada completa. |

Os testes de API selecionados abrangem agent-rules, coupons, negotiation, payment, shipping e NonProductionRoute. O loader transpila TS sem typecheck nem metadata DI e instancia diretamente classes; **não é teste do container Nest**, não substitui build e não valida Prisma/transactions reais. `--test-force-exit` evita que o timer de blacklist mantenha a execução viva; esse encerramento não valida graceful shutdown.

## Reproduções

| Caso | Comportamento confirmado | Achado |
| --- | --- | --- |
| R01 | O mesmo JWT já expirado renova duas vezes dentro da grace window | [API-009](<api/ADR-api-auth.md#api-009>) |
| R02 | fetch rejeita Agent nativo porque não possui dispatch | [API-018](<api/ADR-api-integrations.md#api-018>) |
| R03 | Snapshot real do payment intent não contém nomes esperados pelo widget | [W2-002](<widget_v2/ADR-widget_v2.md#w2-002>) |
| R04 | Client real do widget omite query session_id no status | [W2-003](<widget_v2/ADR-widget_v2.md#w2-003>) |
| R05 | Client real do widget transforma results de frete válidos em lista vazia | [W2-004](<widget_v2/ADR-widget_v2.md#w2-004>) |
| R06 | Use case marca refund COMPLETED e aplica valor fixo por quantidade | [API-007](<api/ADR-api-returns.md#api-007>) |

Reproduzir da raiz do repositório, sem .env/provedores:

```powershell
node --loader "./docs/specs/adutoria/ready to prod/evidence/ts-loader.mjs" --test --test-force-exit "./docs/specs/adutoria/ready to prod/evidence/reproductions.test.mjs"
```

Esses testes devem ser convertidos em testes de regressão com expectativa segura durante a correção. “PASS” aqui significa que o defeito foi reproduzido, não que foi resolvido.

## Evidências preservadas

Logs de tipos, JWT/domínio e reproduções; resumo de testes dashboard; lista de testes selecionados; manifesto de hashes; grafo de composição; calls/rotas; schema/DDL; resumo de advisories e achados estruturados estão em [evidence](evidence/README.md). Logs extensos e scripts temporários de extração permaneceram apenas durante a execução; o pacote contém evidência suficiente para revisar resultados e executar as seis reproduções.

## Limites de certificação

- Segurança foi revisão de código com cenários adversariais, não pentest completo ou acesso a produção.
- Concorrência de PostgreSQL, provider idempotency, CORS/cookies entre domínios, WebSocket e DI precisam testes de integração reais.
- Dependências: contagem do registry não é exploitability. Atualização requer compatibilidade e prova de alcançabilidade; não foi feita atualização automática.
- Arquivos .env e histórico de secrets não foram auditados; não existe declaração de ausência de credenciais vazadas.
- Performance não foi estimada como capacidade: EXPLAIN, profiling, pool, SLO e 10.000 usuários são REQUIRES LOAD VALIDATION.
- DNS/TLS, Redis persistence, migrations aplicadas, backup/restore e rollout são INFRA VALIDATION REQUIRED.

A conclusão NO-GO baseia-se em defeitos concretos, não apenas nos itens não executados.
