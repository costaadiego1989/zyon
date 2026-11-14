import { Inject, Injectable, Optional } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { BUYER_ACCOUNT_REPOSITORY, type BuyerAccountRepository } from "../../../buyer-account/domain/ports/buyer-account-repository.port.js";
import { WhatsAppCheckoutIdentityService, brazilianPhoneForms } from "./whatsapp-checkout-identity.service.js";
import { WhatsAppHubAddressesService, hubAddressBasis, hubAddressField, type HubAddress } from "./whatsapp-hub-addresses.service.js";
import { buyerHubCommands, buyerHubCommand, buyerHubRoute, HUB_ADDRESS_FIELDS, type HubAddressField } from "../../domain/ui/buyer-hub.js";
import type { WhatsAppConversationPort } from "../../domain/ports/whatsapp-conversation.port.js";
import type { WhatsAppStructuredResponse, WhatsAppConversationState, StoreUiAction } from "../../domain/ui/meta-ui.types.js";
import { MAX_ADDRESSES_PER_BUYER } from "../../../buyer-account/domain/ports/buyer-address.port.js";
import { CashbackService } from "../../../cashback/application/cashback.service.js";

type HubInput = Parameters<NonNullable<WhatsAppConversationPort["respondStore"]>>[0];
type HubResult = { kind: "reply"; response: WhatsAppStructuredResponse } | { kind: "route"; message: string; action?: StoreUiAction;
  buyer?: HubInput["buyer"]; state?: WhatsAppConversationState };
const safe = (text: string) => text.replace(/[*_~`\u0000-\u001f\u007f]/g, " ").trim().slice(0, 180);
const addressLine = (row: HubAddress) => `📍 *${safe(row.label || "Endereço")}${row.isDefault ? " · padrão" : ""}*\n${safe(row.street)}, ${safe(row.number)}${row.complement ? ` · ${safe(row.complement)}` : ""}\n${safe(row.neighborhood)} · ${safe(row.city)}/${safe(row.state)} · CEP ${row.zip.slice(0, 5)}-${row.zip.slice(5)}`;
const fieldLabels: Record<HubAddressField, string> = { label: "Apelido", zip: "CEP", street: "Rua ou avenida", number: "Número",
  complement: "Complemento", neighborhood: "Bairro", city: "Cidade", state: "UF" };
const fieldPrompt = (field: HubAddressField) => `🤖 📝 *${fieldLabels[field]} do endereço*\n\n${field === "zip" ? "Informe o CEP com 8 dígitos."
  : field === "state" ? "Informe a sigla do estado, como RJ ou SP." : field === "label" ? "Como quer identificar este endereço? Ex.: Casa ou Trabalho. Para deixar sem apelido, envie -."
  : field === "complement" ? "Informe o complemento. Se não tiver, envie -." : `Informe ${fieldLabels[field].toLowerCase()}.`}\n\n_Use /cancelar para sair sem salvar._`;

@Injectable()
export class WhatsAppBuyerHubService {
  constructor(private readonly identity: WhatsAppCheckoutIdentityService,
    @Inject(BUYER_ACCOUNT_REPOSITORY) private readonly accounts: BuyerAccountRepository,
    private readonly addresses: WhatsAppHubAddressesService,
    @Optional() private readonly cashback?: CashbackService) {}

  async handle(input: HubInput, merchantName: string, cashbackEnabled = false): Promise<HubResult | undefined> {
    const action = input.action?.kind === "tool" && input.action.tool === "buyer_hub" ? input.action.args : undefined;
    const collecting = input.state.buyerHub && ["add", "edit", "delete"].includes(input.state.buyerHub.mode);
    const detectedCommand = buyerHubCommand(input.message);
    const command = collecting && (!input.message.trim().startsWith("/") || detectedCommand !== "/cancelar" && detectedCommand !== "/atalhos") ? undefined : detectedCommand;
    const identityPending = input.state.buyerHubIdentity;
    const emailAnswer = identityPending && identityPending.expiresAt > Date.now()
      && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.message.trim()) ? input.message.trim() : undefined;
    if (!command && !emailAnswer && !action && !collecting && !/^\/[a-zá-ú]+(?:\s|$)/i.test(input.message.trim())) return;
    const state: WhatsAppConversationState = { ...input.state, buyerHub: input.state.buyerHub
      ? { ...input.state.buyerHub, draft: input.state.buyerHub.draft ? { ...input.state.buyerHub.draft } : undefined } : undefined };
    const reply = (message: string, quickReplies: string[] = ["/atalhos"], blocks: WhatsAppStructuredResponse["blocks"] = [{ type: "buyer_hub_actions", data: { choices: [] } }]): HubResult => ({ kind: "reply",
      response: { agentMessage: message, quickReplies, blocks, merchantName,
        state: { ...state, history: [...state.history, { role: "user" as const, content: input.message }, { role: "assistant" as const, content: message }].slice(-40) } } });
    if (command === "/cancelar") {
      const pending = !!state.buyerHub || !!state.buyerHubIdentity;
      state.buyerHub = undefined; state.buyerHubIdentity = undefined;
      if (pending) state.expectsFreeInput = false;
      return reply("🤖 ✅ *Atalho encerrado*\n\nSeu carrinho e seu pagamento continuam salvos. Você pode conversar comigo ou abrir */atalhos*.");
    }
    const effective = command ?? (emailAnswer ? identityPending?.command : action || collecting ? "/enderecos" : undefined);
    if (!effective) return reply("🤖 ⚡ *Esse atalho ainda não está disponível*\n\nDigite */atalhos* para consultar as opções que você já pode usar.");
    if (effective === "/atalhos") {
      if (state.buyerHub || state.buyerHubIdentity) state.expectsFreeInput = false;
      state.buyerHub = undefined; state.buyerHubIdentity = undefined;
      return reply("🤖 📋 *Menu principal*\n\nEscolha o que deseja fazer no menu abaixo ou continue conversando comigo.", buyerHubCommands(cashbackEnabled).map(entry => entry.label),
        [{ type: "buyer_hub_actions", data: { scope: "main_menu", choices: [] } }]);
    }
    const entry = buyerHubCommands(true).find(entry => entry.command === effective);
    if (!entry) return reply("🤖 Não reconheci esse atalho. Abra */atalhos* para continuar.");
    if (!("protected" in entry) || !entry.protected) {
      const route = buyerHubRoute(effective);
      if (route) {
        if (state.buyerHub || state.buyerHubIdentity) state.expectsFreeInput = false;
        state.buyerHub = undefined; state.buyerHubIdentity = undefined;
        return { kind: "route", ...route, state };
      }
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
    let buyerId = recognized.status === "recognized" ? recognized.buyer.globalUserId : input.buyer.globalUserId;
    let account = recognized.status === "recognized" ? await this.accounts.findByGlobalUserId(buyerId) : null;
    if (recognized.status === "unrecognized") {
      account = await this.identity.ensurePhoneOnlyHubAccount?.({ owner, globalUserId: input.buyer.globalUserId, fullName: input.buyer.fullName }) ?? null;
      if (account) buyerId = account.globalUserId;
    }
    if (!account || account.globalUserId !== buyerId || !account.phone || !brazilianPhoneForms(account.phone).some(phone => brazilianPhoneForms(owner.phone).includes(phone))
      || recognized.status === "recognized" && (recognized.buyer.merchantId !== input.merchantId || recognized.buyer.conversationId !== state.conversationId))
      return reply("🤖 👤 *Cadastro não localizado*\n\nVocê pode continuar comprando. Vou solicitar apenas os dados necessários durante a finalização.");
    state.buyerHubIdentity = undefined;
    if (identityPending) state.expectsFreeInput = false;
    if (effective === "/cashback") {
      state.buyerHub = undefined;
      try {
        const wallet = await this.cashback?.wallet(input.merchantId, account.globalUserId);
        if (!wallet || wallet.merchantId !== input.merchantId || wallet.buyerId !== account.globalUserId) throw new Error("cashback_wallet_scope_changed");
        const money = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
        return reply(`Seu saldo disponível de cashback nesta loja é ${money(wallet.balance.availableCents)}.\n\nA liberar: ${money(wallet.balance.pendingCents)}. Reservado em pedidos: ${money(wallet.balance.reservedCents)}.`);
      } catch {
        return reply("Não consegui consultar seu saldo de cashback agora. Tente novamente ou peça ajuda à loja.");
      }
    }
    const route = buyerHubRoute(effective);
    if (command && effective !== "/enderecos") {
      if (state.buyerHub) state.expectsFreeInput = false;
      state.buyerHub = undefined;
    }
    if (route) return { kind: "route", ...route, buyer: { globalUserId: account.globalUserId, phone: owner.phone,
      fullName: account.displayName, email: account.email }, state };
    if (effective === "/dados") {
      const email = account.email.endsWith("@buyer.aacp") ? "Ainda não informado" : safe(account.email);
      return reply(`🤖 👤 *Seu cadastro*\n\n• *Nome:* ${safe(account.displayName)}\n• *E-mail:* ${email}\n• *WhatsApp:* final ${owner.phone.slice(-4)}\n\n📍 Consulte seus endereços em */enderecos*.\n\n_Estes são os dados da sua conta de comprador, compartilhados com a loja online._`, ["/enderecos", "/carrinho", "/atalhos"]);
    }
    let rows = await this.addresses.list(buyerId);
    const actionChoices = (choices: Array<{ label: string; op: string; id?: string; field?: HubAddressField; description?: string }>) => [{ type: "buyer_hub_actions", data: {
      choices: choices.map(({ label, description, ...args }) => ({ label, description, args: { ...args, token: state.buyerHub!.token } })) } }];
    const book = (prefix = "") => {
      state.expectsFreeInput = false;
      state.buyerHub = { merchantId: input.merchantId, conversationId: state.conversationId, buyerId, token: randomUUID(),
        expiresAt: Date.now() + 15 * 60_000, mode: "addresses", basisHash: hubAddressBasis(rows) };
      return reply(`${prefix ? prefix + "\n\n" : ""}🤖 📍 *Meus endereços*\n\n${rows.length ? rows.map(addressLine).join("\n\n") : "Você ainda não possui endereços salvos."}\n\n_Estes endereços são compartilhados com seu cadastro na loja online. Pedidos já criados mantêm seus dados de entrega._`, ["/dados", "/atalhos"],
        actionChoices([...rows.map(row => ({ label: safe(row.label || "Endereço"), op: "view", id: row.id,
          description: `${row.city}/${row.state} · CEP ${row.zip}${row.isDefault ? " · padrão" : ""}` })), { label: "Adicionar endereço", op: "add" }]));
    };
    if (!action && !collecting || command === "/enderecos") return book();
    const pending = state.buyerHub;
    if (!pending || pending.buyerId !== buyerId || pending.merchantId !== input.merchantId || pending.conversationId !== state.conversationId
      || pending.expiresAt <= Date.now() || action && action.token !== pending.token || pending.basisHash !== hubAddressBasis(rows))
      return book("🤖 🔄 *O endereço ou o menu mudou*\nAbra a opção atual para continuar com os dados mais recentes.");
    const selected = rows.find(row => row.id === (action?.id ?? pending.addressId));
    const commit = async (kind: "add" | "edit" | "default" | "delete") => {
      try {
        rows = await this.addresses.mutate({ buyerId, merchantId: input.merchantId, conversationId: state.conversationId,
          token: pending.token, basisHash: pending.basisHash, kind, addressId: pending.addressId, draft: pending.draft });
        return book(`🤖 ✅ *${kind === "delete" ? "Endereço excluído" : kind === "default" ? "Endereço padrão atualizado" : "Endereço salvo"}*\n${kind === "delete" ? "Se você excluiu o padrão, o endereço mais antigo restante passa a ser o padrão. " : ""}A próxima compra usará os dados atualizados. Seu pedido e pagamento atuais foram mantidos.`);
      } catch (error) {
        rows = await this.addresses.list(buyerId);
        const message = error instanceof Error && error.message === "hub_address_limit" ? "Você atingiu o limite de endereços. Exclua um endereço antes de adicionar outro."
          : "Não consegui confirmar essa alteração. Confira os endereços atuais antes de tentar novamente.";
        return book(`🤖 📍 *Vamos conferir seu cadastro*\n${message}`);
      }
    };
    if (collecting && !action && pending.mode !== "delete") {
      const field = pending.field;
      if (!field) return book();
      const value = hubAddressField(field, input.message);
      if (value === undefined) return reply(`🤖 ⚠️ *Confira ${fieldLabels[field].toLowerCase()}*\n\n${fieldPrompt(field)}`, ["/cancelar"]);
      state.buyerHub = { ...pending, draft: { ...pending.draft, [field]: value } };
      pending.draft = state.buyerHub.draft;
      if (pending.mode === "edit") return commit("edit");
      const next = HUB_ADDRESS_FIELDS[HUB_ADDRESS_FIELDS.indexOf(field) + 1];
      if (!next) return commit("add");
      state.buyerHub.field = next; state.expectsFreeInput = true;
      return reply(fieldPrompt(next), ["/cancelar"]);
    }
    if (action?.op === "add" && pending.mode === "addresses") {
      if (rows.length >= MAX_ADDRESSES_PER_BUYER) return book("🤖 📍 Você atingiu o limite de endereços. Exclua um endereço antes de adicionar outro.");
      state.buyerHub = { ...pending, token: randomUUID(), mode: "add", field: "label", draft: {} }; state.expectsFreeInput = true;
      return reply("🤖 📍 *Vamos salvar um novo endereço*\n\nEle ficará disponível também na loja online. Vou pedir um dado por vez.\n\n" + fieldPrompt("label"), ["/cancelar"]);
    }
    if (action?.op === "view" && pending.mode === "addresses" && selected) {
      state.buyerHub = { ...pending, token: randomUUID(), mode: "address", addressId: selected.id };
      return reply(`🤖 ${addressLine(selected)}\n\nEscolha o que deseja fazer. Alterações valem para seu cadastro na loja online; pedidos atuais são mantidos.`, ["/enderecos", "/atalhos"],
        actionChoices([{ label: "Editar endereço", op: "edit", id: selected.id }, ...(!selected.isDefault ? [{ label: "Usar como padrão", op: "default", id: selected.id }] : []),
          { label: "Excluir endereço", op: "delete", id: selected.id }]));
    }
    if (!selected || selected.id !== pending.addressId) return book("🤖 Abra um endereço atual para escolher essa ação.");
    if (action?.op === "edit" && pending.mode === "address") return reply("🤖 ✏️ *O que deseja alterar?*\n\nEscolha um campo. Os outros dados serão mantidos.", ["/enderecos", "/cancelar"],
      actionChoices(HUB_ADDRESS_FIELDS.map(field => ({ label: fieldLabels[field], op: "field", id: selected.id, field }))));
    if (action?.op === "field" && pending.mode === "address" && HUB_ADDRESS_FIELDS.includes(action.field as HubAddressField)) {
      state.buyerHub = { ...pending, token: randomUUID(), mode: "edit", field: action.field as HubAddressField, draft: {} };
      state.expectsFreeInput = true; return reply(fieldPrompt(action.field as HubAddressField), ["/cancelar"]);
    }
    if (action?.op === "default" && pending.mode === "address") return commit("default");
    if (action?.op === "delete" && pending.mode === "address") {
      state.buyerHub = { ...pending, token: randomUUID(), mode: "delete" }; state.expectsFreeInput = true;
      return reply(`🤖 🗑️ *Excluir este endereço?*\n\n${addressLine(selected)}\n\nA exclusão vale para seu cadastro na loja online. Pedidos já criados mantêm a entrega original.`, ["/cancelar"],
        actionChoices([{ label: "Confirmar exclusão", op: "confirm_delete", id: selected.id }]));
    }
    if (pending.mode === "delete" && (action?.op === "confirm_delete" || !action && /^confirmar exclus[aã]o$/i.test(input.message.trim()))) return commit("delete");
    return book("🤖 Essa opção não corresponde à etapa atual. Escolha novamente para continuar.");
  }
}
