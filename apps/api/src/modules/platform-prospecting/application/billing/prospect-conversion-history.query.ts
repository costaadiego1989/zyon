import { Prisma, type PrismaClient } from "@prisma/client";
import type { ProspectConversionHistoryItem, ProspectingPage } from "@zyon/shared-types";

function decodeCursor(cursor: string, prospectId: string) {
  try {
    if (cursor.length > 1024 || !/^[\w-]+$/.test(cursor)) throw Error();
    const [scope, timestamp, id] = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    const time = new Date(timestamp);
    if (scope !== prospectId || time.toISOString() !== timestamp || typeof id !== "string" || !/^(binding|conversion|gap)\.[\w.-]{1,160}$/.test(id)) throw Error();
    return { time, id };
  } catch { throw Error("invalid_filter:cursor"); }
}

export class ProspectConversionHistoryQuery {
  constructor(private readonly db: PrismaClient) {}

  async execute(prospectId: string, limit = 25, cursor?: string): Promise<ProspectingPage<ProspectConversionHistoryItem>> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw Error("invalid_filter:limit");
    const before = cursor === undefined ? null : decodeCursor(cursor, prospectId);
    return this.db.$transaction(async tx => {
      const lead = await tx.platformProspect.findFirst({ where: { id: prospectId, piiDiscardedAt: null }, select: { id: true } });
      if (!lead) throw Error("prospect_not_found");
      type Stored = Omit<ProspectConversionHistoryItem, "occurredAt"> & { occurredAt: Date };
      const rows = await tx.$queryRaw<Stored[]>`WITH history AS (
        SELECT 'binding.'||p.id AS id, p.id AS "proposalId", p.bound_merchant_id AS "merchantId", p.plan_key AS "planKey",
          p.bound_at AS "occurredAt", 'account' AS provider, 'account_bound' AS state
          FROM prospect_billing_proposals p WHERE p.prospect_id=${prospectId} AND p.bound_at IS NOT NULL
        UNION ALL
        SELECT 'conversion.'||v.id, p.id, v.merchant_id, p.plan_key, v.occurred_at, v.provider, v.state
          FROM prospect_conversions v JOIN prospect_billing_proposals p ON p.id=v.proposal_id
          WHERE v.prospect_id=${prospectId} AND p.prospect_id=v.prospect_id
        UNION ALL
        SELECT 'gap.'||a.id, p.id, p.bound_merchant_id, p.plan_key, a.occurred_at, a.details->>'provider', a.outcome
          FROM prospect_audit_events a JOIN prospect_billing_proposals p ON p.id=a.details->>'proposalId'
          WHERE a.resource_type='prospect' AND a.resource_id=${prospectId} AND p.prospect_id=a.resource_id
          AND a.action='billing.allocation_unknown' AND a.outcome='allocation_coverage_unknown'
      ) SELECT * FROM history
        ${before ? Prisma.sql`WHERE ("occurredAt",id)<(${before.time},${before.id})` : Prisma.empty}
        ORDER BY "occurredAt" DESC,id DESC LIMIT ${limit+1}`;
      const items = rows.slice(0,limit).map(row => ({ ...row, occurredAt: row.occurredAt.toISOString() }));
      const last = items.at(-1);
      const nextCursor = rows.length > limit && last ? Buffer.from(JSON.stringify([prospectId,last.occurredAt,last.id])).toString("base64url") : null;
      return { items, nextCursor };
    }, { isolationLevel: "RepeatableRead" });
  }
}
