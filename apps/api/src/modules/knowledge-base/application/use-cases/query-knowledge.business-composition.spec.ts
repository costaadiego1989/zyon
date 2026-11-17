import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { OPTIONAL_DEPS_METADATA } from "@nestjs/common/constants.js";
import { QueryKnowledgeUseCase } from "./query-knowledge.use-case.js";

test("T71 production composition requires the service factory while explicit legacy constructors retain execute", async () => {
  const optional: number[] = Reflect.getMetadata(OPTIONAL_DEPS_METADATA, QueryKnowledgeUseCase) ?? [];
  assert.equal(optional.includes(5), false, "the production container must not silently omit the canonical factory");
  const query = new QueryKnowledgeUseCase({ isAvailable: () => false } as never, {} as never);
  assert.equal(await query.openBusinessAnswer({ merchantId: "legacy", fallbackPurpose: "existing_support_faq" }), undefined);
  assert.deepEqual(await query.execute({ merchantId: "legacy", queryText: "Question" }), { chunks: [] });
});
