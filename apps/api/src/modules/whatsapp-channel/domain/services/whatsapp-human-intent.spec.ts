import assert from "node:assert/strict";
import test from "node:test";
import { humanEscalationIntent,isHumanSupportDiscussion } from "./whatsapp-human-intent.js";

test("T57 ordinary tool intent is admitted only from the current user request", async t => {
  await t.test("keeps deterministic labels and bounded contact paraphrases including payment", () => {
    for (const value of ["/atendente", "Falar com atendente", "Quero falar com um atendente", "Gostaria de falar com uma pessoa",
      "Você consegue me passar para alguém da equipe?", "Um humano pode me ajudar com o pagamento?", "Tem como chamar uma pessoa real aqui?",
      "Preciso que a equipe da loja me atenda agora.", "Não consegui pagar. Pode chamar um atendente?", "Pode me colocar em contato com alguém da loja?"])
      assert.equal(humanEscalationIntent(value), "request", value);
  });
  await t.test("refusal and negated contact cannot be overwritten by a selected model tool", () => {
    for (const value of ["Não quero falar com atendente", "Não precisa chamar um atendente", "Nunca solicito atendimento humano",
      "Dispenso um atendente por enquanto", "Evite chamar uma pessoa agora", "Não me transfira para um humano"])
      assert.equal(humanEscalationIntent(value), "not_requested", value);
  });
  await t.test("quoted and hypothetical requests require clarification rather than a case", () => {
    for (const value of ['O texto "quero falar com atendente" é um exemplo', "Se eu pedir para chamar uma pessoa, o que acontece?",
      "Imagine que eu quero um humano", "A frase 'falar com atendente' está no manual", "E se uma pessoa me atendesse?"])
      assert.equal(humanEscalationIntent(value), "clarify", value);
  });
  await t.test("clinician intent is not a general staff-tool grant", () => {
    for (const value of ["Quero falar com o médico para marcar uma consulta", "Preciso conversar com o profissional", "O terapeuta pode decidir por mim?", "Quero falar com um atendente médico", "Pode chamar uma pessoa para prescrever meu tratamento?"])
      assert.equal(humanEscalationIntent(value), "clarify", value);
  });
  await t.test("store prose, shopping intent and model-authored reason do not manufacture a user request", () => {
    for (const value of ["Qual é o preço?", "Quero comprar presente para uma pessoa", "Como funciona o atendimento?", "", " "])
      assert.equal(humanEscalationIntent(value), "not_requested", value);
    assert.equal(humanEscalationIntent("Não quero falar com atendente"), "not_requested");
    assert.equal(humanEscalationIntent("Quero falar com atendente"), "request");
  });
});

test("T57 ordinary form answers stay collected while human discussions reach conversational interpretation",()=>{
  for(const value of ["Você consegue me colocar em contato com alguém da equipe da loja?", "Atendente", "Humano", "Não quero falar com atendente, quero continuar por aqui.",
    'O texto "quero falar com atendente" é apenas um exemplo.',"Quero falar com um atendente médico para decidir meu tratamento."])
    assert.equal(isHumanSupportDiscussion(value),true,value);
  for(const value of ["Juliana Cavalcanti","Rua dos Médicos, 100","cliente@example.test","Quero atualizar meu endereço",
    "Quero comprar presente para uma pessoa","A equipe recomendou o número 123","12345-678",""])
    assert.equal(isHumanSupportDiscussion(value),false,value);
});
