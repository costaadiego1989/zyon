import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations"
  },
  datasource: {
    url: process.env.DATABASE_URL ?? "postgresql://atendeai:atendeai_dev@localhost:5434/aacp_dev?schema=public"
  }
});
