# Revenue Intelligence — migrations de implantação

Vigésima terceira entrega local. `apps/api/prisma.config.ts` usa `prisma/deploy-migrations`; as migrations da evolução semanal estavam apenas em `prisma/migrations` e não seriam aplicadas pelo comando de publicação.

Foram copiadas, sem alteração de conteúdo, as 15 migrations de `20260924180000_revenue_weekly_foundation` até `20260925050000_strategy_ai_budget` para a pasta efetivamente utilizada. Também foi incluída `20260914120000_negotiation_offer_replay`: a coluna `applied_offer_json`, já exigida pelo código de checkout, faltava na cadeia de implantação. Nenhuma migration já existente foi reescrita.

## Ensaio local

Banco descartável `revenue_release_0928`, PostgreSQL em `127.0.0.1:5557`, sem acesso à produção:

- O comando real `node scripts/predeploy-migrations.mjs` aplicou a cadeia inicial de 49 migrations em banco vazio, com saída zero.
- O mesmo comando aplicou a migration adicional de negociação; a cadeia passou a ter 50 migrations.
- Repetir o comando terminou com `No pending migrations to apply`, saída zero.
- As 15 cópias de Revenue Intelligence tiveram hashes comparados ao arquivo original. A dependência adicional também é uma cópia literal.
- Os oito testes de acompanhamento automático e os dois cenários de despacho corrigidos passaram neste banco, usando o cliente Prisma isolado. A fila foi validada separadamente em Redis local.

Logs locais: `.audit/revenue-weekly/revenue-release-migrations.log`, `revenue-release-migrations-final.log`, `revenue-release-migrations-idempotent.log` e `strategy-monitor-final.log`.

## Diferenças preexistentes e limite da evidência

O diff global do banco recém-criado identificou diferenças anteriores em outras áreas: FK de consentimento de memória de intenção, defaults de preferência de frete, nomes de índices, defaults/relacionamentos de conteúdo de produto e outros defaults. A ausência de `applied_offer_json` foi corrigida por ser dependência direta do checkout. As demais diferenças não foram aplicadas em massa. A migration antiga da FK de consentimento contém exclusão de registros órfãos e exige uma avaliação própria antes da publicação.

O ensaio comprova aplicação e repetição da cadeia local, não equivalência completa de todos os módulos nem compatibilidade já inspecionada com o banco de produção. Publicação exige verificar o histórico real de migrations, as diferenças registradas e os requisitos de configuração. Nenhum deploy, merge, push ou ativação foi realizado.
