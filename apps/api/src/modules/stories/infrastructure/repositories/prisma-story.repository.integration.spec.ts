import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { NotFoundException } from "@nestjs/common";
import { PrismaStoryRepository } from "./prisma-story.repository.js";

const clientPath = process.env.READY_PROD_TEST_PRISMA_CLIENT;
const databaseUrl = process.env.READY_PROD_TEST_DATABASE_URL;
describe("stories tenant isolation (PostgreSQL)", { skip: !clientPath || !databaseUrl }, () => {
  let prisma: any;
  let repository: PrismaStoryRepository;
  const merchantA = `audit_${randomUUID()}`;
  const merchantB = `audit_${randomUUID()}`;
  let categoryA: any;
  let categoryB: any;
  let storyA: any;
  let storyB: any;
  before(async () => {
    const { PrismaClient } = createRequire(import.meta.url)(clientPath!);
    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    repository = new PrismaStoryRepository(prisma);
    await prisma.merchant.createMany({ data: [{ id: merchantA, name: "Audit A" }, { id: merchantB, name: "Audit B" }] });
    categoryA = await repository.createCategory(merchantA, { name: "A" });
    categoryB = await repository.createCategory(merchantB, { name: "B" });
    storyA = await repository.createStory(merchantA, categoryA.id, { imageUrl: "https://example.invalid/a.png" });
    storyB = await repository.createStory(merchantB, categoryB.id, { imageUrl: "https://example.invalid/b.png" });
  });
  after(async () => {
    if (!prisma) return;
    await prisma.merchant.deleteMany({ where: { id: { in: [merchantA, merchantB] } } });
    await prisma.$disconnect();
  });
  it("rejects update/archive of another merchant's category and story without writes", async () => {
    const categoryBefore = await prisma.storyCategory.findUniqueOrThrow({ where: { id: categoryB.id } });
    const storyBefore = await prisma.story.findUniqueOrThrow({ where: { id: storyB.id } });
    await assert.rejects(repository.updateCategory(merchantA, categoryB.id, { name: "intrusion" }), NotFoundException);
    await assert.rejects(repository.archiveCategory(merchantA, categoryB.id), NotFoundException);
    await assert.rejects(repository.updateStory(merchantA, storyB.id, { title: "intrusion" }), NotFoundException);
    await assert.rejects(repository.archiveStory(merchantA, storyB.id), NotFoundException);
    assert.deepEqual(await prisma.storyCategory.findUniqueOrThrow({ where: { id: categoryB.id } }), categoryBefore);
    assert.deepEqual(await prisma.story.findUniqueOrThrow({ where: { id: storyB.id } }), storyBefore);
  });
  it("rejects a cross-merchant category association at creation", async () => {
    const count = await prisma.story.count({ where: { merchantId: merchantA } });
    await assert.rejects(repository.createStory(merchantA, categoryB.id, { imageUrl: "https://example.invalid/x.png" }), NotFoundException);
    assert.equal(await prisma.story.count({ where: { merchantId: merchantA } }), count);
  });
  it("rolls back an entire category or story reorder containing a foreign resource", async () => {
    await assert.rejects(repository.reorderCategories(merchantA, [{ id: categoryA.id, sortOrder: 99 }, { id: categoryB.id, sortOrder: 99 }]), NotFoundException);
    await assert.rejects(repository.reorderStories(merchantA, [{ id: storyA.id, sortOrder: 99 }, { id: storyB.id, sortOrder: 99 }]), NotFoundException);
    for (const category of [categoryA, categoryB]) assert.equal((await prisma.storyCategory.findUniqueOrThrow({ where: { id: category.id } })).sortOrder, 0);
    for (const story of [storyA, storyB]) assert.equal((await prisma.story.findUniqueOrThrow({ where: { id: story.id } })).sortOrder, 0);
  });
  it("hides historical cross-merchant associations from the public projection and manager", async () => {
    const bad = await prisma.story.create({ data: { categoryId: categoryA.id, merchantId: merchantB, imageUrl: "https://example.invalid/legacy.png" } });
    const publicCategories = await repository.listPublicStories(merchantA);
    assert.deepEqual(publicCategories.flatMap((category) => category.stories.map((story: any) => story.id)), [storyA.id]);
    assert.deepEqual(await repository.listStories(categoryA.id, merchantB), []);
    await assert.rejects(repository.updateStory(merchantB, bad.id, { title: "intrusion" }), NotFoundException);
    await prisma.story.delete({ where: { id: bad.id } });
  });
  it("preserves legitimate updates, reorder and archive for the owner", async () => {
    assert.equal((await repository.updateCategory(merchantA, categoryA.id, { name: "Updated A" })).name, "Updated A");
    assert.equal((await repository.updateStory(merchantA, storyA.id, { title: "Updated story" })).title, "Updated story");
    await repository.reorderCategories(merchantA, [{ id: categoryA.id, sortOrder: 2 }]);
    await repository.reorderStories(merchantA, [{ id: storyA.id, sortOrder: 3 }]);
    await repository.archiveStory(merchantA, storyA.id);
    assert.equal((await repository.listPublicStories(merchantA))[0].stories.length, 0);
    await repository.archiveCategory(merchantA, categoryA.id);
    assert.deepEqual(await repository.listPublicStories(merchantA), []);
    await assert.rejects(repository.createStory(merchantA, categoryA.id, { imageUrl: "https://example.invalid/archived.png" }), NotFoundException);
  });
});
