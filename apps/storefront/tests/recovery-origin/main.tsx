import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import RecoveryCheckoutPanel from "../../src/components/RecoveryCheckoutPanel";
function Fixture() {
  const [closed,setClosed]=useState(false);
  return closed?<p>Recuperação fechada</p>:<RecoveryCheckoutPanel token="local-recovery-token" slug="local-shop" merchantId="local-store" storeName="Loja local" theme="light" onClose={()=>setClosed(true)}/>;
}
createRoot(document.getElementById("root")!).render(<Fixture/>);
