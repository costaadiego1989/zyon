import { Inject, Injectable, Optional } from "@nestjs/common";
import {
  type CanonicalField,
  CANONICAL_FIELDS,
  type ColumnMapping,
  type UnitHints,
} from "../../domain/ports/column-mapper.port.js";
import { validateColumnMapping } from "../../domain/services/validate-column-mapping.js";
import {
  CHAT_COMPLETION_PORT,
  type ChatCompletionPort,
  type ChatMessage,
} from "../../../support/domain/ports/chat-completion.port.js";

const SYSTEM_PROMPT = `You map spreadsheet column headers to a fixed set of product fields.
Return ONLY a JSON object mapping each relevant detected header to one of:
${CANONICAL_FIELDS.join(", ")}.
Never return row values. Never invent headers. Omit headers that don't match.
Optionally include a "_unitHints" object {priceInReais, weightInKg}.
Output JSON only — no prose, no code fences.`;

/**
 * Extract the first {...} JSON object from a string that may contain prose,
 * code fences, or surrounding text.
 */
function extractFirstJsonObject(s: string): string | null {
  const start = s.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

function isCanonicalField(v: unknown): v is CanonicalField {
  return typeof v === "string" && (CANONICAL_FIELDS as readonly string[]).includes(v);
}

/**
 * LLM-backed column mapper adapter. Returns `null` on any failure mode
 * (LLM unavailable, unparseable reply, validator rejection) so the composite
 * can fall back to the deterministic mapper.
 *
 * Does NOT directly implement ColumnMapperPort (whose contract is non-null);
 * the composite is the port. This class exposes `tryMap` instead.
 */
@Injectable()
export class LlmColumnMapper {
  constructor(
    @Optional()
    @Inject(CHAT_COMPLETION_PORT)
    private readonly chat?: ChatCompletionPort,
  ) {}

  async tryMap(
    headers: string[],
    sampleRows: Array<Record<string, string>>,
  ): Promise<{ mapping: ColumnMapping; unitHints?: UnitHints } | null> {
    if (!this.chat) return null;

    const userPayload = JSON.stringify(
      {
        headers,
        sampleRows: sampleRows.slice(0, 3),
      },
      null,
      2,
    );

    const messages: ChatMessage[] = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPayload },
    ];

    const reply = await this.chat.complete(messages);
    if (reply === null || reply.trim() === "") return null;

    const jsonStr = extractFirstJsonObject(reply);
    if (!jsonStr) return null;

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      return null;
    }

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return null;
    }

    // Split off _unitHints if present (validator ignores it, but it must not
    // be treated as a header→field pair).
    const parsedObj = parsed as Record<string, unknown>;
    let unitHints: UnitHints | undefined;
    if (
      "_unitHints" in parsedObj &&
      typeof parsedObj["_unitHints"] === "object" &&
      parsedObj["_unitHints"] !== null
    ) {
      const raw = parsedObj["_unitHints"] as Record<string, unknown>;
      unitHints = {
        priceInReais: typeof raw["priceInReais"] === "boolean" ? raw["priceInReais"] : undefined,
        weightInKg: typeof raw["weightInKg"] === "boolean" ? raw["weightInKg"] : undefined,
      };
    }

    // Build the mapping payload — strip _unitHints, drop entries whose value
    // is not a canonical field (validator will catch missing/non-string keys,
    // but we pre-filter for cleanliness).
    const mappingPayload: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(parsedObj)) {
      if (k === "_unitHints") continue;
      if (!isCanonicalField(v)) continue;
      mappingPayload[k] = v;
    }

    const result = validateColumnMapping(mappingPayload, headers);
    if (!result.ok) return null;

    return unitHints ? { mapping: result.mapping, unitHints } : { mapping: result.mapping };
  }
}