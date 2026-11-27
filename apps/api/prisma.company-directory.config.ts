import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/company-directory.prisma",
  migrations: { path: "prisma/company-directory-migrations" },
});
