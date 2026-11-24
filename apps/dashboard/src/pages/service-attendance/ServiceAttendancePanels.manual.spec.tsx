/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { expect, it, vi } from "vitest";
import { ServiceAttendancePanels } from "./ServiceAttendancePanels.js";
import { manualFixture, manualMe, manualClick, manualContact, manualRegularSelection } from "./components/manual-appointment.test-fixture.js";

it("T79 loads manual controls only on demand and retains the identical uncertain attempt across close and tab changes", async () => {
  const f = await manualFixture(({ me, vm, open }) => <ServiceAttendancePanels me={me!} vm={vm} tab={open ? "agenda" : "professionals"} />,
    { handle: request => { if (request.method === "POST") throw new TypeError("synthetic-lost-ack"); return undefined; } });
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(f.requests.some(request => request.path.endsWith("/products") || request.path.endsWith("/customers"))).toBe(false);
  await manualClick("Novo agendamento");
  await act(async () => { await vi.dynamicImportSettled(); });
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Novo agendamento");
  await manualContact(); await manualRegularSelection(); await manualClick("Criar agendamento");
  const body = structuredClone(f.writes()[0].body); expect(f.writes()).toHaveLength(1);
  await manualClick("Fechar"); await f.render(manualMe, false); await f.render(manualMe, true);
  await manualClick("Novo agendamento"); expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Repetir mesma tentativa");
  expect(f.writes()).toHaveLength(1); await manualClick("Repetir mesma tentativa");
  expect(f.writes()).toHaveLength(2); expect(f.writes()[1].body).toEqual(body);
});
