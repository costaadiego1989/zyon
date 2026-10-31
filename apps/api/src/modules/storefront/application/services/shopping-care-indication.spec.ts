import test from "node:test";
import assert from "node:assert/strict";
import { shoppingRecoveryEvidence, shoppingSearchEvidence } from "./shopping-search-evidence.js";
import { shoppingSearchPlanSchema } from "../../domain/contracts/shopping-search-plan.schemas.js";

const plan = (priority: "required" | "preferred" = "required") => shoppingSearchPlanSchema.parse({version:1,query:"cuidado facial",
  attributes:[{name:"tipo de pele",value:"oleosa",operator:"equals",priority},
    {name:"perfume",value:"sim",operator:"not_equals",priority:"required"}],
  recovery:{familyQuery:"cuidado facial",optionalQueryTerms:[]}});

test("captured edd608c0 no-match never asks the buyer to change oily skin or drops the mandatory indication",()=>{
  const input=plan(),before=structuredClone(input),out=shoppingRecoveryEvidence(input,[],"no_match");
  assert.doesNotMatch(out.message,/flexibilizar tipo de pele|mudar (?:sua |o tipo de )?pele/i);
  assert.match(out.message,/indicação publicada para pele oleosa/i);
  assert.match(out.message,/não confirm|não confirme/i);
  assert.match(out.message,/mantendo|preservando/i);
  assert.deepEqual(input,before);assert.deepEqual(out.appliedPlan,input);
  assert.equal(out.appliedPlan.attributes[0].priority,"required");
});

test("a similar alternative discloses unconfirmed indication rather than calling the buyer skin a preference",()=>{
  const input=plan("preferred"),out=shoppingRecoveryEvidence(input,[{id:"bruma",name:"Bruma facial",variants:[{attributes:{perfume:"não"}}]}],"similar");
  assert.match(out.message,/indicação para pele oleosa não confirmada/i);
  assert.doesNotMatch(out.message,/preferência oleosa|indicad[oa] para pele oleosa|ideal/i);
  assert.deepEqual(out.unconfirmedPreferences,["indicação publicada para pele oleosa"]);
  assert.deepEqual(out.appliedPlan,input);
});

test("exact public skin-type evidence is described as a published indication, not a clinical suitability claim",()=>{
  const out=shoppingSearchEvidence(plan(),1);
  assert.match(out.message,/indicação publicada para pele oleosa/i);
  assert.doesNotMatch(out.message,/ideal|tratamento|garanti/i);
});

test("unrelated mandatory color, compatibility and exclusions keep their original requirements and copy",()=>{
  for(const attribute of [{name:"cor",value:"azul",operator:"equals"},{name:"compatibilidade",value:"USB-C",operator:"equals"},
    {name:"material",value:"couro",operator:"not_equals"}] as const){
    const input=shoppingSearchPlanSchema.parse({version:1,query:"organizador",maxPriceCents:7000,
      attributes:[{...attribute,priority:"required"}],recovery:{familyQuery:"organizador",optionalQueryTerms:[]}});
    const before=structuredClone(input),out=shoppingRecoveryEvidence(input,[],"no_match");
    assert.match(out.message,/aceita flexibilizar/);assert(out.message.includes(attribute.name));
    assert(out.message.includes(attribute.value));assert.match(out.message,/70,00/);
    assert.deepEqual(out.appliedPlan,before);assert.deepEqual(input,before);
  }
});
