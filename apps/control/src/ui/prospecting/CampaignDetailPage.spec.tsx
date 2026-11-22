import {expect,test,vi} from "vitest";
import {CampaignDetailPage} from "./CampaignDetailPage.js";
import {ProspectCommandUnresolved} from "../../lib/prospecting-api.js";
import {screenProps,show} from "./screen-test.js";
const base={id:"campaign",name:"Campanha local",state:"running",revision:4,recipientCount:2,blockers:[]};
test("PROS-26 AC3 pausa e retoma por revisão, consulta comando interrompido sem reenviar destinatário",async()=>{
 const current={...base};const pauseOrResume=vi.fn(async(_id,cmd)=>{if(cmd.action==="pause"){current.state="paused";throw new ProspectCommandUnresolved(cmd.clientRequestId,"outcome_unknown");}current.state="running";return {...current};});
 const recipients=vi.fn(async(_id,cursor)=>({items:cursor?[{id:"r2",frozenSnapshot:{cnpj:"00000000000191"},eligibility:"no_opt_in",blockers:["no_opt_in"],state:"blocked"}]:[{id:"r1",frozenSnapshot:{cnpj:"12ABC34501DE35"},eligibility:"opted_in",blockers:[],state:"outcome_unknown",followUpDueAt:"2026-11-04T10:00:00Z"}],nextCursor:cursor?null:"more"}));
 const command=vi.fn(async(key)=>({state:"completed",clientRequestId:key}));
 const props=screenProps({campaign:async()=>({...current}),recipients,pauseOrResume,command});const ui=await show(<CampaignDetailPage {...props} id={base.id}/>);
 expect(ui.text()).toContain("Resultado desconhecido");expect(ui.text()).toContain("04/11/2026");await ui.click("Pausar campanha");expect(ui.text()).toContain("pendente");await ui.click("Consultar resultado do comando");expect(command.mock.calls[0][0]).toBe(pauseOrResume.mock.calls[0][1].clientRequestId);expect(ui.text()).toContain("Pausada");
 await ui.click("Retomar campanha");expect(pauseOrResume.mock.calls[1][1]).toMatchObject({expectedRevision:4,action:"resume"});expect(ui.text()).toContain("Em execução");expect(ui.text()).not.toContain("Reenviar");await ui.click("Próxima página");expect(ui.text()).toContain("Sem opt-in");expect(ui.text()).toContain("00000000000191");
});
