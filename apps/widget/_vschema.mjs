import { startCheckoutResponseSchema } from "./src/lib/widget-schemas.ts";
const r = await fetch("http://localhost:3009/start-checkout",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({merchant_id:"mrc_athom_tech",cart:{currency:"BRL",source:"storefront",total:299.9,items:[{sku:"athom-kit-001",name:"Kit",price:299.9,cost:140,quantity:1,imageUrl:"x",productUrl:"y",category:"Smart Home",variant:"Padrão"}]},customer:{email:"a@b.com",isReturning:false}})});
const j = await r.json();
const res = startCheckoutResponseSchema.safeParse(j);
console.log("PARSE_OK:", res.success);
if(!res.success) console.log(JSON.stringify(res.error.issues.slice(0,10),null,2));
