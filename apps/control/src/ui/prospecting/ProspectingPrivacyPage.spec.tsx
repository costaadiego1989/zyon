import { describe, expect, it, vi } from "vitest";
import { ProspectingPrivacyPage } from "./ProspectingPrivacyPage.js";
import { exerciseReadFailure, screenProps, show } from "./screen-test.js";

const policy = { retentionDays: 180, preservedSuppressions: 7, lastRunAt: null, nextRunAt: null };
describe("Privacidade", () => {
  it("PROS-29 AC2 mostra retenção, exceções e supressões e confirma o contato antes de bloquear", async () => {
    const suppress = vi.fn().mockResolvedValue({ cancelledAttempts: 2, inFlightAttempts: 1 });
    const props = screenProps({ privacy: async () => policy, prospects: async () => ({ items: [{ id: "lead", cnpj: "00ABCDEF000190", version: 5, stage: "new" }] }), suppress });
    const ui = await show(<ProspectingPrivacyPage {...props} />);
    expect(ui.text()).toMatch(/180 dias/);
    expect(ui.text()).toMatch(/não convertidos/i);
    expect(ui.text()).toMatch(/autorizaç/i);
    expect(ui.text()).toMatch(/Supressões preservadas7/);
    expect(ui.text()).toMatch(/reimportação/i);
    await ui.fill("CNPJ do lead", "00ABCDEF000190");
    await ui.click("Localizar lead");
    await ui.click("Bloquear 00ABCDEF000190");
    expect(suppress).not.toHaveBeenCalled();
    await ui.click("Voltar");
    await ui.click("Bloquear 00ABCDEF000190");
    await ui.fill("Motivo do bloqueio", "Solicitação do contato");
    await ui.click("Confirmar bloqueio");
    expect(suppress).toHaveBeenCalledWith("lead", expect.objectContaining({ expectedVersion: 5, reason: "Solicitação do contato", clientRequestId: expect.any(String) }));
    expect(ui.text()).toMatch(/2.*cancelad/i);
    expect(ui.text()).toMatch(/1.*andamento/i);
  });
  it("mostra ausência de supressões e de lead no CRM", async () => {
    const ui = await show(<ProspectingPrivacyPage {...screenProps({ privacy: async () => ({ ...policy, preservedSuppressions: 0 }), prospects: async () => ({ items: [] }) })} />);
    expect(ui.text()).toContain("Nenhuma supressão");
    await ui.fill("CNPJ do lead", "00ABCDEF000190");
    await ui.click("Localizar lead");
    expect(ui.text()).toContain("Nenhum lead");
  });
  it("recupera falha e esconde ações sem acesso", async () => {
    await exerciseReadFailure(read => <ProspectingPrivacyPage {...screenProps({ privacy: read })} />, "Localizar lead");
  });
});
