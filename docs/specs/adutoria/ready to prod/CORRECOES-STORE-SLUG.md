# Correção de slug público e domínio da loja

## Alteração entregue localmente

- `Merchant.storeSlug` é a chave pública única e indexada; o valor permanece em `storeSettings.slug` enquanto houver consumidores desse JSON.
- Cadastro por senha e OAuth escolhem e gravam o slug durante a criação do merchant. A constraint é a garantia final contra corrida; o cadastro tenta outro sufixo quando há colisão.
- Atualização manual normaliza o slug e responde `409 slug_already_taken` se a constraint for atingida.
- Storefront resolve slug por consulta indexada. Domínio customizado só resolve quando a entrada de `MerchantDomain` está verificada.
- O atalho do dashboard usa o domínio verificado, se houver; sem ele, usa `/store/<slug>`. Ele não usa mais o ID interno do merchant.
- Os endpoints públicos de índice, histórias, logo e cupons saíram do acesso direto ao Prisma no controller e passaram por `GetPublicStoreResourcesUseCase`, usando portas de merchant, histórias e cupons.

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

## Limite arquitetural restante

`StorefrontController` ainda contém acessos legados ao Prisma para telemetria de conversa, experimento e sessões do funil. Estes fluxos não foram movidos nesta alteração para não alterar a semântica da coleta ativa; devem ser extraídos para casos de uso e portas próprios antes de considerar o boundary de storefront em conformidade completa com DDD.
