# Correções — dependências de produção

Data: 2026-09-07. Escopo: API, dashboard, storefront e widget_v2.

## API-039 — atualizações transitivas de baixo risco

O `pnpm audit --prod --json` foi executado contra o lockfile antes e depois da
mudança. As atualizações automáticas reduziram o relatório de 51 para 36
ocorrências altas e de 59 para 43 moderadas, sem introduzir versão principal
nova nos aplicativos.

Foram fixadas por `pnpm.overrides` as versões publicadas de `@grpc/grpc-js`,
`@opentelemetry/core`, `@babel/core`, `browserslist`, `fflate`, `postcss`,
`qs` e `undici`. O lockfile foi regenerado com `pnpm install --lockfile-only`
e instalado com `pnpm install --frozen-lockfile`.

Validação executada:

- `pnpm --filter @zyon/api build`
- `pnpm --filter @zyon/storefront typecheck`
- `pnpm --filter @zyon/dashboard typecheck`
- `pnpm --filter @zyon/widget-v2 typecheck`
- 14 testes focados de cross-sell

O gate continua aberto. Permanecem dependências que requerem uma atualização
coordenada e validação funcional: Nest/Multer/File Type, OpenTelemetry e
protobufjs, Vite, Next/Sharp, bibliotecas de IA, `ws`, `adm-zip`, `uuid`,
`nanoid` e cadeias antigas de `brace-expansion`. Nenhuma delas foi forçada por
override incompatível nesta etapa.

## Correções de build encontradas durante a validação

O build revelou e esta etapa corrigiu dois erros de compilação que impediam a
liberação do mesmo commit:

- o reexport de outbox do módulo commerce tinha um nível relativo a menos;
- o resolvedor de cross-sell já rejeitava catálogo ausente, mas o TypeScript
  não estreitava `product` e `variant` antes da resposta pública.

Essas correções não mudam preço, estoque, contrato HTTP ou fluxo de checkout.
