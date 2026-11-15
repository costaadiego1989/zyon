import React from "react";
import {createRoot} from "react-dom/client";
import {StorefrontConsent} from "../../../storefront/src/components/StorefrontConsent";
import {MetaAdsAttribution} from "../../../storefront/src/components/MetaAdsAttribution";
import {rememberConversationAccess} from "../../../storefront/src/lib/conversation-access";
const backend="http://127.0.0.1:3018";
const config=await(await fetch(backend+"/__test/buyer-config")).json(); rememberConversationAccess("conversation-a",config.capability);
async function pay() {await fetch(backend+"/__test/buyer-paid",{method:"POST"});window.dispatchEvent(new CustomEvent("aacp:order-completed",{detail:{merchantId:"store-a",cartRef:"conversation-a",sessionId:"checkout-a",orderId:"external-a"}}));}
createRoot(document.getElementById("root")!).render(<StorefrontConsent storeKey="store-a" merchantId="store-a" storeName="Loja de teste" fbPixelId={config.pixelId}><main><h1>Compra de teste</h1><MetaAdsAttribution merchantId="store-a" conversationId="conversation-a"/><button type="button" onClick={()=>void pay()}>Confirmar pagamento do teste</button></main></StorefrontConsent>);
