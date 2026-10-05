import type { Prisma } from "@prisma/client";
import type { StrategyProposal } from "../domain/strategy-proposal.js";

/** Keep frozen JSON numbers byte-equivalent to the object whose hash was
 * approved. Prisma's JSON value transport can round IEEE-754 numbers (e.g.
 * 1/6500) before PostgreSQL sees them. A bound string cast to jsonb preserves
 * JSON.stringify's representation; all ordinary constraints/triggers apply. */
export async function insertStrategyVersion(tx: Prisma.TransactionClient, input: {
  strategyId: string; merchantId: string; version: number; proposalHash: string;
  proposal: StrategyProposal; expiresAt: Date;
}): Promise<void> {
  await tx.$executeRaw`
    INSERT INTO revenue_strategy_versions
      (strategy_id, merchant_id, version, proposal_hash, proposal, expires_at)
    VALUES (${input.strategyId}, ${input.merchantId}, ${input.version}, ${input.proposalHash},
      ${JSON.stringify(input.proposal)}::jsonb, ${input.expiresAt})
  `;
}
