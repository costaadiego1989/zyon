import { Inject, Injectable, Optional } from "@nestjs/common";
import { admitWhatsAppEffectInTransaction } from "../../../../shared/whatsapp/whatsapp-automation-context.js";
import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { canonicalJson } from "../../../../shared/http/canonical-json.js";
import { BuyerAddress } from "../../../buyer-account/domain/entities/buyer-address.entity.js";
import { MAX_ADDRESSES_PER_BUYER } from "../../../buyer-account/domain/ports/buyer-address.port.js";
import { HUB_ADDRESS_FIELDS, type HubAddressField } from "../../domain/ui/buyer-hub.js";
import { BUYER_ACCOUNT_REPOSITORY, type BuyerAccountRepository } from "../../../buyer-account/domain/ports/buyer-account-repository.port.js";
import { ListBuyerAddressesUseCase } from "../../../buyer-account/application/use-cases/list-buyer-addresses.use-case.js";
import { PrismaBuyerAddressRepository } from "../../../buyer-account/infrastructure/prisma-buyer-address.repository.js";

export type HubAddress = { id: string; globalUserId: string; label: string | null; zip: string; street: string; number: string;
  complement: string | null; neighborhood: string; city: string; state: string; isDefault: boolean; createdAt: Date; updatedAt: Date };
const legacyFields = ["zip", "street", "number", "complement", "neighborhood", "city", "state"] as const;
function isLegacyCopy(legacy: unknown, row: HubAddress): boolean {
  if (!legacy || typeof legacy !== "object" || Array.isArray(legacy)) return false;
  const value = legacy as Record<string, unknown>;
  const normal = (input: unknown) => typeof input === "string" ? input.trim().toLocaleLowerCase("pt-BR") : "";
  return legacyFields.every(field => field === "zip" ? normal(value[field]).replace(/\D/g, "") === row.zip : normal(value[field]) === normal(row[field]));
}
export const hubAddressBasis = (rows: readonly HubAddress[]) => createHash("sha256").update(canonicalJson([...rows].sort((a, b) => a.id.localeCompare(b.id)))).digest("hex");
export function hubAddressField(field: HubAddressField, input: string): string | undefined {
  const value = input.trim();
  if (/[\u0000-\u001f\u007f]/.test(value)) return;
  if (field === "zip") return /^\d{5}-?\d{3}$/.test(value) && value.replace("-", "") !== "00000000" ? value.replace("-", "") : undefined;
  if (field === "state") return /^(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)$/i.test(value) ? value.toUpperCase() : undefined;
  if ((field === "complement" || field === "label") && value === "-") return "";
  const max = field === "number" ? 20 : field === "label" ? 40 : 150;
  return value.length > 0 && value.length <= max ? value : undefined;
}

/** Only the channel application supplies the principal; no buyer ID comes from a command. */
@Injectable()
export class WhatsAppHubAddressesService {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Optional() @Inject(BUYER_ACCOUNT_REPOSITORY) private readonly accounts?: BuyerAccountRepository) {}
  async list(buyerId: string): Promise<HubAddress[]> {
    if (this.accounts) await new ListBuyerAddressesUseCase(new PrismaBuyerAddressRepository(this.prisma), this.accounts).execute(buyerId);
    return this.prisma.buyerAddress.findMany({ where: { globalUserId: buyerId }, orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }] });
  }
  async mutate(input: { buyerId: string; merchantId: string; conversationId: string; token: string; basisHash: string;
    kind: "add" | "edit" | "default" | "delete"; addressId?: string; draft?: Partial<Record<HubAddressField, string>> }) {
    return this.prisma.$transaction(async tx => {
      await admitWhatsAppEffectInTransaction(tx, input.merchantId);
      // Serialize channel address changes per canonical buyer, including default and maximum count.
      const locked = await tx.$queryRaw<Array<{ global_user_id: string }>>`SELECT global_user_id FROM buyer_accounts WHERE global_user_id=${input.buyerId} FOR UPDATE`;
      if (locked.length !== 1) throw new Error("hub_buyer_missing");
      const rows = await tx.buyerAddress.findMany({ where: { globalUserId: input.buyerId }, orderBy: { id: "asc" } });
      const newId = "wa_" + createHash("sha256").update(canonicalJson([input.merchantId, input.conversationId, input.buyerId, input.token])).digest("hex").slice(0, 40);
      if (input.kind === "add" && rows.some(row => row.id === newId)) {
        const existing = rows.find(row => row.id === newId)!;
        if (!HUB_ADDRESS_FIELDS.every(field => (existing[field] ?? "") === (input.draft?.[field] ?? ""))) throw new Error("hub_address_stale");
        return this.sorted(rows); // Same action cannot append another address.
      }
      if (hubAddressBasis(rows) !== input.basisHash) throw new Error("hub_address_stale");
      const current = rows.find(row => row.id === input.addressId);
      if (input.kind !== "add" && !current) throw new Error("hub_address_stale");
      const account = current && ["edit", "delete"].includes(input.kind)
        ? await tx.buyerAccount.findUnique({ where: { globalUserId: input.buyerId }, select: { address: true } }) : null;
      const legacy = account?.address;
      const matchingLegacy = !!current && isLegacyCopy(legacy, current);
      if (input.kind === "delete") {
        const removed = await tx.buyerAddress.deleteMany({ where: { id: current!.id, globalUserId: input.buyerId, updatedAt: current!.updatedAt } });
        if (removed.count !== 1) throw new Error("hub_address_stale");
        const remaining = rows.filter(row => row.id !== current!.id);
        if (!remaining.length) {
          // Clear only the legacy copy of this deleted address. An independently
          // changed profile address must not be erased by an older address action.
          if (matchingLegacy)
            await tx.buyerAccount.updateMany({ where: { globalUserId: input.buyerId, address: { equals: legacy as Prisma.InputJsonValue } }, data: { address: Prisma.DbNull } });
        } else if (current!.isDefault) {
          const next = [...remaining].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))[0]!;
          await tx.buyerAddress.updateMany({ where: { id: next.id, globalUserId: input.buyerId }, data: { isDefault: true } });
        }
      } else {
        if (input.kind === "add" && rows.length >= MAX_ADDRESSES_PER_BUYER) throw new Error("hub_address_limit");
        const values = input.kind === "default" ? {} : Object.fromEntries(Object.entries(input.draft ?? {}).map(([field, value]) => {
          if (!HUB_ADDRESS_FIELDS.includes(field as HubAddressField)) throw new Error("hub_address_invalid");
          const checked = hubAddressField(field as HubAddressField, value);
          if (checked === undefined && !(value === "" && ["label", "complement"].includes(field))) throw new Error("hub_address_invalid");
          return [field, checked ?? ""];
        }));
        const domain = BuyerAddress.create({ ...(current ?? {}), ...values, id: current?.id ?? newId, globalUserId: input.buyerId,
          isDefault: input.kind === "default" || current?.isDefault === true || rows.length === 0 } as Parameters<typeof BuyerAddress.create>[0]);
        const data = { label: domain.label ?? null, zip: domain.zip, street: domain.street, number: domain.number,
          complement: domain.complement ?? null, neighborhood: domain.neighborhood, city: domain.city, state: domain.state, isDefault: domain.isDefault };
        if (data.isDefault) await tx.buyerAddress.updateMany({ where: { globalUserId: input.buyerId, id: { not: domain.id }, isDefault: true }, data: { isDefault: false } });
        if (current) {
          // The account lock coordinates channel writes; the revision also detects other-channel changes.
          const changed = await tx.buyerAddress.updateMany({ where: { id: current.id, globalUserId: input.buyerId, updatedAt: current.updatedAt }, data });
          if (changed.count !== 1) throw new Error("hub_address_stale");
          if (input.kind === "edit" && matchingLegacy) await tx.buyerAccount.updateMany({
            where: { globalUserId: input.buyerId, address: { equals: legacy as Prisma.InputJsonValue } },
            data: { address: { ...(legacy as Prisma.JsonObject), ...Object.fromEntries(legacyFields.map(field => [field, data[field]])) } as Prisma.InputJsonValue },
          });
        } else await tx.buyerAddress.create({ data: { ...data, id: newId, globalUserId: input.buyerId } });
      }
      return this.sorted(await tx.buyerAddress.findMany({ where: { globalUserId: input.buyerId } }));
    }, { isolationLevel: "Serializable", maxWait: 5000, timeout: 10000 });
  }
  private sorted(rows: HubAddress[]) { return rows.sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id)); }
}
