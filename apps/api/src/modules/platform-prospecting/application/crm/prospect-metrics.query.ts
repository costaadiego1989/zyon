import { Prisma, type PrismaClient } from "@prisma/client";
import {
  PROSPECT_METRIC_NAMES,
  type ProspectMetricRecord,
  type ProspectMetricRecordsQuery,
  type ProspectMetricName,
  type ProspectMetrics,
  type ProspectMetricsQuery,
} from "@zyon/shared-types";

type Counts = Pick<
  ProspectMetrics,
  | "leads"
  | "attempts"
  | "accepted"
  | "delivered"
  | "uniqueReplies"
  | "signups"
  | "trials"
  | "paidSubscriptions"
  | "refundedSubscriptions"
  | "unknownAllocationEvents"
> & { population: number };
type Commitment = ProspectMetrics["costs"]["commitments"][number];

function instant(value: string) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value))
    throw Error("invalid_filter:period");
  const date = new Date(value);
  if (!Number.isFinite(+date) || date.toISOString().slice(0, 19) !== value.slice(0, 19))
    throw Error("invalid_filter:period");
  return date;
}

function cohortSql(campaign: string | undefined, from: Date, to: Date) {
  const outbound = Prisma.sql`outbound AS (
        SELECT 'a.'||a.id AS id,r.prospect_id,a.conversation_id,r.campaign_id, s.endpoint_id, a.submitted_at, a.accepted_at, a.delivered_at, a.read_at,
          a.state, a.cost_state, a.currency, a.reserved_amount, a.created_at
        FROM outreach_attempts a JOIN prospect_sequences s ON s.id=a.sequence_id LEFT JOIN campaign_recipients r ON r.id=a.recipient_id
        ${campaign ? Prisma.sql`WHERE r.campaign_id=${campaign}` : Prisma.empty}
        UNION ALL
        SELECT 'm.'||m.id,c.prospect_id,m.conversation_id,m.campaign_id,c.endpoint_id,m.submitted_at,m.accepted_at,m.delivered_at,m.read_at,
          m.state,m.cost_state,'BRL',m.reserved_amount,m.created_at
        FROM prospect_messages m JOIN prospect_conversations c ON c.id=m.conversation_id
        WHERE m.direction='outbound' AND m.attempt_id IS NULL ${
          campaign ? Prisma.sql`AND m.campaign_id=${campaign}` : Prisma.empty
        }
      )`;
  const attributedProposal = (column: Prisma.Sql) =>
    campaign
      ? Prisma.sql`AND EXISTS (
        SELECT 1 FROM prospect_outbox o JOIN prospect_messages m ON m.id=o.payload->>'messageId'
        WHERE o.kind='prospect.chat.dispatch' AND o.event_id='chat.'||m.id AND o.payload->>'proposalId'=${column}
        AND m.conversation_id=o.payload->>'conversationId' AND m.campaign_id=${campaign})`
      : Prisma.empty;
  const ctes = Prisma.sql`${outbound}, cohort AS (
          SELECT endpoint_id,min(coalesce(delivered_at,read_at)) AS first_delivery
          FROM outbound WHERE coalesce(delivered_at,read_at)>=${from} AND coalesce(delivered_at,read_at)<${to}
          GROUP BY endpoint_id
        ),
        responders AS (
          SELECT DISTINCT ON (c.endpoint_id) c.endpoint_id AS id,c.prospect_id,c.id AS conversation_id,m.provider_occurred_at AS occurred_at FROM prospect_messages m
          JOIN prospect_conversations c ON c.id=m.conversation_id JOIN cohort p ON p.endpoint_id=c.endpoint_id
          WHERE m.direction='inbound' AND m.author_type='prospect'
          AND m.provider_occurred_at>=p.first_delivery AND m.provider_occurred_at<${to} ORDER BY c.endpoint_id,m.provider_occurred_at,m.id
        ),
        conversions AS (
          SELECT v.* FROM prospect_conversions v WHERE v.occurred_at>=${from} AND v.occurred_at<${to}
          ${attributedProposal(Prisma.sql`v.proposal_id`)}
        ),
        net_paid AS (
          SELECT v.* FROM conversions v WHERE v.state='paid' AND NOT EXISTS (
            SELECT 1 FROM prospect_conversions refund WHERE refund.state='refunded' AND refund.provider=v.provider
            AND refund.subscription_id=v.subscription_id AND refund.proposal_id=v.proposal_id AND refund.occurred_at<${to})
        )`;
  const inPeriod = (time: Prisma.Sql) => Prisma.sql`${time}>=${from} AND ${time}<${to}`;
  const outboundRows = (time: Prisma.Sql) =>
    Prisma.sql`SELECT id,prospect_id,conversation_id,${time} AS occurred_at FROM outbound WHERE ${inPeriod(time)}`;
  const accounts = (state: string) =>
    Prisma.sql`SELECT DISTINCT ON (merchant_id) merchant_id AS id,prospect_id,NULL::text AS conversation_id,occurred_at FROM conversions WHERE state=${state} ORDER BY merchant_id,occurred_at,id`;
  const rows: Record<ProspectMetricName, Prisma.Sql> = {
    leads: campaign
      ? Prisma.sql`SELECT r.prospect_id AS id,r.prospect_id,NULL::text AS conversation_id,min(r.created_at) AS occurred_at FROM campaign_recipients r WHERE r.campaign_id=${campaign} AND ${inPeriod(
          Prisma.sql`r.created_at`
        )} GROUP BY r.prospect_id`
      : Prisma.sql`SELECT id,id AS prospect_id,NULL::text AS conversation_id,created_at AS occurred_at FROM platform_prospects WHERE ${inPeriod(
          Prisma.sql`created_at`
        )}`,
    attempts: outboundRows(Prisma.sql`submitted_at`),
    accepted: outboundRows(Prisma.sql`coalesce(accepted_at,delivered_at,read_at)`),
    delivered: outboundRows(Prisma.sql`coalesce(delivered_at,read_at)`),
    uniqueReplies: Prisma.sql`SELECT * FROM responders`,
    signups: accounts("signup"),
    trials: accounts("trial"),
    paidSubscriptions: Prisma.sql`SELECT id,prospect_id,NULL::text AS conversation_id,occurred_at FROM net_paid`,
    refundedSubscriptions: Prisma.sql`SELECT id,prospect_id,NULL::text AS conversation_id,occurred_at FROM conversions WHERE state='refunded'`,
    unknownAllocationEvents: Prisma.sql`SELECT a.id,a.resource_id AS prospect_id,NULL::text AS conversation_id,a.occurred_at FROM prospect_audit_events a WHERE a.action='billing.allocation_unknown' AND ${inPeriod(
      Prisma.sql`a.occurred_at`
    )} ${attributedProposal(Prisma.sql`(a.details->>'proposalId')`)}`,
  };
  return { ctes, rows, outbound };
}

export class ProspectMetricsQueryService {
  constructor(private readonly db: PrismaClient, private readonly clock = () => new Date()) {}
  async records(input: ProspectMetricRecordsQuery) {
    const from = instant(input.from),
      to = instant(input.to),
      limit = input.limit ?? 30;
    if (
      from >= to ||
      !PROSPECT_METRIC_NAMES.includes(input.metric) ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100
    )
      throw Error("invalid_filter:metric");
    const scope = JSON.stringify([input.metric, input.campaignId ?? null, from.toISOString(), to.toISOString()]);
    let after = "";
    if (input.cursor) {
      try {
        const [saved, id] = JSON.parse(Buffer.from(input.cursor, "base64url").toString("utf8"));
        if (saved !== scope || typeof id !== "string" || !id || id.length > 300) throw Error();
        after = id;
      } catch {
        throw Error("invalid_filter:cursor");
      }
    }
    const { ctes, rows } = cohortSql(input.campaignId, from, to);
    return this.db.$transaction(
      async (tx) => {
        if (
          input.campaignId &&
          !(await tx.prospectCampaign.findUnique({ where: { id: input.campaignId }, select: { id: true } }))
        )
          throw Error("campaign_not_found");
        const found = await tx.$queryRaw<
          (Omit<ProspectMetricRecord, "occurredAt"> & { occurredAt: Date })[]
        >`WITH ${ctes},records AS (${rows[input.metric]})
        SELECT r.id,r.prospect_id AS "prospectId",r.conversation_id AS "conversationId",p.cnpj,r.occurred_at AS "occurredAt"
        FROM records r LEFT JOIN platform_prospects p ON p.id=r.prospect_id WHERE r.id>${after} ORDER BY r.id LIMIT ${
          limit + 1
        }`;
        return {
          items: found.slice(0, limit).map((r) => ({ ...r, occurredAt: r.occurredAt.toISOString() })),
          nextCursor:
            found.length > limit
              ? Buffer.from(JSON.stringify([scope, found[limit - 1].id])).toString("base64url")
              : null,
        };
      },
      { isolationLevel: "RepeatableRead" }
    );
  }
  async execute(input: ProspectMetricsQuery): Promise<ProspectMetrics> {
    const from = instant(input.from),
      to = instant(input.to),
      updatedAt = this.clock().toISOString();
    if (from >= to) throw Error("invalid_filter:period");
    const campaign = input.campaignId;
    return this.db.$transaction(
      async (tx) => {
        if (campaign && !(await tx.prospectCampaign.findUnique({ where: { id: campaign }, select: { id: true } })))
          throw Error("campaign_not_found");
        const { ctes, rows, outbound } = cohortSql(campaign, from, to);
        const fields = PROSPECT_METRIC_NAMES.map(
          (name) =>
            Prisma.sql`(SELECT count(*)::int FROM (${rows[name]}) metric_rows) AS ${Prisma.raw('"' + name + '"')}`
        );
        const [counts] = await tx.$queryRaw<Counts[]>`WITH ${ctes} SELECT ${Prisma.join(
          fields
        )}, (SELECT count(*)::int FROM cohort) AS population`;
        const commitments = await tx.$queryRaw<Commitment[]>`WITH ${outbound}, usage AS (
        SELECT 'meta' AS source,currency,cost_state AS state,reserved_amount AS amount FROM outbound
          WHERE created_at>=${from} AND created_at<${to} AND cost_state IN ('reserved','unknown','committed')
        UNION ALL SELECT 'model','BRL',state,amount_cents FROM prospect_model_usage
          WHERE created_at>=${from} AND created_at<${to} ${
          campaign ? Prisma.sql`AND campaign_id=${campaign}` : Prisma.empty
        }
        ) SELECT source,currency,state,sum(amount)::text AS "amountCents",count(*)::int AS entries
          FROM usage GROUP BY source,currency,state ORDER BY source,currency,state`;
        const { population, ...funnel } = counts;
        const missing = ["final_provider_charges"];
        if (new Set(commitments.map((x) => x.currency)).size > 1) missing.push("multiple_currencies");
        if (commitments.some((x) => x.state === "unknown" || x.state === "reserved")) missing.push("unsettled_usage");
        return {
          ...funnel,
          campaignId: campaign ?? null,
          from: from.toISOString(),
          to: to.toISOString(),
          updatedAt,
          responseRate: {
            numerator: funnel.uniqueReplies,
            denominator: population,
            population: "unique_delivered_endpoints",
            cohortUpdatedAt: updatedAt,
          },
          costs: { totals: [], commitments, coverage: commitments.length ? "partial" : "unknown", missing },
        };
      },
      { isolationLevel: "RepeatableRead" }
    );
  }
}
