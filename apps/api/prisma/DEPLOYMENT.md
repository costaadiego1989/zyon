# Database deployment

`prisma.config.ts` uses `prisma/deploy-migrations` for new migrations and deployments.
The first migration preserves the original production baseline, including the
partial unique index that prevents concurrent negotiation offer application.
`20260905010000_master_schema_delta` adds the subsequent master schema changes.
Do not regenerate the baseline or change its checksum on an existing database.

The previous 51 migrations remain in `prisma/migrations` as historical reference.
That history cannot initialize an empty database: it omits roughly 40 tables and
contains a batch of `CREATE INDEX CONCURRENTLY` statements that Prisma cannot run.
Do not mix the two migration directories.

For a new, empty database, run:

```sh
pnpm --filter @zyon/api prisma:deploy
```

Railway runs `node scripts/predeploy-migrations.mjs` before deployment and checks
`/ready` before making the API available. The script reconciles the known failed
legacy checkout migration when its recorded error and existing table match, then
runs `prisma migrate deploy`. Docker Compose runs migrations before starting the API.

For an existing database, back it up and compare its schema with this baseline
before adopting the new history. After applying any reviewed reconciliation SQL,
mark `20260905000000_complete_schema` as applied with `prisma migrate resolve`.
Never reset an existing database or mark this baseline applied without checking
that its schema and custom constraints are already present.

Future changes should use `prisma migrate dev` with the existing config; commit
the resulting files in `prisma/deploy-migrations` with the schema changes.
