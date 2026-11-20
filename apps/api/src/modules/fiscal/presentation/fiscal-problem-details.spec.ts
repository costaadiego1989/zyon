import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException, ConflictException } from "@nestjs/common";
import { ProblemDetailsSchema } from "@zyon/contracts";
import { toProblemDetails } from "../../../shared/http/problem-details.filter.js";
import { HttpException } from "@nestjs/common";
import { fiscalHttp } from "./fiscal-http.js";
test("FISCAL-07 actual global problem mapper retains only specific canonical correction gaps", () => {
  const value = toProblemDetails(
    new BadRequestException({
      code: "fiscal_customer_data_required",
      message: "fiscal_customer_data_required",
      fields: ["address.number", "private_token"],
    }),
    "synthetic_correlation"
  );
  assert.equal(value.code, "fiscal_customer_data_required");
  assert.deepEqual(value.fields, ["address.number"]);
  assert.equal(ProblemDetailsSchema.safeParse(value).success, true);
});
test("FISCAL-05 actual global problem mapper retains concrete readiness pending checks", () => {
  const value = toProblemDetails(
    new ConflictException({
      code: "fiscal_connection_not_ready",
      pending: ["certificate", "permissions", "raw_private_payload"],
    }),
    "synthetic_correlation"
  );
  assert.deepEqual(value.pending, ["certificate", "permissions"]);
  assert.equal(ProblemDetailsSchema.safeParse(value).success, true);
});
test("FISCAL-61 global contract never expands arbitrary errors into fiscal correction authority", () => {
  const value = toProblemDetails(
    new BadRequestException({
      code: "other_error",
      fields: ["taxId"],
      pending: ["permissions"],
    }),
    "synthetic_correlation"
  );
  assert.equal(value.fields, undefined);
  assert.equal(value.pending, undefined);
  assert.equal(
    ProblemDetailsSchema.safeParse({ ...value, fields: ["taxId"] }).success,
    false
  );
});

test("TINY-03 OAuth corrections retain actionable public codes and validation status", async () => {
  for (const [code, status] of [["fiscal_olist_authorization_expired_or_used", 409], ["fiscal_olist_connection_changed", 409], ["fiscal_olist_issuer_mismatch", 400]] as const) {
    await assert.rejects(() => fiscalHttp(async () => { throw new Error(code); }), error => {
      assert.ok(error instanceof HttpException); assert.equal(error.getStatus(), status);
      const problem = toProblemDetails(error, "local-olist-correlation");
      assert.equal(problem.code, code); assert.equal(problem.status, status); assert.equal(ProblemDetailsSchema.safeParse(problem).success, true);
      return true;
    });
  }
});
