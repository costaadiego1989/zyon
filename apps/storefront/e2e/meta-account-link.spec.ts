import { test, expect, type Page } from "@playwright/test";
async function setup(page: Page, outcome = 201) {
  await page.addInitScript(()=>localStorage.setItem("zyon_buyer_token","local."+btoa(JSON.stringify({sub:"local-buyer",exp:Math.floor(Date.now()/1000)+3600}))+".fixture"));
  const bodies: {path:string;body:any}[]=[];
  await page.route("**/api/v1/buyer/me/channels/whatsapp**", async route=>{
    const req=route.request();
    if(req.method()==="GET")return route.fulfill({json:{linked:false,phone:null}});
    const path=new URL(req.url()).pathname;const body=req.postDataJSON();bodies.push({path,body});
    if(path.endsWith("/code"))return route.fulfill({status:outcome,json:outcome===201?{sent:true,delivered_to:"***4321"}:{message:"otp_whatsapp_delivery_unavailable"}});
    return route.fulfill({json:{linked:true,phone:"+55 (***) *****-4321"}});
  });
  await page.goto("/");await expect(page.getByRole("heading",{name:"Meu perfil"})).toBeVisible();
  return bodies;
}
test("profile exposes linking without cashback and send/confirm retains the original issuing store",async({page})=>{
  const bodies=await setup(page);
  const section=page.getByRole("region",{name:"Mesma conta no WhatsApp"});
  await expect(section).toBeVisible();
  await section.getByLabel("Número do WhatsApp").fill("+55 11 98765-4321");
  await section.getByRole("button",{name:"Enviar código",exact:true}).click();
  await expect(section.getByText("Código enviado ao WhatsApp",{exact:false})).toBeVisible();
  expect(bodies[0].body).toEqual({phone:"+5511987654321",merchantId:"store-a"});
  await page.getByRole("button",{name:"Trocar loja de teste"}).click();
  await section.getByLabel("Código de seis dígitos").fill("123456");
  await section.getByRole("button",{name:"Confirmar WhatsApp",exact:true}).click();
  await expect(section.getByText("WhatsApp vinculado",{exact:true})).toBeVisible();
  expect(bodies[1].body).toEqual({phone:"+5511987654321",code:"123456",merchantId:"store-a"});
  await expect(section).toContainText("4321");await expect(section).not.toContainText("5511987654321");
});
test("invalid phone blocks submission and provider refusal shows safe copy without a sent state",async({page})=>{
  const bodies=await setup(page,503);const section=page.getByRole("region",{name:"Mesma conta no WhatsApp"});
  await section.getByLabel("Número do WhatsApp").fill("123");await section.getByRole("button",{name:"Enviar código",exact:true}).click();
  await expect(section.getByRole("alert")).toContainText("código do país");expect(bodies).toHaveLength(0);
  await section.getByLabel("Número do WhatsApp").fill("+5511987654321");await section.getByRole("button",{name:"Enviar código",exact:true}).click();
  await expect(section.getByRole("alert")).toContainText("Não foi possível enviar o código pelo WhatsApp da loja");
  await expect(section.getByLabel("Código de seis dígitos")).toHaveCount(0);await expect(section).not.toContainText("otp_whatsapp");
  expect(bodies).toHaveLength(1);
});
