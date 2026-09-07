# Correção de slug público e domínio da loja

## Alteração entregue localmente

- `Merchant.storeSlug` é a chave pública única e indexada; o valor permanece em `storeSettings.slug` enquanto houver consumidores desse JSON.
- Cadastro por senha e OAuth escolhem e gravam o slug durante a criação do merchant. A constraint é a garantia final contra corrida; o cadastro tenta outro sufixo quando há colisão.
- Atualização manual normaliza o slug e responde `409 slug_already_taken` se a constraint for atingida.
- Storefront resolve slug por consulta indexada. Domínio customizado só resolve quando a entrada de `MerchantDomain` está verificada.
- O atalho do dashboard usa o domínio verificado, se houver; sem ele, usa `/store/<slug>`. Ele não usa mais o ID interno do merchant.
- Os endpoints públicos de índice, histórias, logo e cupons saíram do acesso direto ao Prisma no controller e passaram por `GetPublicStoreResourcesUseCase`, usando portas de merchant, histórias e cupons.
- Telemetria de conversa, experimento e sessões ativas do funil também saíram de `StorefrontController`: ele chama `TrackStorefrontEventUseCase` e `GetStorefrontLiveSessionsUseCase`, que dependem de `STOREFRONT_TELEMETRY_PORT`; `PrismaStorefrontTelemetryRepository` é o único adaptador desse fluxo que conhece Prisma.
- `GetStoreConfigUseCase` passou a depender de `STOREFRONT_CONFIG_QUERY_PORT`. A resolução indexada de slug e o domínio verificado, assinatura, regra do agente, respostas rápidas e histórias estão encapsulados em `PrismaStorefrontConfigQueryRepository`.

## Gate obrigatório de banco

Antes de aplicar `20260907140000_merchant_store_slug`, validar dados da cópia de produção:

```sql
SELECT store_settings ->> 'slug' AS slug, COUNT(*)
FROM merchants
WHERE NULLIF(store_settings ->> 'slug', '') IS NOT NULL
GROUP BY store_settings ->> 'slug'
HAVING COUNT(*) > 1;
```

O resultado precisa estar vazio. A migração não escolhe silenciosamente um vencedor entre lojas duplicadas. Depois do deploy, confirmar que um cadastro concorrente não cria duas lojas com o mesmo slug e que a URL pelo domínio verificado abre a mesma loja da URL `/store/<slug>`.

## Validação local executada

- `pnpm --filter @zyon/api prisma:generate`
- `pnpm --filter @zyon/api exec tsc -p tsconfig.json --noEmit`
- `pnpm --filter @zyon/dashboard typecheck`
- testes focados de cadastro e recursos públicos do storefront: 7 aprovados.
- testes focados de telemetria, sessões e escopo administrativo do storefront: 8 aprovados.
- `pnpm --filter @zyon/api exec nest build`
- testes focados de configuração pública, slug e domínio verificado: 4 aprovados.

## Limite arquitetural restante

`StorefrontController` e `GetStoreConfigUseCase` não acessam Prisma. O módulo ainda não pode ser considerado completamente conforme DDD porque `GetStorefrontFunnelUseCase` e alguns casos de uso de marketplace continuam recebendo Prisma diretamente. Eles exigem extração gradual para portas, com testes de contrato, sem misturar esse refactor com a migração de slug.
