import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { Prisma, type PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import { PRISMA_CROSS_MERCHANT_CLIENT } from "../../shared/persistence/persistence.module.js";

export type CostQuery = { from?: string; to?: string; q?: string; merchantId?: string; accountId?: string; provider?: string; model?: string; source?: string; costCenter?: string; costStatus?: string; payer?: string; group?: string; page?: string; cursor?: string; teamId?:string; actorId?:string };
type Row = Record<string, any>;
const sums = Prisma.sql`COUNT(*)::text AS calls, COALESCE(SUM(u.prompt_tokens::bigint),0)::text AS "inputTokens", COALESCE(SUM(u.completion_tokens::bigint),0)::text AS "outputTokens",
 COUNT(DISTINCT u.voice_session_id)::text AS "voiceSessions", COUNT(*) FILTER(WHERE NOT u.usage_known AND u.execution_status <> 'rejected')::text AS pending,
 COUNT(*) FILTER(WHERE u.usage_known AND u.cost_micros IS NULL)::text AS unpriced, COUNT(*) FILTER(WHERE u.execution_status='rejected')::text AS rejected`;
const costs = Prisma.sql`COALESCE(SUM(u.cost_micros),0)::text AS "costMicros",
 COALESCE(SUM(u.cost_micros) FILTER(WHERE u.cost_center <> 'voice'),0)::text AS "textCostMicros",
 COALESCE(SUM(u.cost_micros) FILTER(WHERE u.cost_center = 'voice'),0)::text AS "voiceCostMicros",
 COALESCE(SUM(CASE WHEN u.component='transcription' THEN u.cost_micros ELSE u.audio_cost_micros END),0)::text AS "audioCostMicros",
 COALESCE(SUM(u.cost_micros) FILTER(WHERE u.cost_status='estimated'),0)::text AS "estimatedMicros",
 COALESCE(SUM(u.cost_micros) FILTER(WHERE u.cost_status='provider_reported'),0)::text AS "providerReportedMicros",
 COALESCE(SUM(u.cost_micros) FILTER(WHERE u.cost_status='reconciled'),0)::text AS "reconciledMicros"`;
@Injectable()
export class AiCostsReader {
  constructor(@Inject(PRISMA_CROSS_MERCHANT_CLIENT) private readonly db: PrismaClient) {}
  async report(query: CostQuery) {
    const f = filters(query), account = query.group === "account", page = pageNumber(query.page), limit = 30;
    const groupId = account ? Prisma.sql`COALESCE(u.billing_account_id,u.merchant_id)` : Prisma.sql`u.merchant_id`;
    // All reads use one repeatable snapshot; header totals never sum only the visible page.
    return this.db.$transaction(async tx => {
      const base = Prisma.sql`FROM ai_usage_events u LEFT JOIN merchants m ON m.id=u.merchant_id LEFT JOIN merchants a ON a.id=u.billing_account_id WHERE ${f.where}`;
      const [summary] = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT ${sums} ${base}`);
      const currencies = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT u.currency, ${costs} ${base} AND u.currency IS NOT NULL AND u.cost_micros IS NOT NULL GROUP BY u.currency ORDER BY u.currency`);
      const [count] = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT COUNT(DISTINCT ${groupId})::text AS total ${base}`);
      const companies = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT ${groupId} AS id, MAX(${account ? Prisma.sql`COALESCE(a.name,m.name)` : Prisma.sql`m.name`}) AS name,
        COUNT(DISTINCT u.merchant_id)::text AS stores, ${sums}, COALESCE(SUM(u.cost_micros) FILTER(WHERE u.currency='USD'),0)::text AS "usdCostMicros"
        ${base} GROUP BY ${groupId} ORDER BY COALESCE(SUM(u.cost_micros) FILTER(WHERE u.currency='USD'),0) DESC, ${groupId} ASC LIMIT ${limit} OFFSET ${(page-1)*limit}`);
      const companyCosts = companies.length ? await tx.$queryRaw<Row[]>(Prisma.sql`SELECT ${groupId} AS id, u.currency, ${costs} ${base}
        AND ${groupId} IN (${Prisma.join(companies.map(c=>c.id))}) AND u.currency IS NOT NULL AND u.cost_micros IS NOT NULL GROUP BY ${groupId},u.currency`) : [];
      const daily = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT to_char(u.started_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo','YYYY-MM-DD') AS day, u.currency, ${costs}
        ${base} AND u.currency IS NOT NULL AND u.cost_micros IS NOT NULL GROUP BY day,u.currency ORDER BY day,u.currency`);
      const breakdown = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT u.source,u.provider,u.model,u.currency, ${sums}, ${costs} ${base}
        GROUP BY u.source,u.provider,u.model,u.currency ORDER BY COUNT(*) DESC,u.source,u.provider,u.model LIMIT 100`);
      const voiceTerms=[Prisma.sql`s.started_at >= ${f.from} AND s.started_at < ${f.to}`,
        Prisma.sql`(s.state IN ('unknown','unobservable') OR (s.state='negotiating' AND s.started_at < now()-interval '1 minute') OR (s.state='active' AND s.started_at < now()-interval '35 minutes'))`];
      for (const [key,column] of Object.entries({merchantId:Prisma.sql`s.merchant_id`,accountId:Prisma.sql`s.billing_account_id`,model:Prisma.sql`s.model`,source:Prisma.sql`s.source`})) if(query[key as keyof CostQuery])voiceTerms.push(Prisma.sql`${column} = ${query[key as keyof CostQuery]}`);
      if((query.provider&&query.provider!=="openai")||(query.costCenter&&query.costCenter!=="voice")||query.payer==="merchant")voiceTerms.push(Prisma.sql`false`);
      if(query.q){const term="%"+query.q.replace(/[\\%_]/g,"\\$&")+"%";voiceTerms.push(Prisma.sql`(m.name ILIKE ${term} OR a.name ILIKE ${term} OR s.merchant_id = ${query.q})`);}
      const [voiceCoverage]=await tx.$queryRaw<Row[]>(Prisma.sql`SELECT COUNT(*)::text AS count FROM ai_voice_usage_sessions s LEFT JOIN merchants m ON m.id=s.merchant_id LEFT JOIN merchants a ON a.id=s.billing_account_id WHERE ${Prisma.join(voiceTerms," AND ")}`);
      return { period: { from: f.from.toISOString(), to: f.to.toISOString(), endExclusive: true, timezone: "America/Sao_Paulo" }, generatedAt: new Date().toISOString(),
        summary: { ...summary, costs: currencies }, companies: companies.map(c => ({ ...c, costs: companyCosts.filter(x => x.id === c.id) })), companiesTotal: count?.total ?? "0", page, limit, daily, breakdown,
        coverage: { collection: "server", incompleteVoiceSessions:voiceCoverage?.count??"0", history: "Recorded usage only. Missing usage and missing prices are shown separately.", currency: "Original currency; estimates are not reconciled invoices." } };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 15_000 });
  }
  async events(query: CostQuery, limit = 50) {
    const f = filters(query), hash = filterHash(query);
    let cursor = Prisma.empty;
    if (query.cursor) {
      try {
        if (query.cursor.length > 1000) throw Error();
        const c = JSON.parse(Buffer.from(query.cursor,"base64url").toString());
        if (c.hash !== hash || typeof c.id !== "string" || c.id.length > 200 || !validInstant(c.at)) throw Error();
        cursor = Prisma.sql`AND (u.started_at,u.id) < (${new Date(c.at)},${c.id})`;
      } catch { throw new BadRequestException("ai_costs_invalid_cursor"); }
    }
    const rows = await this.db.$queryRaw<Row[]>(Prisma.sql`SELECT u.id,u.merchant_id AS "merchantId",m.name AS "merchantName",u.billing_account_id AS "accountId",
      u.started_at AS at,u.source,u.provider,u.model,u.requested_model AS "requestedModel",u.channel,u.component,u.cost_center AS "costCenter",u.payer,
      u.actor_id AS "actorId",u.actor_role AS "actorRole",u.team_id AS "teamId",u.task_id AS "taskId",
      u.execution_status AS status,u.usage_known AS "usageKnown",u.prompt_tokens AS "inputTokens",u.completion_tokens AS "outputTokens",u.total_tokens AS "totalTokens",
      u.input_details AS "inputDetails",u.output_details AS "outputDetails",u.cost_micros::text AS "costMicros",u.audio_cost_micros::text AS "audioCostMicros",u.currency,u.cost_status AS "costStatus",u.pricing_version AS "pricingVersion",
      u.conversation_id AS "conversationId",u.voice_session_id AS "voiceSessionId",u.provider_event_id AS "providerEventId",u.measurement_origin AS "measurementOrigin",u.latency_ms AS "latencyMs"
      FROM ai_usage_events u LEFT JOIN merchants m ON m.id=u.merchant_id LEFT JOIN merchants a ON a.id=u.billing_account_id
      WHERE ${f.where} ${cursor} ORDER BY u.started_at DESC,u.id DESC LIMIT ${limit+1}`);
    const hasMore = rows.length > limit, items = rows.slice(0,limit), last = items.at(-1);
    return { items, nextCursor: hasMore && last ? Buffer.from(JSON.stringify({ at: last.at.toISOString(), id: last.id, hash })).toString("base64url") : null };
  }
  async audit(actorOperatorId: string, action: string, query: CostQuery) {
    const f = filters(query);
    await this.db.platformAuditEvent.create({ data: { actorOperatorId, action, permission: "platform:ai-usage:read", environment: process.env.APP_ENV ?? process.env.NODE_ENV ?? "unknown",
      targetType: "ai_costs", targetId: query.merchantId ?? query.accountId, correlationId: crypto.randomUUID(), outcome: "succeeded",
      details: { from: f.from.toISOString(), to: f.to.toISOString(), filters: Object.fromEntries(Object.entries(query).filter(([k]) => !["cursor","q"].includes(k))) } } });
  }
}
function validInstant(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) return false;
  const canonical=value.includes(".")?value.replace(/\.(\d{1,3})Z$/,(_,part:string)=>"."+part.padEnd(3,"0")+"Z"):value.replace("Z",".000Z");
  return new Date(value).toISOString()===canonical;
}
function filters(q: CostQuery) {
  const to = q.to === undefined ? new Date() : validInstant(q.to) ? new Date(q.to) : undefined;
  const from = q.from === undefined && to ? new Date(to.getTime()-30*86400000) : validInstant(q.from) ? new Date(q.from) : undefined;
  if (!to || !from || from >= to || to.getTime()-from.getTime() > 366*86400000) throw new BadRequestException("ai_costs_invalid_period");
  const terms = [Prisma.sql`u.started_at >= ${from} AND u.started_at < ${to}`, Prisma.sql`u.payer = ${q.payer === "merchant" ? "merchant" : "platform"}`,
    Prisma.sql`u.measurement_origin IN ('server_http','server_sideband')`];
  const columns: Record<string,Prisma.Sql> = { teamId: Prisma.sql`u.team_id`, actorId: Prisma.sql`u.actor_id`, merchantId: Prisma.sql`u.merchant_id`, accountId: Prisma.sql`u.billing_account_id`, provider: Prisma.sql`u.provider`, model: Prisma.sql`u.model`, source: Prisma.sql`u.source`, costCenter: Prisma.sql`u.cost_center`, costStatus: Prisma.sql`u.cost_status` };
  for (const [key,column] of Object.entries(columns)) { const value = q[key as keyof CostQuery]; if (value !== undefined && value !== "") { if (typeof value !== "string" || value.length > 200) throw new BadRequestException("ai_costs_invalid_filter"); terms.push(Prisma.sql`${column} = ${value}`); } }
  if (q.q) { if (typeof q.q !== "string" || q.q.length > 100) throw new BadRequestException("ai_costs_invalid_search"); const value = "%"+q.q.replace(/[\\%_]/g,"\\$&")+"%"; terms.push(Prisma.sql`(m.name ILIKE ${value} OR a.name ILIKE ${value} OR u.merchant_id = ${q.q})`); }
  return { where: Prisma.join(terms," AND "), from, to };
}
function pageNumber(value?: string) { const page = Number(value ?? "1"); if (!Number.isInteger(page) || page < 1 || page > 10000) throw new BadRequestException("ai_costs_invalid_page"); return page; }
function filterHash(query: CostQuery) { return createHash("sha256").update(JSON.stringify(Object.fromEntries(Object.entries(query).filter(([k])=>!["cursor","page"].includes(k)).sort(([a],[b])=>a.localeCompare(b))))).digest("hex").slice(0,24); }
export function csvCell(value: unknown) { let text = value == null ? "" : String(value); if (/^[\s]*[=+@-]/.test(text)) text = "'"+text; return '"'+text.replace(/"/g,'""')+'"'; }
