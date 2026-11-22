import {expect,test,vi} from "vitest";
import {useState} from "react";
import {ProspectDetailPage} from "./ProspectDetailPage.js";
import {screenProps,show} from "./screen-test.js";
import type {ProspectRoute} from "./ProspectingShell.js";
const record={id:"lead",cnpj:"12ABC34501DE35",stage:"responded",assignedOperatorId:"Ana",version:3,contacts:[{endpointId:"ep",identity:{kind:"bsuid",value:"opaque-a"},permission:"no_opt_in",confirmationState:"ambiguous"}],firstAttemptAt:"2026-10-01T10:00:00Z",lastReplyPreview:"Quero informações",tags:[]};
function detail(){return {prospect:record,company:{legalName:"Oficina Brasil",competence:"2026-10",contacts:[{originalValue:"(11) 3333-1234",channel:"phone"}]},conversationId:null};}
test("PROS-25 AC1 lista abre ficha, mantém contatos distintos e pagina conversões verificadas",async()=>{
 const conversions=vi.fn().mockResolvedValueOnce({items:[{id:"unknown",state:"allocation_coverage_unknown",planKey:"growth",provider:"stripe"}],nextCursor:"more"}).mockResolvedValueOnce({items:[{id:"paid",state:"paid",planKey:"growth",provider:"stripe"},{id:"refund",state:"refunded",planKey:"growth",provider:"stripe"}],nextCursor:null});
 const props=screenProps({prospects:async()=>({items:[record],nextCursor:null}),prospect:async()=>detail(),conversions});
 function Flow(){const [route,navigate]=useState<ProspectRoute>({area:"leads"});return <ProspectDetailPage {...props} route={route} navigate={navigate}/>;}
 const ui=await show(<Flow/>);await ui.click(record.cnpj);expect(ui.text()).toContain("Oficina Brasil");expect(ui.text()).toContain("2026-10");expect(ui.text()).toContain("Respondeu");expect(ui.text()).toContain("Ana");expect(ui.text()).toContain("Quero informações");expect(ui.text()).toContain("(11) 3333-1234");expect(ui.text()).toContain("opaque-a");expect(ui.text()).toContain("Sem opt-in");
 await ui.click("Conversões anteriores");expect(conversions.mock.calls[1][1].cursor).toBe("more");expect(ui.text()).toContain("Cobertura de alocação desconhecida");expect(ui.text()).toContain("Pagamento confirmado");expect(ui.text()).toContain("Reembolso integral");
});
test("PROS-25 AC3 somente confirmação persistida informa bloqueio e cancelamentos",async()=>{
 const suppress=vi.fn().mockRejectedValueOnce(new Error()).mockResolvedValueOnce({suppressed:true,cancelledAttempts:2,inFlightAttempts:1});
 const props=screenProps({prospect:vi.fn().mockResolvedValueOnce(detail()).mockResolvedValue({...detail(),prospect:{...record,suppressed:true,stage:"do_not_contact"}}),conversions:async()=>({items:[],nextCursor:null}),suppress});
 const ui=await show(<ProspectDetailPage {...props} route={{area:"leads",id:"lead"}}/>);await ui.click("Não contatar");expect(suppress).not.toHaveBeenCalled();
 await ui.fill("Motivo do bloqueio","Solicitação da empresa");await ui.click("Confirmar não contatar");expect(ui.text()).toContain("Não foi possível");expect(ui.text()).not.toContain("2 cancelada(s)");
 await ui.click("Confirmar não contatar");expect(suppress.mock.calls[1][1]).toMatchObject({expectedVersion:3,reason:"Solicitação da empresa"});expect(ui.text()).toContain("2 cancelada(s)");expect(ui.text()).toContain("1 em andamento");expect(ui.text()).toContain("Contato bloqueado");
});
