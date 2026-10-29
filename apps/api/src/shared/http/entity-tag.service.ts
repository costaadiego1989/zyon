import { Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { Response } from "express";
import { canonicalJson } from "./canonical-json.js";
import {
  PreconditionFailedException,
  PreconditionRequiredException,
} from "./http-contract.errors.js";

@Injectable()
export class EntityTagService {
  create(value: unknown): string {
    const digest = createHash("sha256")
      .update(canonicalJson(value))
      .digest("base64url");
    return `"${digest}"`;
  }

  set(response: Response, value: unknown): string {
    const entityTag = this.create(value);
    response.setHeader("ETag", entityTag);
    return entityTag;
  }

  assertIfMatch(ifMatch: string | undefined, currentValue: unknown): void {
    if (!ifMatch?.trim()) {
      throw new PreconditionRequiredException();
    }

    const currentTag = this.create(currentValue);
    const candidates = ifMatch.split(",").map((value) => value.trim());
    if (!candidates.includes("*") && !candidates.includes(currentTag)) {
      throw new PreconditionFailedException();
    }
  }
}
