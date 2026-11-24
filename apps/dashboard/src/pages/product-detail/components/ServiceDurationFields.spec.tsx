/** @vitest-environment jsdom */
import React, { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { ProductMetadata } from "../ProductDetailPage.js";
import { validateProductMetadata } from "../utils/product-validation.js";
import { ServiceDurationFields } from "./ServiceDurationFields.js";

const mounts: Array<{ root: Root; host: HTMLDivElement }> = [];
afterEach(async () => { for (const { root, host } of mounts.splice(0)) { await act(async () => root.unmount()); host.remove(); } });
async function fixture(original: ProductMetadata = {}, disabled = false) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); let value = original, changes = 0;
  function Probe() { const [metadata, setMetadata] = useState(original); value = metadata; const error = validateProductMetadata("service", { ...metadata }).serviceSchedule;
    return <fieldset disabled={disabled}><ServiceDurationFields metadata={metadata} error={error} onChange={next => { changes++; setMetadata(next); }} /></fieldset>;
  }
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host); mounts.push({ root, host }); await act(async () => root.render(<Probe />));
  const enter = async (text: string) => { await act(async () => { const input = host.querySelector<HTMLInputElement>('input')!; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text); input.dispatchEvent(new Event("input", { bubbles: true })); }); };
  return { host, value: () => value, changes: () => changes, enter };
}
describe("T78 catalog duration and scheduling delegation", () => {
  it("does not create legacy capacity or metadata on mount and references the attendance destination", async () => {
    const f = await fixture({ serviceType: "remoto", remoteLink: "https://example.test/meet", notes: "Preservar" });
    expect(f.changes()).toBe(0); expect(f.host.querySelector('input')?.value).toBe(""); expect(f.host.querySelector('[role="switch"]')).toBeNull(); expect(f.host.textContent).not.toContain("Adicionar horário");
    expect(f.host.querySelector('a')?.getAttribute("href")).toBe("#service-attendance?tab=availability"); expect(f.value()).toEqual({ serviceType: "remoto", remoteLink: "https://example.test/meet", notes: "Preservar" });
  });
  it("stores an explicit duration in the real existing contract without offering per-variant dates", async () => {
    const f = await fixture({ serviceType: "presencial" }); await f.enter("45");
    expect(f.value()).toEqual({ serviceType: "presencial", serviceSchedule: { timeZone: "America/Sao_Paulo", durationMinutes: 45, slots: [] } }); expect(f.host.querySelectorAll('input[type="date"],input[type="time"]')).toHaveLength(0);
  });
  it("preserves all historical slot identities, wall dates, zone and unrelated service details on duration change", async () => {
    const original: ProductMetadata = { serviceType: "remoto", remoteLink: "https://example.test/meet", notes: "Preservar", serviceSchedule: { timeZone: "America/Manaus", durationMinutes: 30, slots: [{ id: "historical", date: "2030-02-04", startTime: "10:30" }] } };
    const before = structuredClone(original), f = await fixture(original); await f.enter("60");
    expect(f.value()).toEqual({ ...before, serviceSchedule: { ...before.serviceSchedule, durationMinutes: 60 } }); expect(original).toEqual(before);
  });
  it.each(["", "4", "481", "5.5"])("exposes an invalid duration to the existing form validator without deleting history: %s", async text => {
    const original: ProductMetadata = { serviceType: "presencial", serviceSchedule: { timeZone: "America/Manaus", durationMinutes: 30, slots: [{ id: "kept", date: "2030-02-04", startTime: "10:30" }] } }, f = await fixture(original); await f.enter(text);
    if (text === "") expect(Number.isNaN(f.value().serviceSchedule?.durationMinutes)).toBe(true); else expect(f.value().serviceSchedule?.durationMinutes).toBe(Number(text)); expect(f.value().serviceSchedule?.slots).toEqual(original.serviceSchedule!.slots); expect(f.value().serviceSchedule?.timeZone).toBe("America/Manaus");
    expect(validateProductMetadata("service", { ...f.value() }).serviceSchedule).toBe("A duração deve ser um número inteiro entre 5 e 480 minutos."); expect(f.host.querySelector('[role="alert"]')?.textContent).toContain("A duração");
  });
  it("does not silently repair malformed historical scheduling", async () => {
    const original = { serviceSchedule: { timeZone: "America/Manaus", durationMinutes: 30, slots: null } } as unknown as ProductMetadata, f = await fixture(original);
    expect(f.changes()).toBe(0); expect(f.host.querySelector('input')).toBeNull(); expect(f.host.querySelector('[role="alert"]')?.textContent).toContain("registros anteriores"); expect(f.value()).toBe(original);
  });
  it("inherits the saved form's disabled state", async () => {
    const f = await fixture({}, true); expect(f.host.querySelector('input')?.matches(':disabled')).toBe(true); expect(f.changes()).toBe(0);
  });
});
