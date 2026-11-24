/** @vitest-environment jsdom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { AppointmentViews } from "./AppointmentViews.js";
import { readAppointmentSnapshot } from "./appointment-read-snapshot.js";

const roots: Array<{ root: Root; host: HTMLDivElement }> = [];
afterEach(async () => { for (const { root, host } of roots.splice(0)) { await act(async () => root.unmount()); host.remove(); } });
function snapshot(options: { empty?: boolean; noRows?: boolean; paid?: boolean; customer?: boolean; zone?: string } = {}) {
  const items = options.empty || options.noRows ? [] : ["a", "b"].map((id, index) => ({ id, merchantId: "merchant", professionalId: "professional", professionalName: "Dra. Ana", productId: "service", serviceName: "Consulta especializada e avaliação de acompanhamento", categoryId: "category", variantId: "variant",
    startsAt: "2030-01-01T13:00:00.000Z", endsAt: "2030-01-01T13:30:00.000Z", timeZone: options.zone ?? "America/Sao_Paulo", durationMinutes: 30, priceInCents: 10000,
    currency: "BRL", policyVersion: 1, operationalStatus: index ? "pending" : "scheduled", origin: "manual", version: 2,
    customer: options.customer === false ? {} : { name: index ? "Maria" : "João" }, payments: options.paid ? [{ id: "payment-" + id, mode: "online", status: "approved", amountCents: 10000,
      currency: "BRL", version: 2, requiresRegularization: false, receivedAt: "2029-12-31T12:00:00.000Z" }] : [] }));
  const value = readAppointmentSnapshot("merchant", { fromDate: "2030-01-01", toDate: "2030-01-01" }, {
    items, totalCount: options.empty ? 0 : 12, nextCursor: options.empty || options.noRows ? null : "next_page",
    countsByStatus: { pending: options.empty ? 0 : 2, scheduled: options.empty ? 0 : 10, in_service: 0, completed: 0, no_show: 0, cancelled: 0 },
    asOf: "2030-01-01T12:00:00.000Z", timeZone: "America/Sao_Paulo",
  });
  if (!value) throw Error("invalid appointment fixture");
  return value;
}
async function mount(props: { value?: ReturnType<typeof snapshot>; busy?: boolean } = {}) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host); roots.push({ root, host });
  const opened: string[] = []; let next = 0, first = 0;
  await act(async () => root.render(React.createElement(AppointmentViews, { snapshot: props.value ?? snapshot(), busy: props.busy,
    onOpen: id => { opened.push(id); }, onNextPage: () => { next++; }, onFirstPage: () => { first++; } })));
  const button = (name: string) => Array.from(host.querySelectorAll("button")).find(item => item.textContent?.trim() === name)!;
  return { host, button, opened, next: () => next, first: () => first,
    ids: () => Array.from(host.querySelectorAll("[data-appointment-id]")).map(item => item.getAttribute("data-appointment-id")) };
}

describe("T103 appointment list and Kanban presentation", () => {
  it("shows six canonical columns, authoritative counts and the loaded page separately", async () => {
    const f = await mount();
    expect(f.host.querySelectorAll("[data-appointment-status]")).toHaveLength(6);
    expect(f.host.querySelector('[data-appointment-status="scheduled"]')?.textContent).toContain("10");
    expect(f.host.textContent).toContain("2 de 12 agendamentos nesta página");
    expect(f.host.textContent).toContain("Horário de Brasília");
    expect(f.host.textContent).not.toContain("America/Sao_Paulo");
    expect(f.ids()).toEqual(["b", "a"]);
  });
  it("changes view by a real button gesture without changing canonical IDs or totals", async () => {
    const f = await mount(), before = f.ids().sort();
    await act(async () => f.button("Lista").click());
    expect(f.button("Lista").getAttribute("aria-pressed")).toBe("true");
    expect(f.host.querySelector("table")).not.toBeNull(); expect(f.ids().sort()).toEqual(before);
    expect(f.host.textContent).toContain("2 de 12 agendamentos nesta página");
    await act(async () => f.button("Kanban").click()); expect(f.ids().sort()).toEqual(before);
  });
  it("opens the exact appointment from a card and from the list button", async () => {
    const f = await mount();
    await act(async () => (f.host.querySelector('[data-appointment-id="a"]') as HTMLButtonElement).click());
    await act(async () => f.button("Lista").click());
    await act(async () => (f.host.querySelector('[data-appointment-id="b"] button') as HTMLButtonElement).click());
    expect(f.opened).toEqual(["a", "b"]);
  });
  it("keeps an approved financial record distinct from an operationally pending appointment", async () => {
    const f = await mount({ value: snapshot({ paid: true }) });
    const pending = f.host.querySelector('[data-appointment-status="pending"]')!;
    expect(pending.querySelector('[data-appointment-id="b"]')?.textContent).toContain("Pago");
    expect(pending.querySelector('[data-appointment-id="b"]')).not.toBeNull();
    expect(f.host.querySelector('[data-appointment-status="completed"] [data-appointment-id]')).toBeNull();
  });
  it("does not infer a zero price or payment for a missing financial record or customer name", async () => {
    const f = await mount({ value: snapshot({ customer: false }) });
    expect(f.host.textContent).toContain("Cliente sem nome informado"); expect(f.host.textContent).toContain("Sem registro de pagamento");
    expect(f.host.textContent).not.toContain("Grátis"); expect(f.host.textContent).toContain("100,00");
  });
  it("distinguishes a truly empty result from an empty loaded page with remaining filtered records", async () => {
    const empty = await mount({ value: snapshot({ empty: true }) });
    expect(empty.host.textContent).toContain("Nenhum agendamento neste período");
    const page = await mount({ value: snapshot({ noRows: true }) });
    expect(page.host.textContent).toContain("0 de 12 agendamentos nesta página");
    expect(page.host.textContent).not.toContain("Nenhum agendamento neste período");
    expect(page.host.textContent).toContain("Há agendamentos em outras páginas");
  });
  it("uses real pagination controls and disables opening or paging while busy", async () => {
    const f = await mount();
    await act(async () => { f.button("Próxima página").click(); f.button("Primeira página").click(); });
    expect(f.next()).toBe(1); expect(f.first()).toBe(1);
    const busy = await mount({ busy: true });
    await act(async () => { (busy.host.querySelector('[data-appointment-id="a"]') as HTMLButtonElement).click(); busy.button("Próxima página").click(); });
    expect(busy.opened).toEqual([]); expect(busy.next()).toBe(0);
  });
  it("preserves historical zone and instant while displaying full names and service descriptions", async () => {
    const f = await mount({ value: snapshot({ zone: "UTC" }) });
    expect(f.host.textContent).toContain("UTC"); expect(f.host.textContent).toContain("13:00");
    expect(f.host.querySelector('time')?.getAttribute("dateTime")).toBe("2030-01-01T13:00:00.000Z");
    expect(f.host.textContent).toContain("Consulta especializada e avaliação de acompanhamento");
  });
});
