/** @vitest-environment jsdom */
import { act } from "react";
import { describe, expect, it } from "vitest";
import { ManualAppointmentDrawer } from "./ManualAppointmentDrawer.js";
import { SESSION_EXPIRED_EVENT } from "../../../api/http/client.js";
import { manualFixture, manualButton, manualField, manualClick, manualEnter, manualSelect, manualRegularSelection, manualContact, manualReceipt, manualDetail, manualMe } from "./manual-appointment.test-fixture.js";

describe("T79", () => {
  it("shows service, professional, registered price and duration before sending a manual command", async () => {
    const f = await manualFixture(ManualAppointmentDrawer); await manualRegularSelection();
    const summary = document.querySelector('[aria-label="Resumo da seleção"]');
    expect(summary?.textContent).toContain("Consulta"); expect(summary?.textContent).toContain("Ana");
    expect(summary?.textContent).toContain("30 min"); expect(summary?.textContent).toMatch(/50,00/);
    expect(summary?.textContent).toContain("conferidos ao criar"); expect(f.writes()).toEqual([]);
  });
  it("uses a canonical slot and reads detail before showing online pending without inventing a paid record", async () => {
    const f = await manualFixture(ManualAppointmentDrawer); await manualContact(); await manualRegularSelection(); await manualClick("Criar agendamento");
    expect(f.writes()).toHaveLength(1); expect(f.writes()[0].body).toMatchObject({ productId: "service-a", variantId: "variant-a", professionalId: "professional-a", expectedProfessionalVersion: 7, expectedPolicyVersion: 3, startsAt: "2030-01-02T13:00:00.000Z" });
    expect(f.writes()[0].headers.get("Idempotency-Key")).toBe(f.writes()[0].body.commandId); expect(f.details()).toHaveLength(1);
    expect(document.body.textContent).toContain("Pendente"); expect(document.body.textContent).toContain("Sem registro de pagamento"); expect(document.body.textContent).not.toContain("Pagamento recebido");
  });
  it("known customer choice comes from a merchant-bound read, not a raw ID field", async () => {
    const f = await manualFixture(ManualAppointmentDrawer); await manualSelect("Tipo de cliente", "known"); await manualClick("Consultar clientes"); await manualSelect("Cliente cadastrado", "buyer-a"); await manualRegularSelection(); await manualClick("Criar agendamento");
    expect(f.requests.find(value => value.path.endsWith("/customers"))?.query.get("merchantId")).toBe(manualMe.id); expect(f.writes()[0].body.customer).toEqual({ kind: "known", customerId: "buyer-a" });
    expect(document.querySelector('input[name="customerId"]')).toBeNull();
  });
  it("explicit one-off is a deliberate Brasilia gesture and sends no browser-derived end or price", async () => {
    const f = await manualFixture(ManualAppointmentDrawer); await manualContact(); await manualSelect("Serviço", "service-a"); await manualSelect("Profissional", "professional-a"); await manualClick("Informar horário avulso");
    await manualEnter("Data e hora em Brasília", "2030-01-02T14:00"); await manualClick("Criar agendamento");
    expect(f.writes()[0].body).toMatchObject({ startsAt: "2030-01-02T17:00:00.000Z", explicitOneOff: {} }); expect(f.writes()[0].body).not.toHaveProperty("endsAt"); expect(f.writes()[0].body).not.toHaveProperty("priceInCents");
    expect(f.requests.some(value => value.path.endsWith("/service-availability/slots"))).toBe(false);
  });
  it("at-attendance displays the canonical scheduled state and pending balance separately", async () => {
    const f = await manualFixture(ManualAppointmentDrawer, { mode: "at_attendance" }); await manualContact(); await manualRegularSelection(); await manualClick("Criar agendamento");
    expect(document.body.textContent).toContain("Agendado"); expect(document.body.textContent).toContain("A pagar no atendimento"); expect(document.body.textContent).not.toContain("Pagamento recebido"); expect(f.details()).toHaveLength(1);
  });
  it("starts a separate booking only after a canonical result and a deliberate new-booking gesture", async () => {
    const f = await manualFixture(ManualAppointmentDrawer); await manualContact(); await manualRegularSelection(); await manualClick("Criar agendamento");
    const first = f.writes()[0].body.commandId; await manualClick("Novo agendamento"); expect(f.writes()).toHaveLength(1); expect(manualField("Nome do contato").value).toBe("");
    await manualContact(); await manualRegularSelection(); await manualClick("Criar agendamento"); expect(f.writes()).toHaveLength(2); expect(f.writes()[1].body.commandId).not.toBe(first);
  });
  it("blocks a second submit before the first render completes", async () => {
    let release!: (value: Response) => void; const deferred = new Promise<Response>(resolve => { release = resolve; });
    const f = await manualFixture(ManualAppointmentDrawer, { handle: value => value.path.endsWith("/manual") ? deferred : undefined }); await manualContact(); await manualRegularSelection();
    await act(async () => { manualButton("Criar agendamento").click(); manualButton("Criar agendamento").click(); }); expect(f.writes()).toHaveLength(1);
    await act(async () => release(Response.json(manualReceipt(), { status: 201 }))); expect(f.details()).toHaveLength(1);
  });
  it("lost ACK keeps a frozen command across close/reopen and only an explicit same-body retry can write again", async () => {
    let attempts = 0; const f = await manualFixture(ManualAppointmentDrawer, { handle: value => value.path.endsWith("/manual") ? ++attempts === 1 ? Promise.reject(Error("unknown transport outcome")) : Response.json({ ...manualReceipt(), replayed: true }, { status: 201 }) : undefined });
    await manualContact(); await manualRegularSelection(); await manualClick("Criar agendamento"); const original = structuredClone(f.writes()[0].body);
    expect(document.body.textContent).toContain("Sua tentativa foi preservada"); expect(f.writes()).toHaveLength(1); expect(manualField("Nome do contato").disabled).toBe(true);
    await f.render(manualMe, false); await f.render(manualMe, true); expect(f.writes()).toHaveLength(1); await manualClick("Repetir mesma tentativa");
    expect(f.writes()).toHaveLength(2); expect(f.writes()[1].body).toEqual(original); expect(f.writes()[1].headers.get("Idempotency-Key")).toBe(original.commandId); expect(f.details()).toHaveLength(1);
  });
  it("ACK followed by failed detail does not claim success or resend POST during detail reconciliation", async () => {
    let reads = 0; const f = await manualFixture(ManualAppointmentDrawer, { handle: value => /\/service-appointments\/appointment-a$/.test(value.path) && ++reads === 1 ? Response.json({}, { status: 503 }) : undefined });
    await manualContact(); await manualRegularSelection(); await manualClick("Criar agendamento"); expect(document.body.textContent).toContain("Ainda não foi possível conferir o agendamento"); expect(document.body.textContent).not.toContain("Agendamento conferido");
    await manualClick("Recarregar detalhes"); expect(f.writes()).toHaveLength(1); expect(f.details()).toHaveLength(2); expect(document.body.textContent).toContain("Agendamento conferido");
  });
  it("a known conflict retains the draft and needs explicit review before a new selection", async () => {
    const f = await manualFixture(ManualAppointmentDrawer, { handle: value => value.path.endsWith("/manual") ? Response.json({ detail: "service_slot_unavailable" }, { status: 409 }) : undefined });
    await manualContact(); await manualRegularSelection(); await manualClick("Criar agendamento"); expect(manualField("Nome do contato").value).toBe("Maria"); expect(f.writes()).toHaveLength(1);
    await manualClick("Revisar dados"); expect(f.writes()).toHaveLength(1); expect(manualField("Horário disponível").value).toBe(""); expect(document.body.textContent).not.toContain("Agendamento conferido");
  });
  it("foreign or malformed detail is not a successful appointment or an empty financial result", async () => {
    const f = await manualFixture(ManualAppointmentDrawer, { handle: value => /\/service-appointments\/appointment-a$/.test(value.path) ? Response.json({ ...manualDetail(), merchantId: "foreign" }) : undefined });
    await manualContact(); await manualRegularSelection(); await manualClick("Criar agendamento"); expect(f.writes()).toHaveLength(1); expect(document.body.textContent).toContain("Ainda não foi possível conferir o agendamento"); expect(document.body.textContent).not.toContain("Agendamento conferido");
  });
  it("disabled admissions never dispatch manual writes", async () => {
    const f = await manualFixture(ManualAppointmentDrawer, { admissions: false }); expect(document.body.textContent).toContain("Novos agendamentos suspensos"); expect(manualButton("Criar agendamento").disabled).toBe(true); expect(f.writes()).toEqual([]);
  });
  it("session expiry clears private fields and fences the preserved unknown command", async () => {
    const f = await manualFixture(ManualAppointmentDrawer, { handle: value => value.path.endsWith("/manual") ? Promise.reject(Error("lost ACK")) : undefined }); await manualContact(); await manualRegularSelection(); await manualClick("Criar agendamento");
    await act(async () => window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT))); expect(document.body.textContent).toContain("Sessão expirada"); expect(document.querySelector('input[value="Maria"]')).toBeNull(); expect(manualButton("Repetir mesma tentativa")).toBeUndefined(); expect(f.writes()).toHaveLength(1);
  });
  it.each([{ ...manualMe, role: "STAFF" as const }, { ...manualMe, businessMode: "products" as const }, null])("denies management and private reads in unsupported scope %j", async me => {
    const f = await manualFixture(ManualAppointmentDrawer, { me }); expect(f.writes()).toEqual([]); expect(f.requests.some(value => value.path.endsWith("/customers"))).toBe(false); expect(manualButton("Criar agendamento")).toBeUndefined();
  });
});
