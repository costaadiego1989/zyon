# Reavaliação API-036 — Composição da API pública

## Resultado

O achado original estava desatualizado após a integração em `master`. `AppModule` importa `PublicApiModule`, `AgenticProtocolModule` e `UcpDiscoveryModule`. Por sua vez, `PublicApiModule` agrega os 26 submódulos versionados de domínio, cada qual registrando seu controller.

Não houve exposição adicional de rota nesta etapa: a composição já existe no código atual. A API pública mantém os guards declarados por controller e os guards específicos de ACP/UCP.

## Evidência local

- composição estática revisada em `AppModule`, `PublicApiModule` e nos submódulos públicos;
- `pnpm --filter @zyon/api build` aprovou com toda a composição carregada.

## Gate de produção

Executar smoke autenticado contra a URL implantada, cobrindo rota de leitura, mutação idempotente, paginação e retorno de erro para credencial ausente ou inválida. Isso confirma boot Nest, configuração de credenciais e rotas no ambiente, aspectos que build estático não prova.
