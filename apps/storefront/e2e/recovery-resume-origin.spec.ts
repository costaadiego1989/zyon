import { test, expect, type Page } from "@playwright/test";
const native="https://wa.me/5521999990000?text=Ver+carrinho";
async function open(page:Page,body:unknown,status=200) {
  const requests:unknown[]=[];
  await page.route("**/api/v1/storefront/local-shop/recovery",async route=>{requests.push(route.request().postDataJSON());await route.fulfill({status,json:body});});
  await page.goto("/");return requests;
}
test("native recovery offers and follows the WhatsApp continuation without website login",async({page})=>{
  const requests=await open(page,{merchant_id:"local-store",resume_channel:"whatsapp",whatsapp_resume_url:native});
  const link=page.getByRole("link",{name:"Continuar no WhatsApp",exact:true});
  await expect(link).toHaveAttribute("href",native);await expect(page.getByRole("heading",{name:"Continue no WhatsApp"})).toBeVisible();
  await expect(page.getByText("Entre com o e-mail usado na compra",{exact:false})).toHaveCount(0);
  expect(requests).toEqual([{token:"local-recovery-token"}]);
  await page.route("https://wa.me/**",route=>route.fulfill({contentType:"text/html",body:"<h1>Conversa WhatsApp local</h1>"}));
  await link.click();await expect(page).toHaveURL(native);await expect(page.getByRole("heading",{name:"Conversa WhatsApp local"})).toBeVisible();
});
for(const url of ["https://evil.example/", "https://wa.me.evil.example/5521999990000?text=Ver+carrinho", "https://user@wa.me/5521999990000?text=Ver+carrinho", "http://wa.me/5521999990000?text=Ver+carrinho", "https://wa.me/5521999990000?text=Outro", "https://wa.me/5521999990000?text=Ver+carrinho&text=Outro"]) {
  test(`native recovery refuses an invalid destination ${url}`,async({page})=>{
    await open(page,{merchant_id:"local-store",resume_channel:"whatsapp",whatsapp_resume_url:url,embed_session_token:"must-not-open-website-checkout"});
    await expect(page.getByRole("alert")).toContainText("Não foi possível abrir o WhatsApp da loja");
    await expect(page.getByRole("link",{name:"Continuar no WhatsApp"})).toHaveCount(0);
    await expect(page.getByText("Entre com o e-mail usado na compra",{exact:false})).toHaveCount(0);
  });
}
test("storefront recovery still requests the original website buyer and can be closed",async({page})=>{
  await open(page,{code:"recovery_buyer_login_required"},401);
  await expect(page.getByText("Entre com o e-mail usado na compra para revisar os itens, a entrega e o pagamento.")).toBeVisible();
  await expect(page.getByRole("link",{name:"Continuar no WhatsApp"})).toHaveCount(0);
  await page.getByRole("button",{name:"Voltar à loja",exact:true}).click();await expect(page.getByText("Recuperação fechada")).toBeVisible();
});
test("foreign merchant native responses never expose a continuation control",async({page})=>{
  await open(page,{merchant_id:"foreign-store",resume_channel:"whatsapp",whatsapp_resume_url:native});
  await expect(page.getByRole("alert")).toBeVisible();await expect(page.getByRole("link",{name:"Continuar no WhatsApp"})).toHaveCount(0);
});
