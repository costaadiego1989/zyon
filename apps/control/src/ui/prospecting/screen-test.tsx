import {act,type ReactNode} from "react";
import {createRoot} from "react-dom/client";
import {afterEach,vi} from "vitest";
import type {ProspectingApi} from "../../lib/prospecting-api.js";

export function screenProps(methods:Partial<Record<keyof ProspectingApi,unknown>>){
 return {api:methods as ProspectingApi,operatorId:"operator-test",onSessionExpired:vi.fn(),navigate:vi.fn()};
}
export async function show(node:ReactNode){
 const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
 mounted.push(async()=>{await act(async()=>root.unmount());host.remove();});
 await act(async()=>root.render(node));
 function control(label:string){const el=[...host.querySelectorAll("label")].find(x=>x.firstChild?.textContent===label)?.control??host.querySelector('[aria-label="'+label+'"]');if(!el)throw Error("Missing control "+label);return el as HTMLInputElement;}
 async function fill(label:string,value:string){const el=control(label);await act(async()=>{Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el),"value")!.set!.call(el,value);el.dispatchEvent(new Event(el.tagName==="SELECT"?"change":"input",{bubbles:true}));});}
 function button(name:string){const el=[...host.querySelectorAll("button")].find(x=>x.textContent?.trim()===name);if(!el)throw Error("Missing button "+name+" / "+host.textContent);return el;}
 async function click(name:string){await act(async()=>button(name).click());}
 async function check(label:string){await act(async()=>control(label).click());}
 return {host,fill,click,check,control,button,text:()=>host.textContent??""};
}
const mounted:(()=>Promise<void>)[]=[];
afterEach(async()=>{while(mounted.length)await mounted.pop()!();sessionStorage.clear();});
