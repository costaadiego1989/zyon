import { Inject, Injectable } from "@nestjs/common";
import { Prisma, type PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import type { MarketplaceOperationalAlert, OperationalAlertDeliveryClaim, OperationalAlertDeliveryResult } from "../../domain/marketplace-operational-alert.js";

@Injectable()
export class PrismaMarketplaceOperationalAlertRepository {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}
  async receive(alerts: MarketplaceOperationalAlert[], now: Date) {
    return this.prisma.$transaction(async tx => {
      let accepted = 0;
      for (const alert of alerts) {
        const inserted = await tx.$executeRaw`INSERT INTO marketplace_operational_alerts
          (id,merchant_id,alert_name,fingerprint,starts_at,state,severity,dimensions,created_at)
          VALUES (${alert.id},${alert.merchantId},${alert.alertName},${alert.fingerprint},${alert.startsAt},${alert.state},${alert.severity},${JSON.stringify(alert.dimensions)}::jsonb,${now})
          ON CONFLICT (id) DO NOTHING`;
        if (!inserted) continue;
        for (const channel of ["dashboard", "email", "whatsapp"] as const) {
          await tx.$executeRaw`INSERT INTO marketplace_operational_alert_deliveries (id,alert_id,channel,next_attempt_at,created_at,updated_at)
            VALUES (${alert.id + ":" + channel},${alert.id},${channel},${now},${now},${now})`;
        }
        await tx.outboxMessage.create({ data: { eventId: alert.id, eventType: "marketplace.operational_alert.received", schemaVersion: 1,
          merchantId: alert.merchantId, occurredAt: now, correlationId: alert.id, causationId: alert.id,
          producer: "notifications", payload: { alertId: alert.id, state: alert.state } } });
        accepted++;
      }
      return { accepted, duplicate: alerts.length - accepted };
    });
  }
  async verifyEvent(eventId: string, merchantId: string, state: string) {
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`SELECT id FROM marketplace_operational_alerts WHERE id=${eventId} AND merchant_id=${merchantId} AND state=${state}`;
    return rows.length === 1;
  }
  async expireSending(now: Date) {
    await this.prisma.$executeRaw`UPDATE marketplace_operational_alert_deliveries SET status='failed',lease_token=NULL,lease_until=NULL,
      last_error='preparation_attempts_exhausted',updated_at=${now} WHERE status='processing' AND attempts>=12 AND lease_until<=${now}`;
    const dashboard = await this.prisma.$executeRaw`UPDATE marketplace_operational_alert_deliveries
      SET status=CASE WHEN attempts>=12 THEN 'failed' ELSE 'retryable_failed' END,lease_token=NULL,lease_until=NULL,next_attempt_at=${now},
      last_error='dashboard_persistence_unavailable_after_restart',updated_at=${now}
      WHERE status='sending' AND channel='dashboard' AND lease_until<=${now}`;
    const external = await this.prisma.$executeRaw`UPDATE marketplace_operational_alert_deliveries SET status='unknown',lease_token=NULL,lease_until=NULL,
      last_error='provider_acceptance_unknown_after_restart',updated_at=${now} WHERE status='sending' AND channel IN ('email','whatsapp') AND lease_until<=${now}`;
    return dashboard + external;
  }
  async claim(now: Date): Promise<OperationalAlertDeliveryClaim | null> {
    const token = randomUUID(), leaseUntil = new Date(now.getTime() + 90000);
    const rows = await this.prisma.$queryRaw<any[]>(Prisma.sql`WITH candidate AS (
      SELECT d.id FROM marketplace_operational_alert_deliveries d JOIN outbox_messages o ON o.event_id=d.alert_id
      WHERE o.status='delivered' AND o.event_type='marketplace.operational_alert.received' AND o.schema_version=1
        AND o.merchant_id=(SELECT merchant_id FROM marketplace_operational_alerts WHERE id=d.alert_id)
        AND o.payload->>'alertId'=d.alert_id AND o.payload->>'state'=(SELECT state FROM marketplace_operational_alerts WHERE id=d.alert_id)
        AND d.attempts<12 AND d.next_attempt_at<=${now} AND
        ((d.status IN ('pending','retryable_failed') AND d.lease_until IS NULL) OR (d.status='processing' AND d.lease_until<=${now}))
      ORDER BY d.next_attempt_at,d.channel,d.id FOR UPDATE OF d SKIP LOCKED LIMIT 1
    ), claimed AS (UPDATE marketplace_operational_alert_deliveries d SET status='processing',attempts=d.attempts+1,
      lease_token=${token},lease_until=${leaseUntil},updated_at=${now} FROM candidate c WHERE d.id=c.id RETURNING d.*)
    SELECT d.id AS delivery_id,d.channel,d.attempts,d.lease_token,d.lease_until,a.* FROM claimed d JOIN marketplace_operational_alerts a ON a.id=d.alert_id`);
    if (!rows.length) return null;
    const r = rows[0];
    return { id: r.delivery_id, channel: r.channel, attempts: r.attempts, leaseToken: r.lease_token, leaseUntil: new Date(r.lease_until),
      alert: { id: r.id, merchantId: r.merchant_id, alertName: r.alert_name, fingerprint: r.fingerprint,
        startsAt: new Date(r.starts_at), state: r.state, severity: r.severity, dimensions: r.dimensions } };
  }
  async begin(claim: OperationalAlertDeliveryClaim, now: Date) {
    return (await this.prisma.$executeRaw`UPDATE marketplace_operational_alert_deliveries SET status='sending',updated_at=${now}
      WHERE id=${claim.id} AND status='processing' AND attempts=${claim.attempts} AND lease_token=${claim.leaseToken} AND lease_until>${now}`) === 1;
  }
  async finish(claim: OperationalAlertDeliveryClaim, result: OperationalAlertDeliveryResult, now: Date) {
    const delay = [60000,300000,900000,3600000][Math.min(claim.attempts - 1,3)];
    const next = result.status === "retryable_failed" ? new Date(now.getTime() + delay) : now;
    return (await this.prisma.$executeRaw`UPDATE marketplace_operational_alert_deliveries SET status=${result.status},lease_token=NULL,lease_until=NULL,
      last_error=${result.reason ?? null},provider_message_id=${result.providerMessageId ?? null},next_attempt_at=${next},updated_at=${now}
      WHERE id=${claim.id} AND status IN ('processing','sending') AND attempts=${claim.attempts} AND lease_token=${claim.leaseToken} AND lease_until>${now}`) === 1;
  }
  async deliveryMetrics() {
    return this.prisma.$queryRaw<Array<{ channel: string; status: string; count: bigint; oldest_seconds: number }>>`
      SELECT channel,status,count(*) AS count,EXTRACT(EPOCH FROM (NOW()-min(created_at)))::double precision AS oldest_seconds
      FROM marketplace_operational_alert_deliveries GROUP BY channel,status`;
  }
}
