import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { PlatformFeedbackController } from "./platform-feedback.controller.js";
import { throwPlatformFeedbackHttpError } from "./platform-feedback.http-errors.js";
import { setPlatformPrincipal, type PlatformPrincipalRequest } from "./platform-principal.js";

test("maps malformed feedback treatment commands to HTTP 400", () => {
  assert.throws(
    () => throwPlatformFeedbackHttpError(new Error("platform_feedback_invalid_priority")),
    error => error instanceof BadRequestException && error.getStatus() === 400 && error.message === "platform_feedback_invalid_priority",
  );
});

test("maps an unknown treatment assignee to HTTP 400", () => {
  assert.throws(
    () => throwPlatformFeedbackHttpError(new Error("platform_feedback_assignee_not_found")),
    error => error instanceof BadRequestException && error.getStatus() === 400,
  );
});

test("keeps a missing feedback record as HTTP 404", () => {
  assert.throws(
    () => throwPlatformFeedbackHttpError(new Error("platform_feedback_not_found")),
    error => error instanceof NotFoundException && error.getStatus() === 404,
  );
});

test("the feedback controller returns HTTP 400 for a malformed treatment command", async () => {
  const controller = new PlatformFeedbackController(
    { execute: async () => ({ items: [] }) } as never,
    { execute: async () => { throw new Error("platform_feedback_invalid_priority"); } } as never,
  );
  const request: PlatformPrincipalRequest & { correlationId?: string } = { correlationId: "corr_1" };
  setPlatformPrincipal(request, {
    operatorId: "operator_1",
    email: "operator@example.com",
    role: "support_ops",
  });

  await assert.rejects(
    () => controller.treat("feedback_1", { priority: "urgent" }, request),
    error => error instanceof BadRequestException && error.getStatus() === 400,
  );
});
