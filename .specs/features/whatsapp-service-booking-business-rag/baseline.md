# Complete Implementation Baseline

**Task**: T1
**Date**: 2026-11-14
**Implementation root**: `C:/tmp/zyon-whatsapp-final-prod-20261028`

## Assumptions and Boundaries

Fonte API é a revisão `7229739c7b0da6bbe8da9a7746090e48ae81a7e7`. O checkout não continha frontend. Adicionamos somente as árvores Git rastreadas `apps/dashboard`, `apps/storefront` e `apps/widget_v2` da revisão limpa `f1037635e38cb4d2e606b29eb73e5a74786a645b` em `C:/tmp/zyon-whatsapp-checkout-widget-20261105`.

O widget dessa fonte tem evidência histórica de publicação no relatório `.audit/whatsapp-checkout-native-20261105/final-report.md` do workspace principal. Isto não é verificação live. Dashboard/storefront importados são baseline local de código, não alegação de versão atualmente servida. O principal em `ce5fa9505148fb20bbc5e707a7f8197669ecb088` tem alterações concorrentes e não foi copiado ou modificado.

## Files and Verification

- Importar somente os três frontends rastreados, com `capture-baseline.py`; excluir `.env*`, `.vercel`, dependências, builds, relatórios e qualquer estado de deploy.
- `baseline-manifest.json` registra SHA-256 e tamanho de cada arquivo, origem e revisão. O script valida bytes de destino e recusa sobrescrever conteúdo divergente.
- `packages/checkout-ui` e `packages/platform-support-ui` têm Git trees idênticas nas duas revisões e são reutilizados sem cópia. `shared-types` continua o da API atual; compatibilidade será verificada com typecheck, sem retroceder tipos para a revisão antiga do widget.
- API, packages, lockfile, package.json e configs de workspace atuais são preservados. Os importers dos três frontends já estão no lockfile e usam as mesmas dependências dessa fonte; overrides de tipos do workspace explicam os specifiers normalizados.
- Nenhum arquivo do workspace concorrente, banco, segredo, build publicado ou provedor é fonte de mutação.

## Existing Commands

API usa `pnpm --dir apps/api test:baseline-gates`, Node test runner com guard/loader e os owned runtimes PostgreSQL/Redis. Dashboard usa Vitest, Playwright, typecheck e build. Storefront/widget usam typecheck/build e Playwright. A baseline inclui os scripts adicionais de regressão de storefront da fonte congelada; não substituímos esses scripts pelos manifests mais simples do workspace concorrente.

T1 é gate documental: verificação dos manifestos e `git diff --check`. Não se inventa teste unitário para importar código inalterado. T2/T3 provarão runtime/API/browser local, e a próxima tarefa que muda schema tem Build obrigatório. Falhas preexistentes serão documentadas antes de qualquer alteração de expectativa.

## Gate Result

PASS: 1.259 arquivos, 9.833.191 bytes, todos copiados de Git da revisão limpa e verificados contra seus hashes. Nenhum arquivo de segredo/deploy/dependência foi importado. API/packages/lock/configs preservados sem diff. Os importers dos frontends já existentes foram aceitos por `pnpm install --offline --frozen-lockfile --ignore-scripts`: “Lockfile is up to date, resolution step is skipped”. Não houve resolução nova ou download.

O linking local de dependências foi interrompido após adicionar parte das 59 dependências frontend, para não concorrer com o gate de baseline executado pelo orquestrador. O linking completo será retomado após esse gate e antes de T2/T3; não é apresentado como build ou teste aprovado. O source importado é inalterado. `git diff --check` e validação do manifesto compõem o gate documental T1.

Um artefato de memória com nome Windows malformado, indevidamente rastreado dentro de `apps/dashboard`, foi excluído da curadoria, sem acessar ou alterar a memória real. A lista de exclusão consta do manifesto. Por isso a seleção final contém 1.259 arquivos. Metadados novos usam LF e passam `git diff --cached --check` restrito à feature. O source congelado contém 33 linhas de diagnóstico de whitespace quando apresentado ao Git como adição inteira; nenhum whitespace novo foi introduzido, conforme os 1.259 hashes exatos. Não reformatamos a fonte aprovada. Esse diagnóstico legado não é omitido nem apresentado como gate de build aprovado.
