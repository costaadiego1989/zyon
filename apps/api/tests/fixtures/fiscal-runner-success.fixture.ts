import "reflect-metadata";
import test from "node:test";
import assert from "node:assert/strict";
import { Injectable } from "@nestjs/common";
import { existsSync } from "node:fs";
class OriginalDependency {}
@Injectable()
class ActualMetadataService {
  constructor(readonly original: OriginalDependency) {}
}
test("fiscal_child_metadata_ok", () => {
  assert.deepEqual(Reflect.getMetadata("design:paramtypes", ActualMetadataService), [OriginalDependency]);
  assert.equal(process.env.NODE_ENV, "test");
  assert.equal(process.env.REDIS_URL, "");
  assert.equal(process.env.REDIS_ENABLED, "false");
  assert.equal(existsSync("apps/api/tests/platform-support-loader.mjs"), true, "source children retain the established monorepo worker context");
});
