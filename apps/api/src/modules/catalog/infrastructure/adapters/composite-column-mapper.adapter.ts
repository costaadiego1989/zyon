import { Injectable } from "@nestjs/common";
import {
  COLUMN_MAPPER,
  type ColumnMapperPort,
  type ColumnMapping,
  type UnitHints,
} from "../../domain/ports/column-mapper.port.js";
import { LlmColumnMapper } from "./llm-column-mapper.adapter.js";
import { DeterministicColumnMapper } from "./deterministic-column-mapper.adapter.js";

/**
 * Composite column mapper: try LLM first, fall back to deterministic on any
 * failure (LLM unavailable, parse error, validator rejection).
 *
 * This is the adapter wired to COLUMN_MAPPER. It guarantees a non-null
 * result — the port contract — because the deterministic fallback always
 * produces one (possibly empty) mapping.
 */
@Injectable()
export class CompositeColumnMapper implements ColumnMapperPort {
  constructor(
    private readonly llm: LlmColumnMapper,
    private readonly fallback: DeterministicColumnMapper,
  ) {}

  async mapColumns(
    headers: string[],
    sampleRows: Array<Record<string, string>>,
  ): Promise<{ mapping: ColumnMapping; unitHints?: UnitHints }> {
    try {
      const viaLlm = await this.llm.tryMap(headers, sampleRows);
      if (viaLlm) return viaLlm;
    } catch {
      // swallow — fall through to deterministic
    }
    return this.fallback.mapColumns(headers, sampleRows);
  }
}

export { COLUMN_MAPPER };