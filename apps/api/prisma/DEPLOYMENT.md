# Database deployment

`prisma.config.ts` uses `prisma/deploy-migrations` for new migrations and deployments.
The first migration contains the complete current Prisma schema, including the
partial unique index that prevents concurrent negotiation offer application.

The previous 51 migrations remain in `prisma/migrations` as historical reference.
That history cannot initialize an empty database: it omits roughly 40 tables and
contains a batch of `CREATE INDEX CONCURRENTLY` statements that Prisma cannot run.
Do not mix the two migration directories.

For a new, empty database, run:

```sh
pnpm --filter @zyon/api prisma:deploy
```

Railway runs the same migration command before deployment and checks `/ready`
before making the API available. Docker Compose runs migrations before starting
the API process.

For an existing database, back it up and compare its schema with this baseline
before adopting the new history. After applying any reviewed reconciliation SQL,
mark `20260905000000_complete_schema` as applied with `prisma migrate resolve`.
Never reset an existing database or mark this baseline applied without checking
that its schema and custom constraints are already present.

Future changes should use `prisma migrate dev` with the existing config; commit
the resulting files in `prisma/deploy-migrations` with the schema changes.
