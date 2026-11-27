import { expect, test, vi } from "vitest";
import { SalesKnowledgePage } from "./SalesKnowledgePage.js";
import { exerciseReadFailure, screenProps, show } from "./screen-test.js";
const source = {
  id: "manual",
  title: "Manual Zyon",
  sourceRef: "Manual de produtos",
  validFrom: "2026-01-01T00:00:00Z",
  validUntil: null,
  version: 2,
  state: "draft",
  contentHash: "new",
  activePublicationId: "older",
  activePublicationVersion: 1,
  activeContentHash: "old",
  draft: [{ id: "fact", predicate: "faq", subject: "Frete", value: "Cotação online" }],
};
test("PROS-28 AC1 editar e salvar um rascunho conserva a publicação anterior", async () => {
  const saveKnowledge = vi.fn(async (cmd) => ({ ...source, title: cmd.title, version: 3 }));
  const props = screenProps({ knowledge: async () => ({ items: [source] }), saveKnowledge });
  const ui = await show(<SalesKnowledgePage {...props} />);
  await ui.click("Manual Zyon");
  await ui.fill("Título da fonte", "Manual atualizado");
  await ui.click("Salvar rascunho");
  expect(saveKnowledge.mock.calls[0][0]).toMatchObject({
    sourceId: "manual",
    expectedVersion: 2,
    title: "Manual atualizado",
    facts: [{ subject: "Frete", value: "Cotação online" }],
  });
  expect(ui.text()).toContain("Rascunho · versão 3");
  expect(ui.text()).toContain("Publicação ativa · versão 1");
});
test("PROS-28 AC2 publicação falha mantém ponteiro anterior e retirada usa a versão ativa", async () => {
  const publishOrWithdraw = vi
    .fn()
    .mockRejectedValueOnce(new Error())
    .mockResolvedValue({ state: "withdrawn", activePublicationId: null });
  const props = screenProps({
    knowledge: async () => ({ items: [source] }),
    source: async () => ({
      ...source,
      activePublicationId: null,
      activePublicationVersion: null,
      activeContentHash: null,
    }),
    publishOrWithdraw,
  });
  const ui = await show(<SalesKnowledgePage {...props} />);
  await ui.click("Manual Zyon");
  await ui.click("Publicar versão");
  expect(ui.text()).toContain("Não foi possível");
  expect(ui.text()).toContain("Publicação ativa · versão 1");
  await ui.click("Retirar publicação");
  expect(publishOrWithdraw.mock.calls[1][1]).toMatchObject({
    action: "withdraw",
    expectedVersion: 1,
    contentHash: "old",
  });
  expect(ui.text()).toContain("Sem publicação ativa");
});
test("PROS-28 AC3 pergunta controlada mostra resposta com origem e encaminhamento sem evidência", async () => {
  const queryKnowledge = vi
    .fn()
    .mockResolvedValueOnce({
      answer: "Frete disponível",
      facts: [],
      handoff: false,
      sources: [{ id: "manual", version: 1 }],
      callMode: "controlled",
    })
    .mockResolvedValueOnce({ answer: null, handoff: true, sources: [], facts: [], callMode: "controlled" });
  const ui = await show(
    <SalesKnowledgePage {...screenProps({ knowledge: async () => ({ items: [] }), queryKnowledge })} />
  );
  await ui.fill("Pergunta ou assunto", "Frete");
  await ui.click("Testar pergunta");
  expect(queryKnowledge.mock.calls[0][0]).toMatchObject({ operation: "answer_faq", params: { question: "Frete" } });
  expect(ui.text()).toContain("Frete disponível");
  expect(ui.text()).toContain("manual · versão 1");
  expect(ui.text()).toContain("Consulta controlada");
  await ui.fill("Pergunta ou assunto", "Outro");
  await ui.click("Testar pergunta");
  expect(ui.text()).toContain("Encaminhar ao atendimento humano");
  expect(ui.text()).not.toContain("Frete disponível");
});

test("PROS-28 AC1 carregamento, falha e acesso negado suspendem ações do recurso", async () => {
  await exerciseReadFailure((read) => <SalesKnowledgePage {...screenProps({ knowledge: read })} />, "Nova fonte");
});

test("PROS-28 AC2 publicação lê a versão ativa confirmada após a projeção", async () => {
  const published = {
    ...source,
    state: "published",
    activePublicationId: "new-id",
    activePublicationVersion: 2,
    activeContentHash: "new",
  };
  const publishOrWithdraw = vi.fn().mockResolvedValue(published);
  const props = screenProps({
    knowledge: async () => ({ items: [source] }),
    source: async () => published,
    publishOrWithdraw,
  });
  const ui = await show(<SalesKnowledgePage {...props} />);
  await ui.click("Manual Zyon");
  await ui.click("Publicar versão");
  expect(publishOrWithdraw.mock.calls[0][1]).toMatchObject({
    expectedVersion: 2,
    action: "publish",
    contentHash: "new",
  });
  expect(ui.text()).toContain("Publicada · versão 2");
  expect(ui.text()).toContain("Publicação ativa · versão 2");
});
