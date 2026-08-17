import { createPrismaClient } from "../shared/persistence/prisma-client.js";

async function main() {
  const p = createPrismaClient();

  const cats = await p.storyCategory.findMany({ select: { id: true, merchantId: true, name: true } });
  console.log("=== CATEGORIES ===");
  console.log(JSON.stringify(cats, null, 2));

  const merchants = await p.merchantUser.findMany({ take: 3, select: { email: true, merchantId: true } });
  console.log("\n=== USERS ===");
  console.log(JSON.stringify(merchants, null, 2));

  // Try creating a story directly
  if (cats.length > 0) {
    const cat = cats[0];
    console.log(`\nTrying to create story in category ${cat.id} (merchant: ${cat.merchantId})...`);
    try {
      const story = await p.story.create({
        data: {
          merchantId: cat.merchantId,
          categoryId: cat.id,
          imageUrl: "https://test.com/img.jpg",
          title: "Test",
          duration: 7,
          sortOrder: 0,
        }
      });
      console.log("SUCCESS:", story.id);
      // cleanup
      await p.story.delete({ where: { id: story.id } });
    } catch (e: any) {
      console.log("ERROR:", e.code, e.message?.slice(0, 200));
    }
  }

  await p.$disconnect();
}
main();
