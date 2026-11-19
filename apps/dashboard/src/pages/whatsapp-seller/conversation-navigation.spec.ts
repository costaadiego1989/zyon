import { describe, expect, it } from "vitest";
import { readWhatsAppRoute, whatsAppRouteUrl } from "./conversation-navigation.js";

describe("T62 WhatsApp tabs and ticket selection follow the URL without granting authority", () => {
  it("reads a conversation deep link for each permitted role without adopting URL identity fields", () => {
    for (const role of ["OWNER", "ADMIN", "STAFF"] as const) {
      expect(readWhatsAppRoute("#whatsapp-seller?tab=conversations&ticketId=opaque-ticket&merchant_id=foreign&user_id=other", role))
        .toEqual({ allowed: true, tab: "conversations", ticketId: "opaque-ticket" });
    }
  });
  it("uses the existing connection default for configuration roles and Conversations for Staff", () => {
    expect(readWhatsAppRoute("#whatsapp-seller", "OWNER")).toEqual({ allowed: true, tab: "connection", ticketId: null });
    expect(readWhatsAppRoute("#whatsapp-seller", "ADMIN")).toEqual({ allowed: true, tab: "connection", ticketId: null });
    expect(readWhatsAppRoute("#whatsapp-seller", "STAFF")).toEqual({ allowed: true, tab: "conversations", ticketId: null });
  });
  it("retains all existing tabs for Owner/Admin and denies those same URLs to Staff", () => {
    for (const tab of ["connection", "templates", "orders", "usage"]) {
      for (const role of ["OWNER", "ADMIN"]) expect(readWhatsAppRoute("#whatsapp-seller?tab=" + tab, role)).toEqual({ allowed: true, tab, ticketId: null });
      expect(readWhatsAppRoute("#whatsapp-seller?tab=" + tab + "&ticketId=private", "STAFF")).toEqual({ allowed: false, tab: null, ticketId: null });
    }
  });
  it("fails closed for an unknown or missing role", () => {
    for (const role of [undefined, "staff", "SUPERUSER"]) expect(readWhatsAppRoute("#whatsapp-seller?tab=conversations&ticketId=private", role))
      .toEqual({ allowed: false, tab: null, ticketId: null });
  });
  it("does not convert other dashboard routes or an invalid tab into a conversation", () => {
    for (const hash of ["#overview?tab=conversations", "#whatsapp?tab=conversations", "#whatsapp-seller?tab=unknown"]) {
      expect(readWhatsAppRoute(hash, "STAFF")).toEqual({ allowed: false, tab: null, ticketId: null });
    }
  });
  it("roundtrips an opaque ticket through a URL exactly once", () => {
    const ticket = "opaque/ticket?value=1&fragment#x +ç";
    const url = whatsAppRouteUrl("conversations", ticket);
    expect(url).toContain("ticketId=" + encodeURIComponent(ticket));
    expect(readWhatsAppRoute(url, "STAFF")).toEqual({ allowed: true, tab: "conversations", ticketId: ticket });
  });
  it("closing removes only ticketId and keeps the Conversations tab and unrelated view parameters", () => {
    const url = whatsAppRouteUrl("conversations", null, "#whatsapp-seller?tab=conversations&ticketId=old&view=waiting");
    const params = new URLSearchParams(url.split("?")[1]);
    expect(params.get("tab")).toBe("conversations"); expect(params.has("ticketId")).toBe(false); expect(params.get("view")).toBe("waiting");
  });
  it("switching to configuration never keeps a selected conversation in that tab", () => {
    const url = whatsAppRouteUrl("usage", "stale-ticket", "#whatsapp-seller?tab=conversations&ticketId=old");
    expect(readWhatsAppRoute(url, "OWNER")).toEqual({ allowed: true, tab: "usage", ticketId: null });
    expect(new URLSearchParams(url.split("?")[1]).has("ticketId")).toBe(false);
  });
});
