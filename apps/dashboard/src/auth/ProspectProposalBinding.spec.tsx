// @vitest-environment jsdom
import React,{act} from "react";
import {createRoot} from "react-dom/client";
import {expect,it,vi} from "vitest";
import {ProspectProposalBinding,readProspectProposal,clearProspectProposal} from "./ProspectProposalBinding.js";
it("carries opaque signup intent through login and binds only after the merchant selects the account",async()=>{
 (globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
 const token="p".repeat(43);history.replaceState({},"","/?mode=signup&plan=growth&proposal="+token);
 expect(readProspectProposal()).toBe(token);history.replaceState({},"","/?mode=signin");expect(readProspectProposal()).toBe(token);
 const div=document.createElement("div"),root=createRoot(div),bind=vi.fn().mockResolvedValue({next:"manage_subscription"}),done=vi.fn();
 await act(async()=>root.render(<ProspectProposalBinding token={token} name="Loja A" bind={bind} done={done}/>));
 expect(div.textContent).toContain("Loja A");expect(bind).not.toHaveBeenCalled();await act(async()=>div.querySelector("button")!.click());
 expect(bind).toHaveBeenCalledExactlyOnceWith(token);expect(done).toHaveBeenCalledExactlyOnceWith("manage_subscription");
 clearProspectProposal();expect(readProspectProposal()).toBe(null);await act(async()=>root.unmount());
});
