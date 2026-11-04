import { Inject, Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { canonicalJson } from "../../../../shared/http/canonical-json.js";
import { BuyerAddress } from "../../../buyer-account/domain/entities/buyer-address.entity.js";
import { MAX_ADDRESSES_PER_BUYER } from "../../../buyer-account/domain/ports/buyer-address.port.js";
import { HUB_ADDRESS_FIELDS, type HubAddressField } from "../../domain/ui/buyer-hub.js";

export type HubAddress = { id: string; globalUserId: string; label: string | null; zip: string; street: string; number: string;
  complement: string | null; neighborhood: string; city: string; state: string; isDefault: boolean; createdAt: Date; updatedAt: Date };
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
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}
  list(buyerId: string): Promise<HubAddress[]> {
    return this.prisma.buyerAddress.findMany({ where: { globalUserId: buyerId }, orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }] });
  }
  private sorted(rows: HubAddress[]) { return rows.sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id)); }
}
