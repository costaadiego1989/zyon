import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ExperimentRouterService, type PromptVariant, type ExperimentRepositoryPort, type Experiment } from "./experiment-router.service.js";

describe("ExperimentRouterService", () => {
  class MockExperimentRepository implements ExperimentRepositoryPort {
    private runningExperiment: Experiment | null = null;

    setRunningExperiment(exp: Experiment | null) {
      this.runningExperiment = exp;
    }

    async findRunning(): Promise<Experiment | null> {
      return this.runningExperiment;
    }
  }

  const mockRepo = new MockExperimentRepository();
  const router = new ExperimentRouterService(mockRepo);

  const createVariant = (id: string, name: string, weight: number): PromptVariant => ({
    id,
    name,
    weight,
    systemPrompt: `Prompt for ${name}`,
    createdAt: new Date(),
  });

  const createExperiment = (variants: PromptVariant[]): Experiment => ({
    id: "exp-1",
    merchantId: "merchant-1",
    name: "Test Experiment",
    status: "running",
    variants,
    startedAt: new Date(),
    createdAt: new Date(),
  });

  describe("selectVariant", () => {
    it("returns null when no experiment is running", async () => {
      mockRepo.setRunningExperiment(null);
      router.clearCache();

      const variant = await router.selectVariant("merchant-1");
      assert.equal(variant, null);
    });

    it("selects from equal weights with distribution ~33% each (1000 trials)", async () => {
      const variants = [
        createVariant("v1", "Variant A", 1),
        createVariant("v2", "Variant B", 1),
        createVariant("v3", "Variant C", 1),
      ];

      const exp = createExperiment(variants);
      mockRepo.setRunningExperiment(exp);
      router.clearCache();

      const counts: Record<string, number> = { v1: 0, v2: 0, v3: 0 };
      const trials = 1000;

      for (let i = 0; i < trials; i++) {
        const selected = await router.selectVariant("merchant-1");
        assert.ok(selected);
        counts[selected!.id]++;
      }

      // Each variant should be ~333 (+-50 is reasonable for randomness)
      const expected = trials / 3;
      const tolerance = 50;

      assert.ok(
        Math.abs(counts.v1 - expected) < tolerance,
        `V1: ${counts.v1} should be ~${expected}`
      );
      assert.ok(
        Math.abs(counts.v2 - expected) < tolerance,
        `V2: ${counts.v2} should be ~${expected}`
      );
      assert.ok(
        Math.abs(counts.v3 - expected) < tolerance,
        `V3: ${counts.v3} should be ~${expected}`
      );
    });

    it("respects weighted distribution (2:1:1 ratio)", async () => {
      const variants = [
        createVariant("v1", "Heavy", 2),
        createVariant("v2", "Normal", 1),
        createVariant("v3", "Normal", 1),
      ];

      const exp = createExperiment(variants);
      mockRepo.setRunningExperiment(exp);
      router.clearCache();

      const counts: Record<string, number> = { v1: 0, v2: 0, v3: 0 };
      const trials = 1000;

      for (let i = 0; i < trials; i++) {
        const selected = await router.selectVariant("merchant-1");
        assert.ok(selected);
        counts[selected!.id]++;
      }

      // v1 should be ~500, v2 and v3 should be ~250 each
      const tolerance = 60;
      assert.ok(Math.abs(counts.v1 - 500) < tolerance, `V1: ${counts.v1} should be ~500`);
      assert.ok(Math.abs(counts.v2 - 250) < tolerance, `V2: ${counts.v2} should be ~250`);
      assert.ok(Math.abs(counts.v3 - 250) < tolerance, `V3: ${counts.v3} should be ~250`);
    });

    it("uses cache for 5 minutes (no repeated queries)", async () => {
      let queryCount = 0;

      class CountingRepo implements ExperimentRepositoryPort {
        async findRunning(): Promise<Experiment | null> {
          queryCount++;
          return createExperiment([
            createVariant("v1", "A", 1),
            createVariant("v2", "B", 1),
          ]);
        }
      }

      const countingRouter = new ExperimentRouterService(new CountingRepo());

      // Multiple calls should hit cache
      await countingRouter.selectVariant("merchant-1");
      await countingRouter.selectVariant("merchant-1");
      await countingRouter.selectVariant("merchant-1");

      // Should only query once (cache hit on subsequent calls)
      assert.equal(queryCount, 1, "Should only query once within cache TTL");
    });

    it("invalidates cache when requested", async () => {
      let queryCount = 0;

      class CountingRepo implements ExperimentRepositoryPort {
        async findRunning(): Promise<Experiment | null> {
          queryCount++;
          return createExperiment([createVariant("v1", "A", 1)]);
        }
      }

      const countingRouter = new ExperimentRouterService(new CountingRepo());

      await countingRouter.selectVariant("merchant-1");
      assert.equal(queryCount, 1);

      countingRouter.invalidateCache("merchant-1");

      await countingRouter.selectVariant("merchant-1");
      assert.equal(queryCount, 2, "Should query again after cache invalidation");
    });

    it("throws on empty variants list", async () => {
      const exp = createExperiment([]);
      mockRepo.setRunningExperiment(exp);
      router.clearCache();

      try {
        await router.selectVariant("merchant-1");
        assert.fail("Should throw on empty variants");
      } catch (e: any) {
        assert.match(e.message, /empty variants/i);
      }
    });

    it("throws on zero total weight", async () => {
      const variants = [
        createVariant("v1", "Zero", 0),
        createVariant("v2", "Zero", 0),
      ];
      const exp = createExperiment(variants);
      mockRepo.setRunningExperiment(exp);
      router.clearCache();

      try {
        await router.selectVariant("merchant-1");
        assert.fail("Should throw on zero total weight");
      } catch (e: any) {
        assert.match(e.message, /positive/i);
      }
    });
  });
});
