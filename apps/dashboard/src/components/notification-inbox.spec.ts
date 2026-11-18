// @vitest-environment jsdom
import {createElement} from 'react';
import { describe, expect, it } from "vitest";
import {NotificationBell} from './NotificationBell.js';
import {ui} from '../pages/meta-ads-agent/test-helpers.js';
import { mapInboxNotification, notificationDate, campaignReviewHash, campaignReviewLocation } from "./notification-inbox.js";

describe("merchant notification inbox", () => {
  it("keeps the inventory product description and navigation metadata", () => {
    expect(mapInboxNotification({ id: "stock:1", type: "inventory_alert", title: "Estoque abaixo do limite", body: "Tênis Azul — 3 unidades disponíveis (SKU-A)", createdAt: "2026-09-24T21:35:00Z", metadata: { inventoryAlertId: "alert-1", itemId: "item-1", sku: "SKU-A" } })).toMatchObject({ body: "Tênis Azul — 3 unidades disponíveis (SKU-A)", inventoryAlertId: "alert-1", inventoryItemId: "item-1", sku: "SKU-A" });
  });
  it("accepts legacy notifications without a body", () => {
    expect(mapInboxNotification({ id: "1", title: "Aviso", type: "plan_expiry" })).toMatchObject({ id: "1", title: "Aviso", type: "plan_expiry", createdAt: "" });
  });
  it.each([null, [], {}, { id: "1" }, { title: "Aviso" }, { id: " ", title: "Aviso" }])("ignores malformed notification %j", value => {
    expect(mapInboxNotification(value)).toBeNull();
  });
  it("treats unfamiliar types as generic messages without trusting malformed fields", () => {
    expect(mapInboxNotification({ id: "1", title: "Aviso", type: "future_type", body: {}, metadata: { itemId: 123, hypothesisId: "hyp-1" } })).toMatchObject({ type: "message", body: undefined, inventoryItemId: undefined, hypothesisId: "hyp-1" });
  });
  it("preserves text without interpreting HTML", () => {
    expect(mapInboxNotification({ id: "1", title: "Aviso", body: '<img src=x onerror="alert(1)">' })?.body).toBe('<img src=x onerror="alert(1)">');
  });
  it("handles missing or invalid timestamps", () => {
    expect(notificationDate("")).toBe("Data indisponível");
    expect(notificationDate("invalid")).toBe("Data indisponível");
    expect(notificationDate("2026-09-24T21:35:00Z")).toContain("24");
  });
});

const campaignNotice=(metadata:Record<string,unknown>={})=>mapInboxNotification({id:'notice1',type:'campaign_ready',title:'Campanha pronta',metadata:{merchantId:'store1',campaignId:'campaign1',proposalId:'proposal1',proposalDigest:'a'.repeat(64),reviewState:'awaiting_approval',...metadata}})!;
describe('ACAP-18 canonical review navigation',()=>{
 it('a real inbox click opens the exact review URL without carrying private conversation',async()=>{const screen=ui();try{const item=campaignNotice();await screen.render(createElement(NotificationBell,{notifications:[item],onClear:()=>{},onClickNotification:n=>{const hash=campaignReviewHash(n,'store1','ADMIN');if(hash)window.location.hash=hash;}}));await screen.click('Notificações (1 novas)');const button=Array.from(document.querySelectorAll<HTMLButtonElement>('.notification-inbox__item'))[0];expect(button).toBeDefined();await import('react').then(({act})=>act(async()=>button.click()));expect(window.location.hash).toBe('#meta-ads-agent?store=store1&campaign=campaign1&proposal=proposal1');expect(document.querySelector('.notification-inbox')).toBeNull();}finally{await screen.close();window.location.hash='';}});
 it('maps only campaign target without private thread or supplied external URL',()=>{const item=campaignNotice({threadId:'private',reviewUrl:'https://evil.example',accessToken:'private-token'});expect(item.campaignReview).toEqual({merchantId:'store1',campaignId:'campaign1',proposalId:'proposal1'});expect(JSON.stringify(item)).not.toContain('private');expect(JSON.stringify(item)).not.toContain('evil');});
 it.each(['OWNER','ADMIN'])('opens canonical same-store review for %s',role=>{const hash=campaignReviewHash(campaignNotice(),'store1',role);expect(hash).toBe('#meta-ads-agent?store=store1&campaign=campaign1&proposal=proposal1');expect(campaignReviewLocation(hash!,'store1',role)).toEqual({target:{merchantId:'store1',campaignId:'campaign1',proposalId:'proposal1'},error:''});});
 it('foreign store never obtains a readable review target',()=>{expect(campaignReviewHash(campaignNotice(),'store2','OWNER')).toBeNull();expect(campaignReviewLocation('#meta-ads-agent?store=store1&campaign=campaign1&proposal=proposal1','store2','OWNER')).toEqual({target:null,error:'Esta revisão pertence a outra loja. Selecione a loja correta no dashboard.'});});
 it('staff cannot turn inbox metadata into administrative navigation',()=>{expect(campaignReviewHash(campaignNotice(),'store1','STAFF')).toBeNull();expect(campaignReviewLocation('#meta-ads-agent?store=store1&campaign=campaign1&proposal=proposal1','store1','STAFF').target).toBeNull();});
 it('malformed target stays a harmless notice',()=>{for(const value of [null,{},'../other','campaign?approve=true'])expect(campaignNotice({campaignId:value}).campaignReview).toBeUndefined();expect(campaignReviewHash(campaignNotice({campaignId:null}),'store1','OWNER')).toBeNull();});
 it('superseded and approved notices retain only canonical version references',()=>{for(const reviewState of ['approved','superseded'])expect(campaignReviewHash(campaignNotice({reviewState}),'store1','ADMIN')).toBe('#meta-ads-agent?store=store1&campaign=campaign1&proposal=proposal1');});
 it('rejects ambiguous or incomplete direct links and ignores unrelated pages',()=>{for(const hash of ['#meta-ads-agent?store=store1&campaign=campaign1','#meta-ads-agent?store=store1&campaign=campaign1&proposal=a&proposal=b']){expect(campaignReviewLocation(hash,'store1','OWNER').target).toBeNull();expect(campaignReviewLocation(hash,'store1','OWNER').error).toContain('inválido');}expect(campaignReviewLocation('#inventory','store1','OWNER')).toEqual({target:null,error:''});});
 it('generic notification cannot supply a campaign navigation even with copied metadata',()=>{const item=mapInboxNotification({id:'n',title:'n',type:'message',metadata:{merchantId:'store1',campaignId:'campaign1',proposalId:'proposal1'}})!;expect(item.campaignReview).toBeUndefined();expect(campaignReviewHash(item,'store1','OWNER')).toBeNull();});
});
