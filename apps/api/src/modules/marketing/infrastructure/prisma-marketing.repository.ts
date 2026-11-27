import { Inject, Injectable } from "@nestjs/common";
import { Prisma, type PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../shared/persistence/persistence.module.js";
import {
  MarketingError,
  marketingDeliveryTransition,
  type MarketingCampaign,
  type MarketingConsent,
  type MarketingContact,
  type MarketingContactQuery,
  type MarketingConversation,
  type MarketingDeliveryStatus,
  type MarketingMessage,
  type MarketingRecipient,
  type MarketingSettings,
  type MarketingStageChange,
  type MarketingConversationFilters,
  type MarketingMessageCursor,
  type MarketingHistoryJob,
  type MarketingSuppression,
} from "../domain/marketing.js";
import type {
  MarketingRepository,
  MarketingTransaction,
} from "../domain/marketing.repository.js";

/** Only this adapter knows the module's table layout. All queries bind the tenant. */
class PrismaMarketingTransaction implements MarketingTransaction {
  constructor(
    private readonly db: Prisma.TransactionClient,
    private readonly merchantId: string
  ) {}
  private async one<T>(query: Prisma.Sql): Promise<T | null> {
    return (await this.many<T>(query))[0] ?? null;
  }
  private async many<T>(query: Prisma.Sql): Promise<T[]> {
    return (await this.db.$queryRaw<Array<{ data: T }>>(query)).map(
      (row) => row.data
    );
  }
  private owned(value: { merchantId: string }): void {
    if (value.merchantId !== this.merchantId)
      throw new MarketingError("marketing_tenant_mismatch", 404);
  }
  contact(id: string) {
    return this.one<MarketingContact>(
      Prisma.sql`SELECT data FROM marketing_contacts WHERE merchant_id=${this.merchantId} AND id=${id}::uuid FOR UPDATE`
    );
  }
  contactByIdentity(key: string) {
    return this.one<MarketingContact>(
      Prisma.sql`SELECT data FROM marketing_contacts WHERE merchant_id=${this.merchantId} AND identity_key=${key} FOR UPDATE`
    );
  }
  contactByAccount(id: string) {
    return this.one<MarketingContact>(
      Prisma.sql`SELECT data FROM marketing_contacts WHERE merchant_id=${this.merchantId} AND account_id=${id} FOR UPDATE`
    );
  }
  contactByPhone(phone: string) {
    return this.one<MarketingContact>(
      Prisma.sql`SELECT data FROM marketing_contacts WHERE merchant_id=${this.merchantId} AND phone=${phone} FOR UPDATE`
    );
  }
  async saveContact(c: MarketingContact) {
    this.owned(c);
    await this.db
      .$executeRaw`INSERT INTO marketing_contacts(merchant_id,id,identity_key,account_id,phone,stage,origin,updated_at,data)
      VALUES(${this.merchantId},${c.id}::uuid,${c.identityKey},${c.accountId},${
      c.phone
    },${c.stage},${c.origin},${new Date(c.lastSeenAt)},${JSON.stringify(
      c
    )}::jsonb)
      ON CONFLICT(merchant_id,id) DO UPDATE SET identity_key=EXCLUDED.identity_key,account_id=EXCLUDED.account_id,phone=EXCLUDED.phone,
      stage=EXCLUDED.stage,origin=EXCLUDED.origin,updated_at=EXCLUDED.updated_at,data=EXCLUDED.data`;
  }
  async contacts(q: MarketingContactQuery) {
    const clauses = [
      Prisma.sql`merchant_id=${this.merchantId}`,
      Prisma.sql`data->>'mergedInto' IS NULL`,
    ];
    if (q.stage) clauses.push(Prisma.sql`stage=${q.stage}`);
    if (q.origin) clauses.push(Prisma.sql`origin=${q.origin}`);
    if (q.channel)
      clauses.push(
        Prisma.sql`data->'channels' @> ${JSON.stringify([q.channel])}::jsonb`
      );
    if (q.buyer)
      clauses.push(
        q.buyer === "customer"
          ? Prisma.sql`(data->>'purchaseCount')::int>0`
          : Prisma.sql`(data->>'purchaseCount')::int=0`
      );
    if (q.interest)
      clauses.push(
        Prisma.sql`data->'interests' @> ${JSON.stringify([q.interest])}::jsonb`
      );
    if (q.search?.trim()) {
      const search = q.search.trim().toLowerCase();
      const digits = search.replace(/\D/g, "");
      clauses.push(Prisma.sql`(position(${search} in lower(coalesce(data->>'name','')||' '||coalesce(data->>'email','')))>0
        OR (${
          digits.length > 0
        } AND position(${digits} in coalesce(phone,''))>0))`);
    }
    const where = Prisma.join(clauses, " AND ");
    const count = await this.db.$queryRaw<Array<{ total: bigint }>>(
      Prisma.sql`SELECT count(*)::bigint total FROM marketing_contacts WHERE ${where}`
    );
    const items = await this.many<MarketingContact>(
      Prisma.sql`SELECT data FROM marketing_contacts WHERE ${where} ORDER BY updated_at DESC,id DESC LIMIT ${q.limit} OFFSET ${q.offset}`
    );
    return { items, total: Number(count[0].total) };
  }
  conversation(id: string) {
    return this.one<MarketingConversation>(
      Prisma.sql`SELECT data FROM marketing_conversations WHERE merchant_id=${this.merchantId} AND id=${id}::uuid FOR UPDATE`
    );
  }
  async funnel() {
    const rows = await this.db.$queryRaw<
      Array<{
        stage: MarketingContact["stage"];
        origin: MarketingContact["origin"];
        total: bigint;
      }>
    >`
      SELECT stage,origin,count(*)::bigint total FROM marketing_contacts WHERE merchant_id=${this.merchantId}
      AND data->>'mergedInto' IS NULL GROUP BY stage,origin`;
    return rows.map((row) => ({ ...row, total: Number(row.total) }));
  }
  async contactActivity(id: string) {
    const counts = await this.db.$queryRaw<
      Array<{ conversations: bigint; messages: bigint }>
    >`
      SELECT count(DISTINCT c.id)::bigint conversations,count(m.id)::bigint messages FROM marketing_conversations c
      LEFT JOIN marketing_messages m ON m.merchant_id=c.merchant_id AND m.conversation_id=c.id
      WHERE c.merchant_id=${this.merchantId} AND c.contact_id=${id}::uuid`;
    const conversations = await this
      .many<MarketingConversation>(Prisma.sql`SELECT data FROM marketing_conversations
      WHERE merchant_id=${this.merchantId} AND contact_id=${id}::uuid ORDER BY updated_at DESC,id DESC LIMIT 20`);
    return {
      conversationCount: Number(counts[0].conversations),
      messageCount: Number(counts[0].messages),
      conversations,
    };
  }
  conversationByExternal(channel: string, id: string) {
    return this.one<MarketingConversation>(
      Prisma.sql`SELECT data FROM marketing_conversations WHERE merchant_id=${this.merchantId} AND channel=${channel} AND external_id=${id} FOR UPDATE`
    );
  }
  latestConversation(id: string, channel: string) {
    return this.one<MarketingConversation>(
      Prisma.sql`SELECT data FROM marketing_conversations WHERE merchant_id=${this.merchantId} AND contact_id=${id}::uuid AND channel=${channel} ORDER BY updated_at DESC,id DESC LIMIT 1 FOR UPDATE`
    );
  }
  async conversations(
    limit: number,
    offset: number,
    filters: MarketingConversationFilters = {}
  ) {
    const clauses = [Prisma.sql`c.merchant_id=${this.merchantId}`];
    if (filters.channel) clauses.push(Prisma.sql`c.channel=${filters.channel}`);
    if (filters.mode) clauses.push(Prisma.sql`c.data->>'mode'=${filters.mode}`);
    if (filters.assignedUserId === null)
      clauses.push(Prisma.sql`c.data->>'assignedUserId' IS NULL`);
    else if (filters.assignedUserId)
      clauses.push(
        Prisma.sql`c.data->>'assignedUserId'=${filters.assignedUserId}`
      );
    if (filters.search?.trim()) {
      const term = filters.search.trim().toLowerCase();
      const digits = term.replace(/\D/g, "");
      clauses.push(Prisma.sql`(position(${term} in lower(coalesce(p.data->>'name','')||' '||coalesce(p.data->>'email','')))>0
        OR (${
          digits.length > 0
        } AND position(${digits} in coalesce(p.phone,''))>0))`);
    }
    const where = Prisma.join(clauses, " AND ");
    const join = Prisma.sql`FROM marketing_conversations c LEFT JOIN marketing_contacts p ON p.merchant_id=c.merchant_id AND p.id=c.contact_id`;
    const count = await this.db.$queryRaw<Array<{ total: bigint }>>(
      Prisma.sql`SELECT count(*)::bigint total ${join} WHERE ${where}`
    );
    const items = await this
      .many<MarketingConversation>(Prisma.sql`SELECT c.data||jsonb_build_object('contactName',p.data->>'name','phoneTail',right(p.phone,4)) data
      ${join} WHERE ${where} ORDER BY c.updated_at DESC,c.id DESC LIMIT ${limit} OFFSET ${offset}`);
    return { items, total: Number(count[0].total) };
  }
  async saveConversation(c: MarketingConversation) {
    this.owned(c);
    await this.db
      .$executeRaw`INSERT INTO marketing_conversations(merchant_id,id,channel,external_id,contact_id,updated_at,data)
      VALUES(${this.merchantId},${c.id}::uuid,${c.channel},${c.externalId},${
      c.contactId
    }::uuid,${new Date(c.updatedAt)},${JSON.stringify(c)}::jsonb)
      ON CONFLICT(merchant_id,id) DO UPDATE SET contact_id=EXCLUDED.contact_id,updated_at=EXCLUDED.updated_at,data=EXCLUDED.data`;
  }
  async mergeContacts(sourceId: string, targetId: string) {
    const source = await this.contact(sourceId);
    if (!source || sourceId === targetId) return;
    const target = await this.contact(targetId);
    if (!target) throw new MarketingError("marketing_contact_not_found", 404);
    // Identity consolidation must retain the quota already consumed by either
    // contact. Lock both keys in a deterministic order against all dispatchers.
    for (const key of [
      ...new Set([source.identityKey, target.identityKey]),
    ].sort())
      await this.lockCommercial(key);
    await this.db
      .$executeRaw`UPDATE marketing_commercial_dispatches SET contact_key=${target.identityKey}
      WHERE merchant_id=${this.merchantId} AND contact_key=${source.identityKey}`;
    const consents = await this.consents([sourceId, targetId]);
    const latest = consents.sort(
      (a, b) =>
        b.recordedAt.localeCompare(a.recordedAt) ||
        (a.status === "revoked" ? -1 : b.status === "revoked" ? 1 : 0)
    )[0];
    await this.db
      .$executeRaw`DELETE FROM marketing_consents WHERE merchant_id=${this.merchantId} AND contact_id=${sourceId}::uuid`;
    if (latest)
      await this.saveConsent({
        ...latest,
        id: consents.find((c) => c.contactId === targetId)?.id ?? latest.id,
        contactId: targetId,
      });
    await this.db
      .$executeRaw`UPDATE marketing_conversations SET contact_id=${targetId}::uuid,
      data=jsonb_set(data,'{contactId}',to_jsonb(${targetId}::text)) WHERE merchant_id=${this.merchantId} AND contact_id=${sourceId}::uuid`;
    await this.db
      .$executeRaw`UPDATE marketing_stage_history SET contact_id=${targetId}::uuid,
      data=jsonb_set(data,'{contactId}',to_jsonb(${targetId}::text)) WHERE merchant_id=${this.merchantId} AND contact_id=${sourceId}::uuid`;
    await this.db
      .$executeRaw`UPDATE marketing_purchase_receipts SET contact_id=${targetId}::uuid WHERE merchant_id=${this.merchantId} AND contact_id=${sourceId}::uuid`;
    // Previously attempted recipient rows remain immutable evidence. Pending
    // rows for the duplicate identity must not send after a verified merge.
    await this.db
      .$executeRaw`UPDATE marketing_campaign_recipients SET status='suppressed',
      data=data||'{"status":"suppressed","reason":"contact_identity_merged"}'::jsonb
      WHERE merchant_id=${this.merchantId} AND contact_id=${sourceId}::uuid AND status='queued'`;
    await this.saveContact({
      ...source,
      identityKey: `merged:${sourceId}`,
      accountId: null,
      phone: null,
      name: null,
      email: null,
      interests: [],
      mergedInto: targetId,
      version: source.version + 1,
    });
    await this.saveContact({
      ...target,
      purchaseCount: target.purchaseCount + source.purchaseCount,
      totalSpentCents: target.totalSpentCents + source.totalSpentCents,
      channels: [...new Set([...target.channels, ...source.channels])],
      firstSeenAt:
        source.firstSeenAt < target.firstSeenAt
          ? source.firstSeenAt
          : target.firstSeenAt,
      lastSeenAt:
        source.lastSeenAt > target.lastSeenAt
          ? source.lastSeenAt
          : target.lastSeenAt,
      origin:
        source.firstSeenAt < target.firstSeenAt && source.origin !== "unknown"
          ? source.origin
          : target.origin,
      lastPurchaseAt:
        !target.lastPurchaseAt ||
        (source.lastPurchaseAt && source.lastPurchaseAt > target.lastPurchaseAt)
          ? source.lastPurchaseAt
          : target.lastPurchaseAt,
      version: target.version + 1,
    });
  }
  async messages(id: string, limit = 100, before?: MarketingMessageCursor) {
    const cursor = before
      ? Prisma.sql`AND (created_at,sequence)<(${new Date(before.createdAt)},${
          before.sequence
        }::bigint)`
      : Prisma.empty;
    const messages = await this
      .many<MarketingMessage>(Prisma.sql`SELECT data||jsonb_build_object('sequence',sequence::text) data FROM marketing_messages
      WHERE merchant_id=${this.merchantId} AND conversation_id=${id}::uuid ${cursor} ORDER BY created_at DESC,sequence DESC LIMIT ${limit}`);
    return messages.reverse();
  }
  async appendMessage(m: MarketingMessage) {
    this.owned(m);
    return (
      (await this.db
        .$executeRaw`INSERT INTO marketing_messages(merchant_id,id,conversation_id,dedup_key,provider_message_id,created_at,data)
      VALUES(${this.merchantId},${m.id}::uuid,${m.conversationId}::uuid,${
        m.dedupKey
      },${m.providerMessageId},${new Date(m.createdAt)},${JSON.stringify(
        m
      )}::jsonb)
      ON CONFLICT(merchant_id,dedup_key) DO NOTHING`) === 1
    );
  }
  messageByKey(key: string) {
    return this.one<MarketingMessage>(
      Prisma.sql`SELECT data||jsonb_build_object('sequence',sequence::text) data FROM marketing_messages WHERE merchant_id=${this.merchantId} AND dedup_key=${key} FOR UPDATE`
    );
  }
  async saveMessage(m: MarketingMessage) {
    this.owned(m);
    await this.db
      .$executeRaw`UPDATE marketing_messages SET data=${JSON.stringify(
      m
    )}::jsonb,provider_message_id=${m.providerMessageId}
      WHERE merchant_id=${this.merchantId} AND id=${m.id}::uuid`;
  }
  consent(id: string) {
    return this.one<MarketingConsent>(
      Prisma.sql`SELECT data FROM marketing_consents WHERE merchant_id=${this.merchantId} AND contact_id=${id}::uuid AND channel='whatsapp' FOR UPDATE`
    );
  }
  consents(ids: string[]) {
    if (!ids.length) return Promise.resolve([]);
    return this.many<MarketingConsent>(
      Prisma.sql`SELECT data FROM marketing_consents WHERE merchant_id=${
        this.merchantId
      } AND contact_id IN (${Prisma.join(
        ids.map((id) => Prisma.sql`${id}::uuid`)
      )}) AND channel='whatsapp'`
    );
  }
  async saveConsent(c: MarketingConsent) {
    this.owned(c);
    await this.db
      .$executeRaw`INSERT INTO marketing_consents(merchant_id,id,contact_id,channel,recorded_at,data)
      VALUES(${this.merchantId},${c.id}::uuid,${c.contactId}::uuid,${
      c.channel
    },${new Date(c.recordedAt)},${JSON.stringify(c)}::jsonb)
      ON CONFLICT(merchant_id,contact_id,channel) DO UPDATE SET recorded_at=EXCLUDED.recorded_at,data=EXCLUDED.data WHERE marketing_consents.recorded_at<=EXCLUDED.recorded_at`;
  }
  stageHistory(id: string) {
    return this.many<MarketingStageChange>(
      Prisma.sql`SELECT data FROM marketing_stage_history WHERE merchant_id=${this.merchantId} AND contact_id=${id}::uuid ORDER BY occurred_at DESC,id DESC LIMIT 100`
    );
  }
  async appendStage(c: MarketingStageChange) {
    this.owned(c);
    await this.db
      .$executeRaw`INSERT INTO marketing_stage_history(merchant_id,id,contact_id,occurred_at,data) VALUES(${
      this.merchantId
    },${c.id}::uuid,${c.contactId}::uuid,${new Date(
      c.occurredAt
    )},${JSON.stringify(c)}::jsonb)`;
  }
  settings() {
    return this.one<MarketingSettings>(
      Prisma.sql`SELECT data FROM marketing_settings WHERE merchant_id=${this.merchantId} FOR UPDATE`
    );
  }
  async saveSettings(s: MarketingSettings) {
    this.owned(s);
    await this.db
      .$executeRaw`INSERT INTO marketing_settings(merchant_id,data) VALUES(${
      this.merchantId
    },${JSON.stringify(
      s
    )}::jsonb) ON CONFLICT(merchant_id) DO UPDATE SET data=EXCLUDED.data`;
  }
  campaign(id: string) {
    return this.one<MarketingCampaign>(
      Prisma.sql`SELECT data FROM marketing_campaigns WHERE merchant_id=${this.merchantId} AND id=${id}::uuid FOR UPDATE`
    );
  }
  campaigns() {
    return this.many<MarketingCampaign>(
      Prisma.sql`SELECT data FROM marketing_campaigns WHERE merchant_id=${this.merchantId} ORDER BY updated_at DESC,id DESC LIMIT 200`
    );
  }
  async saveCampaign(c: MarketingCampaign) {
    this.owned(c);
    await this.db
      .$executeRaw`INSERT INTO marketing_campaigns(merchant_id,id,status,scheduled_at,updated_at,data)
      VALUES(${this.merchantId},${c.id}::uuid,${c.status},${
      c.scheduledAt ? new Date(c.scheduledAt) : null
    },${new Date(c.updatedAt)},${JSON.stringify(c)}::jsonb)
      ON CONFLICT(merchant_id,id) DO UPDATE SET status=EXCLUDED.status,scheduled_at=EXCLUDED.scheduled_at,updated_at=EXCLUDED.updated_at,data=EXCLUDED.data`;
  }
  recipients(id: string) {
    return this.many<MarketingRecipient>(
      Prisma.sql`SELECT data FROM marketing_campaign_recipients WHERE merchant_id=${this.merchantId} AND campaign_id=${id}::uuid ORDER BY updated_at,id LIMIT 10000`
    );
  }
  recipient(id: string) {
    return this.one<MarketingRecipient>(
      Prisma.sql`SELECT data FROM marketing_campaign_recipients WHERE merchant_id=${this.merchantId} AND id=${id}::uuid FOR UPDATE`
    );
  }
  nextRecipient(id: string) {
    return this.one<MarketingRecipient>(
      Prisma.sql`SELECT data FROM marketing_campaign_recipients WHERE merchant_id=${this.merchantId} AND campaign_id=${id}::uuid AND status='queued' ORDER BY updated_at,id LIMIT 1 FOR UPDATE SKIP LOCKED`
    );
  }
  expiredRecipient(id: string, now: string) {
    return this.one<MarketingRecipient>(
      Prisma.sql`SELECT data FROM marketing_campaign_recipients WHERE merchant_id=${
        this.merchantId
      } AND campaign_id=${id}::uuid AND status='sending' AND lease_until<=${new Date(
        now
      )} LIMIT 1 FOR UPDATE SKIP LOCKED`
    );
  }
  async recipientCounts(id: string) {
    const counts: Record<string, number> = {
      queued: 0,
      sending: 0,
      accepted: 0,
      delivered: 0,
      read: 0,
      failed: 0,
      suppressed: 0,
      unknown: 0,
    };
    const rows = await this.db.$queryRaw<
      Array<{ status: string; total: bigint }>
    >`SELECT status,count(*)::bigint total FROM marketing_campaign_recipients WHERE merchant_id=${this.merchantId} AND campaign_id=${id}::uuid GROUP BY status`;
    for (const row of rows) counts[row.status] = Number(row.total);
    return counts;
  }
  async saveRecipient(r: MarketingRecipient) {
    this.owned(r);
    await this.db
      .$executeRaw`INSERT INTO marketing_campaign_recipients(merchant_id,id,campaign_id,contact_id,status,lease_until,provider_message_id,updated_at,data)
      VALUES(${this.merchantId},${r.id}::uuid,${r.campaignId}::uuid,${
      r.contactId
    }::uuid,${r.status},${r.leaseUntil ? new Date(r.leaseUntil) : null},${
      r.providerMessageId
    },${new Date(r.updatedAt)},${JSON.stringify(r)}::jsonb)
      ON CONFLICT(merchant_id,id) DO UPDATE SET status=EXCLUDED.status,lease_until=EXCLUDED.lease_until,provider_message_id=EXCLUDED.provider_message_id,updated_at=EXCLUDED.updated_at,data=EXCLUDED.data`;
  }
  async clearUnsentRecipients(id: string) {
    await this.db
      .$executeRaw`DELETE FROM marketing_campaign_recipients WHERE merchant_id=${this.merchantId} AND campaign_id=${id}::uuid AND status IN ('queued','suppressed') AND data->>'attemptedAt' IS NULL`;
  }
  async saveRecipients(rows: MarketingRecipient[]) {
    for (const r of rows) this.owned(r);
    if (!rows.length) return;
    await this.db
      .$executeRaw`INSERT INTO marketing_campaign_recipients(merchant_id,id,campaign_id,contact_id,status,lease_until,provider_message_id,updated_at,data)
      SELECT ${
        this.merchantId
      },(value->>'id')::uuid,(value->>'campaignId')::uuid,(value->>'contactId')::uuid,
      value->>'status',(value->>'leaseUntil')::timestamptz,value->>'providerMessageId',(value->>'updatedAt')::timestamptz,value
      FROM jsonb_array_elements(${JSON.stringify(
        rows
      )}::jsonb) ON CONFLICT(merchant_id,campaign_id,contact_id) DO NOTHING`;
  }
  async receipt(key: string, at: string) {
    return (
      (await this.db
        .$executeRaw`INSERT INTO marketing_event_receipts(merchant_id,event_key,occurred_at) VALUES(${
        this.merchantId
      },${key},${new Date(at)}) ON CONFLICT DO NOTHING`) === 1
    );
  }
  async purchase(
    orderId: string,
    contactId: string,
    amountCents: number,
    at: string
  ) {
    return (
      (await this.db
        .$executeRaw`INSERT INTO marketing_purchase_receipts(merchant_id,order_id,contact_id,amount_cents,occurred_at)
      VALUES(${
        this.merchantId
      },${orderId},${contactId}::uuid,${amountCents},${new Date(
        at
      )}) ON CONFLICT DO NOTHING`) === 1
    );
  }
  private async lockCommercial(key: string) {
    await this.db
      .$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${`${this.merchantId}:frequency:${key}`},0))`;
  }
  async reserveCommercial(
    key: string,
    dispatch: string,
    now: string,
    minHours: number,
    dailyMax: number
  ) {
    await this.lockCommercial(key);
    const replay = await this.db.$queryRaw<
      Array<{ present: number }>
    >`SELECT 1 present FROM marketing_commercial_dispatches WHERE merchant_id=${this.merchantId} AND dispatch_key=${dispatch}`;
    if (replay.length) return true;
    const recent = await this.db.$queryRaw<
      Array<{ last: Date | null; count: bigint }>
    >`SELECT max(reserved_at) last,
      count(*) FILTER(WHERE reserved_at>${new Date(
        Date.parse(now) - 86_400_000
      )})::bigint count FROM marketing_commercial_dispatches WHERE merchant_id=${
      this.merchantId
    } AND contact_key=${key}`;
    if (
      (recent[0].last &&
        Date.parse(now) - recent[0].last.getTime() < minHours * 3_600_000) ||
      Number(recent[0].count) >= dailyMax
    )
      return false;
    await this.db
      .$executeRaw`INSERT INTO marketing_commercial_dispatches(merchant_id,contact_key,dispatch_key,reserved_at) VALUES(${
      this.merchantId
    },${key},${dispatch},${new Date(now)})`;
    return true;
  }
  async commercialHistory(key: string) {
    const rows = await this.db.$queryRaw<
      Array<{ reserved_at: Date }>
    >`SELECT reserved_at FROM marketing_commercial_dispatches WHERE merchant_id=${this.merchantId} AND contact_key=${key} ORDER BY reserved_at DESC LIMIT 100`;
    return rows.map((r) => ({ reservedAt: r.reserved_at.toISOString() }));
  }
  async updateDelivery(providerId: string, status: string) {
    const accepted: MarketingDeliveryStatus[] = [
      "accepted",
      "delivered",
      "read",
      "failed",
    ];
    if (!accepted.includes(status as MarketingDeliveryStatus)) return 0;
    const recipients = await this.many<MarketingRecipient>(
      Prisma.sql`SELECT data FROM marketing_campaign_recipients WHERE merchant_id=${this.merchantId} AND provider_message_id=${providerId} FOR UPDATE`
    );
    for (const r of recipients)
      await this.saveRecipient({
        ...r,
        status: marketingDeliveryTransition(
          r.status,
          status as MarketingDeliveryStatus
        ),
      });
    const messages = await this.many<MarketingMessage>(
      Prisma.sql`SELECT data FROM marketing_messages WHERE merchant_id=${this.merchantId} AND provider_message_id=${providerId} FOR UPDATE`
    );
    for (const m of messages) {
      const data = {
        ...m,
        status: marketingDeliveryTransition(
          m.status,
          status as MarketingDeliveryStatus
        ),
      };
      await this.db
        .$executeRaw`UPDATE marketing_messages SET data=${JSON.stringify(
        data
      )}::jsonb WHERE merchant_id=${this.merchantId} AND id=${m.id}::uuid`;
    }
    return recipients.length + messages.length;
  }
  historyJob() {
    return this.one<MarketingHistoryJob>(
      Prisma.sql`SELECT data FROM marketing_history_jobs WHERE merchant_id=${this.merchantId} FOR UPDATE`
    );
  }
  async saveHistoryJob(job: MarketingHistoryJob) {
    this.owned(job);
    await this.db
      .$executeRaw`INSERT INTO marketing_history_jobs(merchant_id,status,updated_at,data)
      VALUES(${this.merchantId},${job.status},${new Date(
      job.updatedAt
    )},${JSON.stringify(job)}::jsonb)
      ON CONFLICT(merchant_id) DO UPDATE SET status=EXCLUDED.status,updated_at=EXCLUDED.updated_at,data=EXCLUDED.data`;
  }
  async appendMessages(messages: MarketingMessage[]) {
    if (!messages.length) return 0;
    for (const message of messages) this.owned(message);
    return this.db
      .$executeRaw`INSERT INTO marketing_messages(merchant_id,id,conversation_id,dedup_key,provider_message_id,created_at,data)
      SELECT ${
        this.merchantId
      },(item->>'id')::uuid,(item->>'conversationId')::uuid,item->>'dedupKey',item->>'providerMessageId',(item->>'createdAt')::timestamptz,item
      FROM jsonb_array_elements(${JSON.stringify(
        messages
      )}::jsonb) item ON CONFLICT(merchant_id,dedup_key) DO NOTHING`;
  }
  async liveMessageBoundary(id: string) {
    const rows = await this.db.$queryRaw<
      Array<{ at: Date | null }>
    >`SELECT min(created_at) at FROM marketing_messages
      WHERE merchant_id=${this.merchantId} AND conversation_id=${id}::uuid AND dedup_key NOT LIKE 'historical:%'`;
    return rows[0].at?.toISOString() ?? null;
  }
  async suppression(hashes: string[]) {
    if (!hashes.length) return null;
    return this
      .one<MarketingSuppression>(Prisma.sql`SELECT data FROM marketing_suppressions WHERE merchant_id=${
      this.merchantId
    }
      AND identity_hash IN (${Prisma.join(
        hashes
      )}) ORDER BY recorded_at DESC LIMIT 1`);
  }
  async saveSuppression(hash: string, value: MarketingSuppression) {
    await this.db
      .$executeRaw`INSERT INTO marketing_suppressions(merchant_id,identity_hash,recorded_at,data)
      VALUES(${this.merchantId},${hash},${new Date(
      value.recordedAt
    )},${JSON.stringify(value)}::jsonb)
      ON CONFLICT(merchant_id,identity_hash) DO UPDATE SET recorded_at=EXCLUDED.recorded_at,data=EXCLUDED.data
      WHERE marketing_suppressions.recorded_at<=EXCLUDED.recorded_at`;
  }
  private retentionWhere(before: string) {
    return Prisma.sql`p.merchant_id=${
      this.merchantId
    } AND p.data->>'mergedInto' IS NULL
    AND (p.data->>'purchaseCount')::int=0 AND p.updated_at<${new Date(before)}
    AND NOT EXISTS(SELECT 1 FROM marketing_purchase_receipts r WHERE r.merchant_id=p.merchant_id AND r.contact_id=p.id)
    AND NOT EXISTS(SELECT 1 FROM marketing_conversations c WHERE c.merchant_id=p.merchant_id AND c.contact_id=p.id AND (c.data->>'mode'='human' OR c.updated_at>=${new Date(
      before
    )}))
      AND NOT EXISTS(SELECT 1 FROM marketing_campaign_recipients r WHERE r.merchant_id=p.merchant_id AND r.contact_id=p.id AND r.status IN ('sending','unknown'))
      AND NOT EXISTS(SELECT 1 FROM marketing_conversations c JOIN marketing_messages m
        ON m.merchant_id=c.merchant_id AND m.conversation_id=c.id
        WHERE c.merchant_id=p.merchant_id AND c.contact_id=p.id AND m.data->>'status' IN ('sending','unknown'))`;
  }
  async retentionCount(before: string) {
    const rows = await this.db.$queryRaw<Array<{ total: bigint }>>(
      Prisma.sql`SELECT count(*)::bigint total FROM marketing_contacts p WHERE ${this.retentionWhere(
        before
      )}`
    );
    return Number(rows[0].total);
  }
  retentionCandidates(before: string, limit: number) {
    return this.many<MarketingContact>(
      Prisma.sql`SELECT p.data FROM marketing_contacts p WHERE ${this.retentionWhere(
        before
      )} ORDER BY p.updated_at,p.id LIMIT ${limit} FOR UPDATE SKIP LOCKED`
    );
  }
  async removeRelationship(id: string) {
    await this.db
      .$executeRaw`UPDATE marketing_campaign_recipients SET status='suppressed',data=data||'{"status":"suppressed","reason":"contact_retention"}'::jsonb
      WHERE merchant_id=${this.merchantId} AND contact_id=${id}::uuid AND status='queued'`;
    await this.db
      .$executeRaw`DELETE FROM marketing_messages WHERE merchant_id=${this.merchantId} AND conversation_id IN(SELECT id FROM marketing_conversations WHERE merchant_id=${this.merchantId} AND contact_id=${id}::uuid)`;
    await this.db
      .$executeRaw`DELETE FROM marketing_conversations WHERE merchant_id=${this.merchantId} AND contact_id=${id}::uuid`;
    await this.db
      .$executeRaw`DELETE FROM marketing_consents WHERE merchant_id=${this.merchantId} AND contact_id=${id}::uuid`;
    await this.db
      .$executeRaw`DELETE FROM marketing_stage_history WHERE merchant_id=${this.merchantId} AND contact_id=${id}::uuid`;
    await this.db
      .$executeRaw`DELETE FROM marketing_contacts WHERE merchant_id=${this.merchantId} AND id=${id}::uuid`;
  }
}

@Injectable()
export class PrismaMarketingRepository implements MarketingRepository {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}
  transaction<T>(
    merchantId: string,
    resource: string,
    operation: (tx: MarketingTransaction) => Promise<T>,
    options?: { timeoutMs: number }
  ): Promise<T> {
    return this.prisma.$transaction(
      async (db) => {
        await db.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${`${merchantId}:marketing:${resource}`},0))`;
        return operation(new PrismaMarketingTransaction(db, merchantId));
      },
      { timeout: options?.timeoutMs ?? 30_000, maxWait: 10_000 }
    );
  }
  async dueCampaigns(now: Date, limit: number) {
    const rows = await this.prisma.$queryRaw<
      Array<{ merchant_id: string; id: string }>
    >`SELECT merchant_id,id FROM marketing_campaigns
      WHERE status IN ('scheduled','running') AND (scheduled_at IS NULL OR scheduled_at<=${now}) ORDER BY scheduled_at NULLS FIRST,updated_at LIMIT ${limit}`;
    return rows.map((row) => ({ merchantId: row.merchant_id, id: row.id }));
  }
  async dueHistoryJobs(now: Date, limit: number) {
    const rows = await this.prisma.$queryRaw<
      Array<{ merchant_id: string }>
    >`SELECT merchant_id FROM marketing_history_jobs WHERE status IN ('queued','running')
      AND (data->>'leaseUntil' IS NULL OR (data->>'leaseUntil')::timestamptz<=${now}) ORDER BY updated_at LIMIT ${limit}`;
    return rows.map((row) => row.merchant_id);
  }
  async dueRetention(now: Date, limit: number) {
    const rows = await this.prisma.$queryRaw<
      Array<{ merchant_id: string }>
    >`SELECT merchant_id FROM marketing_settings WHERE data->>'configured'='true'
      AND (data->>'retentionLastRunAt' IS NULL OR (data->>'retentionLastRunAt')::timestamptz<${new Date(
        now.getTime() - 86400000
      )}) ORDER BY updated_at LIMIT ${limit}`;
    return rows.map((row) => row.merchant_id);
  }
}
