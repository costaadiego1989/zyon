import { Inject, Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { CheckoutSession } from "@zyon/shared-types";
import { BUYER_ADDRESS_REPOSITORY, MAX_ADDRESSES_PER_BUYER, type BuyerAddressRepository } from "../../../buyer-account/domain/ports/buyer-address.port.js";
import { BuyerAddress } from "../../../buyer-account/domain/entities/buyer-address.entity.js";
import { ListBuyerAddressesUseCase } from "../../../buyer-account/application/use-cases/list-buyer-addresses.use-case.js";

function addressLabel(text: string): string | undefined {
  const normalized = text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  if (/\b(trabalho|escritorio)\b/.test(normalized)) return "Trabalho";
  if (/\bcasa\b/.test(normalized)) return "Casa";
  const label = text.match(/\bcomo\s+["“]?([^"”?.!]{1,40})["”]?\s*$/i)?.[1]?.trim();
  return label || undefined;
}

@Injectable()
export class CheckoutSavedAddressService {
  constructor(@Inject(BUYER_ADDRESS_REPOSITORY) private readonly addresses: BuyerAddressRepository,
    private readonly listAddresses: ListBuyerAddressesUseCase) {}

  async resolve(session: CheckoutSession, text: string) {
    if (!session.customer?.email_verified) return undefined;
    const label = addressLabel(text);
    if (!label) return undefined;
    const saving = /\b(salvar|salve|guardar|guarde|cadastrar|cadastre)\b/i.test(text);
    if (saving) {
      const working = { ...session, customer: { ...session.customer, deliveryAddressLabel: label } };
      const saved = await this.saveComplete(working);
      return { label, message: saved ? `Endereço salvo como ${label}. Seu endereço principal foi mantido.`
        : "Confirme o endereço completo antes de salvá-lo.", session: saved ? working : session };
    }
    if (!/\b(enviar|entregar|receber|usar|alterar|trocar|mudar)\b/i.test(text)) return undefined;
    const existing = (await this.listAddresses.execute(session.globalUserId)).find(address => address.label?.toLowerCase() === label.toLowerCase());
    const working = { ...session, customer: { ...session.customer, deliveryAddressLabel: label } };
    if (!existing) return { label, session: working };
    working.customer = { ...working.customer, address_verified: false, address: { zip: existing.zip, street: existing.street,
      number: existing.number, complement: existing.complement ?? "", neighborhood: existing.neighborhood, city: existing.city, state: existing.state } };
    return { label, session: working, message: `Vamos entregar em ${label}: ${existing.street}, ${existing.number}, ${existing.city}/${existing.state}. Está correto? (Sim/Não)` };
  }

  async saveComplete(session: CheckoutSession): Promise<boolean> {
    const customer = session.customer;
    const label = customer?.deliveryAddressLabel;
    const address = customer?.address;
    if (!label || !customer.email_verified || !customer.address_verified || !address?.zip || !address.street
      || !address.number || address.complement === undefined || !address.neighborhood || !address.city || !address.state) return false;
    const list = await this.listAddresses.execute(session.globalUserId);
    const existing = list.find(item => item.label?.toLowerCase() === label.toLowerCase());
    if (!existing && list.length >= MAX_ADDRESSES_PER_BUYER) return false;
    const id = existing?.id ?? `address_${createHash("sha256").update(`${session.globalUserId}:${label.toLowerCase()}`).digest("hex").slice(0, 32)}`;
    const saved = BuyerAddress.create({ id, globalUserId: session.globalUserId, label, zip: address.zip,
      street: address.street, number: address.number, complement: address.complement, neighborhood: address.neighborhood,
      city: address.city, state: address.state, isDefault: existing?.isDefault ?? false });
    if (existing && ["zip", "street", "number", "complement", "neighborhood", "city", "state", "label"]
      .every(key => existing[key as keyof BuyerAddress] === saved[key as keyof BuyerAddress])) return true;
    await this.addresses.save(saved);
    return true;
  }
}
