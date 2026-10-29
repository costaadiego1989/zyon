import { createPrismaClient } from "../shared/persistence/prisma-client.js";

const p = createPrismaClient();
const merchant = await p.merchant.findFirst({ where: { name: "Cosmos" } });

if (!merchant) {
  console.log("Merchant Cosmos not found");
  await p.$disconnect();
  process.exit(1);
}

const currentTheme = (merchant.theme ?? {}) as Record<string, unknown>;
const updatedTheme = {
  ...currentTheme,
  agentName: "Assistente Cosmos",
  headerTitle: "Cosmos",
};

await p.merchant.update({
  where: { id: merchant.id },
  data: { theme: updatedTheme },
});

console.log("Updated theme with agentName:", JSON.stringify(updatedTheme, null, 2));
await p.$disconnect();
