import { Prisma, type PrismaClient } from "@prisma/client";
import type { ProspectMetrics, ProspectMetricsQuery } from "@zyon/shared-types";

type Counts = Pick<ProspectMetrics,"leads"|"attempts"|"accepted"|"delivered"|"uniqueReplies"|"signups"|"trials"|"paidSubscriptions"|"refundedSubscriptions"> & { population: number };
type Commitment = ProspectMetrics["costs"]["commitments"][number];

function instant(value:string) {
  if(typeof value!=="string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) throw Error("invalid_filter:period");
  const date = new Date(value);
  if(!Number.isFinite(+date) || date.toISOString().slice(0,19)!==value.slice(0,19)) throw Error("invalid_filter:period");
  return date;
}

export class ProspectMetricsQueryService {
  constructor(private readonly db:PrismaClient, private readonly clock=()=>new Date()) {}
  async execute(input:ProspectMetricsQuery):Promise<ProspectMetrics> {
    const from=instant(input.from), to=instant(input.to), updatedAt=this.clock().toISOString();
    if(from>=to) throw Error("invalid_filter:period");
    const campaign=input.campaignId;
    return this.db.$transaction(async tx=>{
      if(campaign && !await tx.prospectCampaign.findUnique({where:{id:campaign},select:{id:true}})) throw Error("campaign_not_found");
      // Campaign attempts may also appear as transcript messages. Include each dispatch once.
      const outbound=Prisma.sql`outbound AS (
        SELECT r.campaign_id, s.endpoint_id, a.submitted_at, a.accepted_at, a.delivered_at, a.read_at,
          a.state, a.cost_state, a.currency, a.reserved_amount, a.created_at
        FROM outreach_attempts a JOIN prospect_sequences s ON s.id=a.sequence_id LEFT JOIN campaign_recipients r ON r.id=a.recipient_id
        ${campaign?Prisma.sql`WHERE r.campaign_id=${campaign}`:Prisma.empty}
        UNION ALL
        SELECT m.campaign_id,c.endpoint_id,m.submitted_at,m.accepted_at,m.delivered_at,m.read_at,
          m.state,m.cost_state,'BRL',m.reserved_amount,m.created_at
        FROM prospect_messages m JOIN prospect_conversations c ON c.id=m.conversation_id
        WHERE m.direction='outbound' AND m.attempt_id IS NULL ${campaign?Prisma.sql`AND m.campaign_id=${campaign}`:Prisma.empty}
      )`;
      const [counts]=await tx.$queryRaw<Counts[]>`WITH ${outbound},
        cohort AS (
          SELECT endpoint_id,min(coalesce(delivered_at,read_at)) AS first_delivery
          FROM outbound WHERE coalesce(delivered_at,read_at)>=${from} AND coalesce(delivered_at,read_at)<${to}
          GROUP BY endpoint_id
        ),
        responders AS (
          SELECT DISTINCT c.endpoint_id FROM prospect_messages m
          JOIN prospect_conversations c ON c.id=m.conversation_id JOIN cohort p ON p.endpoint_id=c.endpoint_id
          WHERE m.direction='inbound' AND m.author_type='prospect'
          AND m.provider_occurred_at>=p.first_delivery AND m.provider_occurred_at<${to}
        ),
        conversions AS (
          SELECT v.* FROM prospect_conversions v WHERE v.occurred_at>=${from} AND v.occurred_at<${to}
          ${campaign?Prisma.sql`AND EXISTS (SELECT 1 FROM prospect_outbox o JOIN prospect_messages m ON m.id=o.payload->>'messageId'
            WHERE o.kind='prospect.chat.dispatch' AND o.event_id='chat.'||m.id AND o.payload->>'proposalId'=v.proposal_id
            AND m.conversation_id=o.payload->>'conversationId' AND m.campaign_id=${campaign})`:Prisma.empty}
        ),
        net_paid AS (
          SELECT v.* FROM conversions v WHERE v.state='paid' AND NOT EXISTS (
            SELECT 1 FROM prospect_conversions refund WHERE refund.state='refunded' AND refund.provider=v.provider
            AND refund.subscription_id=v.subscription_id AND refund.proposal_id=v.proposal_id AND refund.occurred_at<${to})
        )
        SELECT (SELECT count(DISTINCT p.id)::int FROM platform_prospects p
          ${campaign?Prisma.sql`JOIN campaign_recipients r ON r.prospect_id=p.id WHERE r.campaign_id=${campaign} AND r.created_at>=${from} AND r.created_at<${to}`
            :Prisma.sql`WHERE p.created_at>=${from} AND p.created_at<${to}`}) AS leads,
        count(*) FILTER(WHERE submitted_at>=${from} AND submitted_at<${to})::int AS attempts,
        count(*) FILTER(WHERE coalesce(accepted_at,delivered_at,read_at)>=${from} AND coalesce(accepted_at,delivered_at,read_at)<${to})::int AS accepted,
        count(*) FILTER(WHERE coalesce(delivered_at,read_at)>=${from} AND coalesce(delivered_at,read_at)<${to})::int AS delivered,
        (SELECT count(*)::int FROM responders) AS "uniqueReplies", (SELECT count(*)::int FROM cohort) AS population,
        (SELECT count(DISTINCT merchant_id)::int FROM conversions WHERE state='signup') AS signups,
        (SELECT count(DISTINCT merchant_id)::int FROM conversions WHERE state='trial') AS trials,
        (SELECT count(*)::int FROM net_paid) AS "paidSubscriptions",
        (SELECT count(*)::int FROM conversions WHERE state='refunded') AS "refundedSubscriptions"
        FROM outbound`;
      const commitments=await tx.$queryRaw<Commitment[]>`WITH ${outbound}, usage AS (
        SELECT 'meta' AS source,currency,cost_state AS state,reserved_amount AS amount FROM outbound
          WHERE created_at>=${from} AND created_at<${to} AND cost_state IN ('reserved','unknown','committed')
        UNION ALL SELECT 'model','BRL',state,amount_cents FROM prospect_model_usage
          WHERE created_at>=${from} AND created_at<${to} ${campaign?Prisma.sql`AND campaign_id=${campaign}`:Prisma.empty}
        ) SELECT source,currency,state,sum(amount)::text AS "amountCents",count(*)::int AS entries
          FROM usage GROUP BY source,currency,state ORDER BY source,currency,state`;
      const {population,...funnel}=counts;
      const missing=["final_provider_charges"];
      if(new Set(commitments.map(x=>x.currency)).size>1) missing.push("multiple_currencies");
      if(commitments.some(x=>x.state==="unknown"||x.state==="reserved")) missing.push("unsettled_usage");
      return {...funnel,campaignId:campaign??null,from:from.toISOString(),to:to.toISOString(),updatedAt,
        responseRate:{numerator:funnel.uniqueReplies,denominator:population,population:"unique_delivered_endpoints",cohortUpdatedAt:updatedAt},
        costs:{totals:[],commitments,coverage:commitments.length?"partial":"unknown",missing}};
    },{isolationLevel:"RepeatableRead"});
  }
}
