import { Prisma } from "@prisma/client";
import { createPrismaClient } from "../shared/persistence/prisma-client.js";

const p = createPrismaClient();

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-").trim();
}

// Fix all merchants that don't have a slug in storeSettings
const merchants = await p.merchant.findMany({ select: { id: true, name: true, storeSettings: true } });

for (const m of merchants) {
  const settings = (m.storeSettings ?? {}) as Record<string, unknown>;
  if (settings.slug) {
    console.log(`  ${m.name} → already has slug: ${settings.slug}`);
    continue;
  }
  const slug = slugify(m.name);
  await p.merchant.update({
    where: { id: m.id },
    data: { storeSettings: { ...settings, slug } as Prisma.InputJsonValue },
  });
  console.log(`  ${m.name} → slug: ${slug}`);
}

console.log("Done.");
await p.$disconnect();
