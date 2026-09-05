import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations"
  }
  // Note: datasource.url is configured in schema.prisma via env("DATABASE_URL").
  // Do NOT duplicate it here — Prisma 6 throws P1012 if the URL is set in both places.
});
