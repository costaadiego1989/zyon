import { defineConfig } from "prisma/config";

// Used only to reconcile the one failed migration left by the previous deploy.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
});
