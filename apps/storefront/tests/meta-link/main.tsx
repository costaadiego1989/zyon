import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import ProfileTab from "../../src/components/buyer-hub/tabs/ProfileTab";
function Fixture() {
  const [merchantId,setMerchantId]=useState("store-a");
  return <><button onClick={()=>setMerchantId("store-b")}>Trocar loja de teste</button><ProfileTab merchantId={merchantId} profile={{display_name:"Comprador local",email:"buyer@example.test"} as any} addresses={[]} loading={false} onUpdateProfile={async()=>{}} onAddAddress={async()=>{}} onUpdateAddress={async()=>{}} onDeleteAddress={async()=>{}} /></>;
}
createRoot(document.getElementById("root")!).render(<Fixture/>);
