import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { Prisma, type PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../shared/persistence/persistence.module.js";
import { normalizePeriod, type FinancePeriodInput } from "../dashboard/application/finance-dashboard.use-case.js";

type Totals = {
  requests: string; measured_requests: string; pending_requests: string; rejected_requests: string;
  input_tokens: string; output_tokens: string;
  text_input_tokens: string; text_output_tokens: string; audio_input_tokens: string; audio_output_tokens: string;
};
// Modality details are subsets of the provider totals, never extra tokens.
const totals = Prisma.sql`COUNT(*)::text AS requests,
 COUNT(*) FILTER (WHERE u.usage_known)::text AS measured_requests,
 COUNT(*) FILTER (WHERE NOT u.usage_known AND u.execution_status <> 'rejected')::text AS pending_requests,
 COUNT(*) FILTER (WHERE u.execution_status = 'rejected')::text AS rejected_requests,
 COALESCE(SUM(u.prompt_tokens::bigint) FILTER (WHERE u.usage_known),0)::text AS input_tokens,
 COALESCE(SUM(u.completion_tokens::bigint) FILTER (WHERE u.usage_known),0)::text AS output_tokens,
 COALESCE(SUM(COALESCE((u.input_details->>'text_tokens')::bigint,CASE WHEN u.channel='text' THEN u.prompt_tokens::bigint - COALESCE((u.input_details->>'audio_tokens')::bigint,0) - COALESCE((u.input_details->>'image_tokens')::bigint,0) ELSE 0 END)) FILTER (WHERE u.usage_known),0)::text AS text_input_tokens,
 COALESCE(SUM(COALESCE((u.output_details->>'text_tokens')::bigint,CASE WHEN u.channel='text' THEN u.completion_tokens::bigint - COALESCE((u.output_details->>'audio_tokens')::bigint,0) ELSE 0 END)) FILTER (WHERE u.usage_known),0)::text AS text_output_tokens,
 COALESCE(SUM((u.input_details->>'audio_tokens')::bigint) FILTER (WHERE u.usage_known),0)::text AS audio_input_tokens,
 COALESCE(SUM((u.output_details->>'audio_tokens')::bigint) FILTER (WHERE u.usage_known),0)::text AS audio_output_tokens`;

@Injectable()
export class MerchantAiUsageReader {
  constructor(@Inject(PRISMA_CLIENT) private readonly db: PrismaClient) {}

  async report(merchantId: string, input: FinancePeriodInput) {
    if (!merchantId?.trim()) throw new BadRequestException("missing_merchant_id");
    const period = normalizePeriod(input);
    // Raw SQL always includes the authenticated store. No account-wide or client-supplied tenant filter.
    const measured = Prisma.sql`u.merchant_id=${merchantId} AND u.measurement_origin IN ('server_http','server_sideband')`;
    const inPeriod = Prisma.sql`${measured} AND u.started_at >= ${period.start} AND u.started_at < ${period.endExclusive}`;
    return this.db.$transaction(async tx => {
      const [summary] = await tx.$queryRaw<Totals[]>(Prisma.sql`SELECT ${totals} FROM ai_usage_events u WHERE ${inPeriod}`);
      const daily = await tx.$queryRaw<Array<Totals & { date: string }>>(Prisma.sql`SELECT
        to_char(u.started_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo','YYYY-MM-DD') AS date, ${totals}
        FROM ai_usage_events u WHERE ${inPeriod} GROUP BY date ORDER BY date`);
      const [voice] = await tx.$queryRaw<Array<{ sessions: string; incomplete_sessions: string }>>(Prisma.sql`
        WITH activity AS (
          SELECT u.voice_session_id AS id FROM ai_usage_events u WHERE ${inPeriod}
            AND u.voice_session_id IS NOT NULL AND u.execution_status <> 'rejected'
          UNION
          SELECT s.id FROM ai_voice_usage_sessions s WHERE s.merchant_id=${merchantId}
            AND s.started_at >= ${period.start} AND s.started_at < ${period.endExclusive} AND s.state NOT IN ('failed','rejected')
        ), observed AS (
          SELECT DISTINCT e.voice_session_id AS id FROM ai_usage_events e INNER JOIN activity a ON a.id=e.voice_session_id
          WHERE e.merchant_id=${merchantId} AND e.usage_known AND e.measurement_origin IN ('server_http','server_sideband')
        ) SELECT COUNT(*)::text AS sessions,
          COUNT(*) FILTER (WHERE s.state IN ('unknown','unobservable')
            OR (s.state='negotiating' AND s.started_at < now()-interval '1 minute')
            OR (s.state='active' AND s.started_at < now()-interval '35 minutes')
            OR (s.state='closed' AND o.id IS NULL))::text AS incomplete_sessions
        FROM activity a LEFT JOIN ai_voice_usage_sessions s ON s.id=a.id AND s.merchant_id=${merchantId}
        LEFT JOIN observed o ON o.id=a.id`);
      const [history] = await tx.$queryRaw<Array<{ first_recorded_at: Date | null }>>(Prisma.sql`
        SELECT MIN(u.started_at) AS first_recorded_at FROM ai_usage_events u WHERE ${measured}`);
      return {
        period: { from: period.from, to: period.to, time_zone: period.time_zone },
        generated_at: new Date().toISOString(),
        summary: { ...summary, voice_sessions: voice!.sessions },
        daily,
        coverage: {
          first_recorded_at: history!.first_recorded_at?.toISOString() ?? null,
          incomplete_voice_sessions: voice!.incomplete_sessions,
          collection: "server" as const,
          // The observed ledger and the current admission counter have different coverage.
          voice_quota_comparable: false as const,
        },
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 15000 });
  }

  async csv(merchantId: string, input: FinancePeriodInput) {
    const report = await this.report(merchantId, input);
    const rows: string[][] = [
      ["Consumo observado de IA", report.period.from, report.period.to, report.period.time_zone],
      ["Uso informado pelos provedores; dados anteriores à coleta não são retroativos. Este arquivo não é uma fatura."],
      ["Sessões de voz com atividade no período", report.summary.voice_sessions],
      ["Sessões de voz com medição incompleta", report.coverage.incomplete_voice_sessions],
      ["As sessões observadas não representam o saldo de franquia do plano."],
      ["Data", "Requisições", "Com medição", "Sem medição", "Recusadas", "Tokens de entrada", "Tokens de saída", "Texto: entrada", "Texto: saída", "Áudio: entrada", "Áudio: saída"],
      ...report.daily.map(d => [d.date, d.requests, d.measured_requests, d.pending_requests, d.rejected_requests, d.input_tokens, d.output_tokens, d.text_input_tokens, d.text_output_tokens, d.audio_input_tokens, d.audio_output_tokens]),
    ];
    return "\uFEFF" + rows.map(row => row.map(value => '"' + value.replace(/"/g, '""') + '"').join(";")).join("\r\n");
  }
}
