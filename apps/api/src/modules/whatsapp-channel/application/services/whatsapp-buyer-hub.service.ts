import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { BUYER_ACCOUNT_REPOSITORY, type BuyerAccountRepository } from "../../../buyer-account/domain/ports/buyer-account-repository.port.js";
import { WhatsAppCheckoutIdentityService, brazilianPhoneForms } from "./whatsapp-checkout-identity.service.js";
import { WhatsAppHubAddressesService, hubAddressBasis, type HubAddress } from "./whatsapp-hub-addresses.service.js";
import { BUYER_HUB_COMMANDS, buyerHubCommand, buyerHubRoute } from "../../domain/ui/buyer-hub.js";
import type { WhatsAppConversationPort } from "../../domain/ports/whatsapp-conversation.port.js";
import type { WhatsAppStructuredResponse, WhatsAppConversationState, StoreUiAction } from "../../domain/ui/meta-ui.types.js";

type HubInput = Parameters<NonNullable<WhatsAppConversationPort["respondStore"]>>[0];
type HubResult = { kind: "reply"; response: WhatsAppStructuredResponse } | { kind: "route"; message: string; action?: StoreUiAction;
  buyer?: HubInput["buyer"]; state?: WhatsAppConversationState };
const safe = (text: string) => text.replace(/[*_~`\u0000-\u001f\u007f]/g, " ").trim().slice(0, 180);
const addressLine = (row: HubAddress) => `📍 *${safe(row.label || "Endereço")}${row.isDefault ? " · padrão" : ""}*\n${safe(row.street)}, ${safe(row.number)}${row.complement ? ` · ${safe(row.complement)}` : ""}\n${safe(row.neighborhood)} · ${safe(row.city)}/${safe(row.state)} · CEP ${row.zip.slice(0, 5)}-${row.zip.slice(5)}`;

@Injectable()
export class WhatsAppBuyerHubService {
  constructor(private readonly identity: WhatsAppCheckoutIdentityService,
    @Inject(BUYER_ACCOUNT_REPOSITORY) private readonly accounts: BuyerAccountRepository,
    private readonly addresses: WhatsAppHubAddressesService) {}

  async handle(input: HubInput, merchantName: string): Promise<HubResult | undefined> {
    const command = buyerHubCommand(input.message);
    const identityPending = input.state.buyerHubIdentity;
    const emailAnswer = identityPending && identityPending.expiresAt > Date.now()
      && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.message.trim()) ? input.message.trim() : undefined;
    if (!command && !emailAnswer && !/^\/[a-zá-ú]+(?:\s|$)/i.test(input.message.trim())) return;
    const state: WhatsAppConversationState = { ...input.state };
    const reply = (message: string, quickReplies: string[] = ["/atalhos"], blocks: WhatsAppStructuredResponse["blocks"] = []): HubResult => ({ kind: "reply",
      response: { agentMessage: message, quickReplies, blocks, merchantName,
        state: { ...state, history: [...state.history, { role: "user", content: input.message }, { role: "assistant", content: message }].slice(-40) } } });
    if (command === "/cancelar") {
      const pending = !!state.buyerHub || !!state.buyerHubIdentity;
      state.buyerHub = undefined; state.buyerHubIdentity = undefined;
      if (pending) state.expectsFreeInput = false;
      return reply("🤖 ✅ *Atalho encerrado*\n\nSeu carrinho e seu pagamento continuam salvos. Você pode conversar comigo ou abrir */atalhos*.");
    }
    const effective = command ?? (emailAnswer ? identityPending?.command : undefined);
    if (!effective) return reply("🤖 ⚡ *Esse atalho ainda não está disponível*\n\nDigite */atalhos* para consultar as opções que você já pode usar.");
    if (effective === "/atalhos") return reply("🤖 ⚡ *Sua loja, por aqui*\n\n🛍️ *Comprar*\n/produtos · /categorias · /ofertas · /favoritos\n\n🛒 *Continuar a compra*\n/carrinho · /comprarapida\n\n👤 *Seu cadastro*\n/dados · /enderecos\n\n💬 *Precisa de ajuda?*\n/ajuda\n\nEscolha no menu ou escreva o comando. Para encerrar uma coleta de dados, use */cancelar*. Você também pode conversar naturalmente a qualquer momento.",
      BUYER_HUB_COMMANDS.map(entry => entry.label));
    const entry = BUYER_HUB_COMMANDS.find(entry => entry.command === effective);
    if (!entry) return reply("🤖 Não reconheci esse atalho. Abra */atalhos* para continuar.");
    if (!("protected" in entry) || !entry.protected) {
      const route = buyerHubRoute(effective);
      if (route) return { kind: "route", ...route };
    }
    const recognized = await this.identity.recognize({ merchantId: input.merchantId, conversationId: state.conversationId,
      phone: input.buyer.phone, verifiedSender: input.verifiedSender, emailHint: emailAnswer });
    const owner = recognized.owner;
    if (!owner || owner.merchantId !== input.merchantId || owner.conversationId !== state.conversationId
      || !brazilianPhoneForms(input.buyer.phone).includes(owner.phone)) {
      state.buyerHub = undefined; state.buyerHubIdentity = undefined;
      return reply("🤖 🔒 *Não consegui confirmar seu acesso nesta mensagem*\n\nEnvie o atalho novamente pela conversa oficial da loja para consultar seus dados.");
    }
    if (recognized.status === "ambiguous") {
      state.buyerHub = undefined;
      state.buyerHubIdentity = { command: effective, expiresAt: Date.now() + 10 * 60_000 };
      state.expectsFreeInput = true;
      return reply("🤖 👤 *Vamos identificar seu cadastro*\n\nEste telefone possui mais de um cadastro. Qual e-mail você usa nas compras?\n\n_Basta informar o e-mail. Para sair, use /cancelar._", ["/cancelar"]);
    }
    const buyerId = recognized.status === "recognized" ? recognized.buyer.globalUserId : input.buyer.globalUserId;
    const account = await this.accounts.findByGlobalUserId(buyerId);
    if (!account || !account.phone || !brazilianPhoneForms(account.phone).some(phone => brazilianPhoneForms(owner.phone).includes(phone))
      || recognized.status === "recognized" && (recognized.buyer.merchantId !== input.merchantId || recognized.buyer.conversationId !== state.conversationId))
      return reply("🤖 👤 *Cadastro não localizado*\n\nVocê pode continuar comprando. Vou solicitar apenas os dados necessários durante a finalização.");
    state.buyerHubIdentity = undefined;
    if (identityPending) state.expectsFreeInput = false;
    const route = buyerHubRoute(effective);
    if (route) return { kind: "route", ...route, buyer: { globalUserId: account.globalUserId, phone: owner.phone,
      fullName: account.displayName, email: account.email }, state };
    if (effective === "/dados") {
      const email = account.email.endsWith("@buyer.aacp") ? "Ainda não informado" : safe(account.email);
      return reply(`🤖 👤 *Seu cadastro*\n\n• *Nome:* ${safe(account.displayName)}\n• *E-mail:* ${email}\n• *WhatsApp:* final ${owner.phone.slice(-4)}\n\n📍 Consulte seus endereços em */enderecos*.\n\n_Estes são os dados da sua conta de comprador, compartilhados com a loja online._`, ["/enderecos", "/carrinho", "/atalhos"]);
    }
    const rows = await this.addresses.list(buyerId);
    state.buyerHub = { merchantId: input.merchantId, conversationId: state.conversationId, buyerId, token: randomUUID(),
      expiresAt: Date.now() + 15 * 60_000, mode: "addresses", basisHash: hubAddressBasis(rows) };
    return reply(`🤖 📍 *Meus endereços*\n\n${rows.length ? rows.map(addressLine).join("\n\n") : "Você ainda não possui endereços salvos."}\n\n_Estes endereços são compartilhados com seu cadastro na loja online. Pedidos já criados mantêm seus dados de entrega._`, ["/dados", "/atalhos"]);
  }
}
