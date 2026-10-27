import { createPrismaClient } from "../shared/persistence/prisma-client.js";

async function main() {
  const p = createPrismaClient();
  const cats = await p.storyCategory.findMany();
  console.log("CATS:", cats.length, JSON.stringify(cats.map(c => ({ id: c.id, name: c.name, merchantId: c.merchantId }))));
  const stories = await p.story.findMany();
  console.log("STORIES:", stories.length);
  await p.$disconnect();
}
main();
