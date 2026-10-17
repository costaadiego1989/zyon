import { useState } from "react";
import { createRoot } from "react-dom/client";
import { BuyerHubTrigger } from "../../../src/components/BuyerHubTrigger";
import { BuyerSupportConversations } from "../../../src/components/buyer-hub/BuyerSupportConversations";
import { useBuyerSupportInbox } from "../../../src/lib/viewmodels/useBuyerSupportInbox";
import { clearBuyerSession } from "../../../src/lib/buyer-auth";
function Fixture() {
  const [open, setOpen] = useState(false);
  const [merchantId, setMerchant] = useState("store-1");
  const inbox = useBuyerSupportInbox(merchantId);
  return <main><nav><BuyerHubTrigger unreadCount={inbox.unreadCount} onClick={() => setOpen(!open)} />
    <button onClick={() => setMerchant("store-2")}>Outra loja</button><button onClick={clearBuyerSession}>Sair</button></nav>
    {open && <BuyerSupportConversations inbox={inbox} />}</main>;
}
const style = document.createElement("style");
style.textContent = ":root{--aacp-fg:#26332c;--aacp-muted:#59665e;--aacp-accent:#397456;--aacp-line:#d5dcd6;--aacp-surface-2:#edf1eb;--aacp-card:#fff;--aacp-bg:#f5f7f2}*{box-sizing:border-box}body{margin:0;font-family:Arial;background:var(--aacp-bg);color:var(--aacp-fg)}main{width:min(100%,480px);margin:auto;padding:20px}nav{display:flex;align-items:center;gap:12px;margin-bottom:24px}button{min-height:30px}";
document.head.append(style);
createRoot(document.getElementById("root")!).render(<Fixture />);
