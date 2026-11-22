import {createRoot} from "react-dom/client";
import {PlatformApi,resolvePlatformApiBaseUrl} from "../src/lib/api.js";
import {readPlatformSession} from "../src/lib/session.js";
import {ProspectChat} from "../src/ui/prospecting/ProspectChat.js";

// Component composition for the browser gate. Use the session created by the actual Control login.
export async function mountChat(element:HTMLElement,requestedId:string|null) {
  const session=readPlatformSession();
  if(!session)throw Error("operator_session_required");
  const api=new PlatformApi(resolvePlatformApiBaseUrl(import.meta.env)).prospectingClient(session.token);
  const conversationId=requestedId??(await api.conversations({limit:1})).items[0]?.id;
  if(!conversationId){element.textContent="Nenhuma conversa disponível.";return;}
  createRoot(element).render(<ProspectChat api={api} conversationId={conversationId} operatorId={session.operator.operator_id}
    onSessionExpired={()=>{location.reload();}}/>);
}
