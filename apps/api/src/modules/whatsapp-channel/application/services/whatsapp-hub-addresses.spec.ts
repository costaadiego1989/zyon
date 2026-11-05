import test from "node:test";
import assert from "node:assert/strict";
import { WhatsAppHubAddressesService, hubAddressBasis, hubAddressField, type HubAddress } from "./whatsapp-hub-addresses.service.js";
import { WhatsAppBuyerHubService } from "./whatsapp-buyer-hub.service.js";
import { buildMetaUiView } from "../../domain/ui/meta-ui-renderer.js";
import { HUB_ADDRESS_FIELDS } from "../../domain/ui/buyer-hub.js";
import { Prisma } from "@prisma/client";

const buyerId = "canonical", phone = "5521993001883";
const address = (id = "a", extra: Partial<HubAddress> = {}): HubAddress => ({ id, globalUserId: buyerId, label: "Casa", zip: "20000001",
  street: "Rua A", number: "10", complement: null, neighborhood: "Centro", city: "Rio de Janeiro", state: "RJ", isDefault: true,
  createdAt: new Date(1000), updatedAt: new Date(1000), ...extra });
const draft = { label: "Trabalho", zip: "01310100", street: "Avenida Paulista", number: "100", complement: "", neighborhood: "Bela Vista", city: "São Paulo", state: "SP" };
function fixture(initial: HubAddress[] = [], options: any = {}) {
  let rows = structuredClone(initial), clock = 2000, accountAddress: unknown = options.legacy ?? (initial[0] ? Object.fromEntries(
    ["zip", "street", "number", "complement", "neighborhood", "city", "state"].map(field => [field, (initial[0] as any)[field]])) : null);
  const matches = (row: HubAddress, where: any) => row.globalUserId === where.globalUserId
    && (where.id === undefined || typeof where.id === "string" ? where.id === undefined || row.id === where.id : row.id !== where.id.not)
    && (where.isDefault === undefined || row.isDefault === where.isDefault)
    && (where.updatedAt === undefined || row.updatedAt.getTime() === where.updatedAt.getTime());
  const tx: any = {
    $queryRaw: async (_query: unknown, id: string) => { assert.equal(id, buyerId); return [{ global_user_id: buyerId }]; },
    buyerAddress: {
      findMany: async ({ where }: any) => structuredClone(rows.filter(row => matches(row, where))),
      create: async ({ data }: any) => { assert.equal(data.globalUserId, buyerId); if (rows.some(row => row.id === data.id)) throw Error("duplicate");
        const row = { ...data, createdAt: new Date(++clock), updatedAt: new Date(clock) }; rows.push(row); return structuredClone(row); },
      updateMany: async ({ where, data }: any) => { if (options.failTarget && typeof where.id === "string") return { count: 0 };
        let count = 0; rows = rows.map(row => { if (!matches(row, where)) return row; count++; return { ...row, ...data, updatedAt: new Date(++clock) }; }); return { count }; },
      deleteMany: async ({ where }: any) => { const previous = rows.length; rows = rows.filter(row => !matches(row, where)); return { count: previous - rows.length }; },
    }, buyerAccount: { findUnique: async () => ({ address: accountAddress }), updateMany: async ({ where, data }: any) => {
      assert.equal(where.globalUserId, buyerId); assert.deepEqual(where.address.equals, accountAddress);
      accountAddress = data.address; return { count: 1 }; } },
  };
  const prisma = { ...tx, $transaction: async (run: any, config: any) => {
    assert.equal(config.isolationLevel, "Serializable"); const before = structuredClone(rows), oldLegacy = accountAddress;
    try { return await run(tx); } catch (error) { rows = before; accountAddress = oldLegacy; throw error; }
  } };
  const addresses = new WhatsAppHubAddressesService(prisma as never);
  const hub = new WhatsAppBuyerHubService({ recognize: async () => ({ status: "recognized",
    owner: { merchantId: "shop", conversationId: "conversation", phone }, buyer: { merchantId: "shop", conversationId: "conversation", globalUserId: buyerId } }) } as never,
    { findByGlobalUserId: async () => ({ globalUserId: buyerId, phone, displayName: "Diego", email: "buyer@example.com" }) } as never, addresses);
  const state: any = { version: 1, conversationId: "conversation", stage: "store", revision: "r", history: [], page: 0, previousViews: [],
    payment: { intentId: "original", amount_cents: 1385, status: "approved" }, checkoutSessionId: "original-checkout" };
  async function turn(message: string, current = state, action?: any) {
    const before = structuredClone(current);
    const result = await hub.handle({ merchantId: "shop", buyer: { globalUserId: "guest", phone }, message, state: current, action } as any, "Athom");
    assert.deepEqual(current, before, "input state must remain unchanged");
    assert.equal(result?.kind, "reply"); if (result?.kind !== "reply") assert.fail();
    assert.equal(result.response.state.payment?.intentId, "original"); assert.equal(result.response.state.checkoutSessionId, "original-checkout");
    return result.response;
  }
  function control(response: any, label: string) {
    const choice = buildMetaUiView(response).choices.find(c => c.label === label);
    assert.ok(choice, `missing control ${label}`); return choice.action;
  }
  const mutation = (extra: any = {}) => ({ buyerId, merchantId: "shop", conversationId: "conversation", token: "action", basisHash: hubAddressBasis(rows), ...extra });
  return { addresses, hub, turn, control, rows: () => structuredClone(rows), mutation, legacy: () => accountAddress };
}

test("HUB-03 native address lifecycle adds, edits, changes default and confirms deletion in shared persistence", async () => {
  const f = fixture([address()]);
  let response = await f.turn("/enderecos");
  response = await f.turn("Adicionar endereço", response.state, f.control(response, "Adicionar endereço"));
  for (const field of HUB_ADDRESS_FIELDS) response = await f.turn(draft[field] || "-", response.state);
  assert.equal(f.rows().length, 2); assert.match(response.agentMessage, /Endereço salvo/);
  const added = f.rows().find(row => row.id !== "a")!;
  assert.equal(added.zip, "01310100"); assert.equal(added.complement, null); assert.equal(added.isDefault, false);
  response = await f.turn("Trabalho", response.state, f.control(response, "Trabalho"));
  response = await f.turn("Editar endereço", response.state, f.control(response, "Editar endereço"));
  response = await f.turn("Número", response.state, f.control(response, "Número"));
  response = await f.turn("250", response.state);
  assert.equal(f.rows().find(row => row.id === added.id)!.number, "250");
  response = await f.turn("Trabalho", response.state, f.control(response, "Trabalho"));
  response = await f.turn("Usar como padrão", response.state, f.control(response, "Usar como padrão"));
  assert.deepEqual(f.rows().filter(row => row.isDefault).map(row => row.id), [added.id]);
  response = await f.turn("Trabalho", response.state, f.control(response, "Trabalho"));
  response = await f.turn("Excluir endereço", response.state, f.control(response, "Excluir endereço"));
  assert.equal(f.rows().length, 2); assert.match(response.agentMessage, /Excluir este endereço/);
  response = await f.turn("Confirmar exclusão", response.state, f.control(response, "Confirmar exclusão"));
  assert.deepEqual(f.rows().map(row => [row.id, row.isDefault]), [["a", true]]);
  assert.match(response.agentMessage, /Endereço excluído/);
});

test("HUB-03 rejects invalid field values, allows cancellation and never saves an incomplete form", async () => {
  const f = fixture(); let response = await f.turn("/enderecos");
  response = await f.turn("Adicionar endereço", response.state, f.control(response, "Adicionar endereço"));
  response = await f.turn("Casa", response.state);
  response = await f.turn("00000000", response.state); assert.match(response.agentMessage, /Confira cep/i); assert.equal(response.state.buyerHub?.field, "zip");
  response = await f.turn("01310-100", response.state); assert.equal(response.state.buyerHub?.field, "street");
  response = await f.turn("/cancelar", response.state); assert.equal(response.state.buyerHub, undefined); assert.equal(response.state.expectsFreeInput, false);
  assert.deepEqual(f.rows(), []);
  for (const [field, invalid] of [["state", "ZZ"], ["zip", "abc01310100"], ["number", "a".repeat(21)], ["street", "Rua\nInjected"], ["city", " "]] as const)
    assert.equal(hubAddressField(field, invalid), undefined);
});

test("HUB-03 slash text inside an address field cannot trigger a shopping or payment shortcut", async () => {
  const f = fixture(); let response = await f.turn("/enderecos");
  response = await f.turn("Adicionar endereço", response.state, f.control(response, "Adicionar endereço"));
  response = await f.turn("Casa", response.state); response = await f.turn("01310100", response.state);
  response = await f.turn("/comprarapida", response.state);
  assert.equal(response.state.buyerHub?.draft?.street, "/comprarapida");
  assert.equal(response.state.buyerHub?.field, "number"); assert.deepEqual(f.rows(), []);
});

test("HUB-03 stale, expired, forged-buyer and wrong-token address actions cannot mutate saved records", async () => {
  const f = fixture([address()]); const first = await f.turn("/enderecos"); const add = f.control(first, "Adicionar endereço") as any;
  for (const change of [{ token: "forged" }, { buyerId: "foreign" }, { merchantId: "foreign" }, { conversationId: "foreign" }, { expiresAt: 1 }, { basisHash: "outdated" }]) {
    const state = { ...first.state, buyerHub: { ...first.state.buyerHub, ...change } };
    const response = await f.turn("Adicionar endereço", state, add);
    assert.equal(response.state.buyerHub?.mode, "addresses"); assert.match(response.agentMessage, /menu mudou/);
    assert.deepEqual(f.rows(), [address()]);
  }
});

test("HUB-03 repeat addition is idempotent; foreign target and outdated book cannot write", async () => {
  const f = fixture(); const action = f.mutation({ kind: "add", draft });
  const first = await f.addresses.mutate(action); const again = await f.addresses.mutate(action);
  assert.deepEqual(first, again); assert.equal(f.rows().length, 1);
  await assert.rejects(f.addresses.mutate({ ...action, draft: { ...draft, number: "999" } }), /stale/);
  await assert.rejects(f.addresses.mutate(f.mutation({ kind: "delete", addressId: "foreign-address" })), /stale/);
  await assert.rejects(f.addresses.mutate(f.mutation({ kind: "edit", addressId: first[0]!.id, basisHash: "old", draft: { number: "2" } })), /stale/);
  assert.deepEqual(f.rows(), first);
});

test("HUB-03 default changes roll back atomically when the target revision cannot be updated", async () => {
  const rows = [address(), address("b", { isDefault: false })], f = fixture(rows, { failTarget: true });
  await assert.rejects(f.addresses.mutate(f.mutation({ kind: "default", addressId: "b" })), /stale/);
  assert.deepEqual(f.rows(), rows);
});

test("HUB-03 deleting the final address clears legacy fallback and editing the current default retains one default", async () => {
  const f = fixture([address()]);
  await f.addresses.mutate(f.mutation({ kind: "edit", addressId: "a", draft: { number: "22", complement: "" } }));
  assert.equal(f.rows()[0]!.number, "22"); assert.equal(f.rows()[0]!.isDefault, true);
  await f.addresses.mutate(f.mutation({ kind: "delete", addressId: "a" }));
  assert.deepEqual(f.rows(), []); assert.equal(f.legacy(), Prisma.DbNull);
});

test("HUB-03 deleting the final saved address preserves a different current legacy profile address", async () => {
  const legacy = { zip: "01310100", street: "Outro endereço", number: "50", neighborhood: "Bela Vista", city: "São Paulo", state: "SP" };
  const f = fixture([address()], { legacy });
  await f.addresses.mutate(f.mutation({ kind: "edit", addressId: "a", draft: { number: "22" } }));
  assert.deepEqual(f.legacy(), legacy);
  await f.addresses.mutate(f.mutation({ kind: "delete", addressId: "a" }));
  assert.deepEqual(f.rows(), []); assert.deepEqual(f.legacy(), legacy);
});

test("HUB-03 maximum count is enforced and /atalhos exits a pending form without saving", async () => {
  const f = fixture(Array.from({ length: 5 }, (_, i) => address("a" + i, { isDefault: i === 0 })));
  await assert.rejects(f.addresses.mutate(f.mutation({ kind: "add", draft })), /limit/); assert.equal(f.rows().length, 5);
  let response = await f.turn("/enderecos"); response = await f.turn("Adicionar endereço", response.state, f.control(response, "Adicionar endereço"));
  response = await f.turn("/atalhos", response.state); assert.equal(response.state.buyerHub, undefined); assert.equal(response.state.expectsFreeInput, false);
});
