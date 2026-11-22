import { PrismaClient } from "@prisma/client";
import { createCompanyDirectoryFixture, seedSearchDirectory } from "./company-directory-fixture.js";
import { PrismaDirectoryRepository } from "../src/modules/platform-prospecting/infrastructure/company-directory/prisma-directory.repository.js";
export async function createProspectCrmFixture() {
  const fixture = await createCompanyDirectoryFixture();
  const prisma = new PrismaClient({ datasources: { db: { url: fixture.databaseUrl } } });
  try {
    await seedSearchDirectory(fixture); await prisma.platformProspect.deleteMany();
    await fixture.pg.query("INSERT INTO platform_operators VALUES ('operator'),('other')");
    await prisma.platformProspectSenderBinding.create({ data: { id: "sender", appId: "app", wabaId: "waba", phoneNumberId: "phone", displayPhoneNumber: "synthetic", encryptedCredentials: "fixture-only", grantedAssets: {}, connectedBy: "operator" } });
    return { ...fixture, prisma, directory: new PrismaDirectoryRepository(fixture.client, "fixture-cursor-key"), async close() { await prisma.$disconnect(); await fixture.close(); } };
  } catch (error) { await prisma.$disconnect(); await fixture.close(); throw error; }
}
