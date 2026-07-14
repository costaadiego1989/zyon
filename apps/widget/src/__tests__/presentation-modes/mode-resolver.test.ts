import { describe, it, expect } from "vitest";
import {
  resolvePresentationMode,
  resolvePositionStyles,
  resolveFabColor,
  resolveInviteText,
  resolveShowCartBadge,
  type PresentationConfigInput,
  type PresentationMode,
} from "../../components/presentation/mode-resolver.js";

const base: PresentationConfigInput = {
  presentationMode: undefined,
  position: "bottom_right",
  fabColor: "#ff5500",
  inviteText: "Posso ajudar?",
  showCartBadge: true,
  accentColor: "#3b82f6",
};

describe("mode-resolver", () => {
  it("defaults to 'fab' when presentationMode is undefined", () => {
    expect(resolvePresentationMode(base)).toBe("fab");
  });

  it("defaults to 'fab' when presentationMode is empty string", () => {
    expect(resolvePresentationMode({ ...base, presentationMode: "" as unknown as PresentationMode })).toBe("fab");
  });

  it("passes through 'mini_card'", () => {
    expect(resolvePresentationMode({ ...base, presentationMode: "mini_card" })).toBe("mini_card");
  });

  it("passes through 'bottom_banner'", () => {
    expect(resolvePresentationMode({ ...base, presentationMode: "bottom_banner" })).toBe("bottom_banner");
  });

  it("passes through 'trigger_only'", () => {
    expect(resolvePresentationMode({ ...base, presentationMode: "trigger_only" })).toBe("trigger_only");
  });

  it("passes through 'inline'", () => {
    expect(resolvePresentationMode({ ...base, presentationMode: "inline" })).toBe("inline");
  });

  it("falls back to 'fab' for unknown mode", () => {
    expect(resolvePresentationMode({ ...base, presentationMode: "nonsense" as unknown as PresentationMode })).toBe("fab");
  });

  it("resolvePositionStyles bottom_right → right: 24px, bottom: 24px", () => {
    const styles = resolvePositionStyles("bottom_right");
    expect(styles.right).toBe("24px");
    expect(styles.bottom).toBe("24px");
    expect(styles.left).toBeUndefined();
    expect(styles.top).toBeUndefined();
  });

  it("resolvePositionStyles bottom_left → left: 24px, bottom: 24px", () => {
    const styles = resolvePositionStyles("bottom_left");
    expect(styles.left).toBe("24px");
    expect(styles.bottom).toBe("24px");
    expect(styles.right).toBeUndefined();
    expect(styles.top).toBeUndefined();
  });

  it("resolveFabColor uses fabColor when present", () => {
    expect(resolveFabColor(base)).toBe("#ff5500");
  });

  it("resolveFabColor falls back to accentColor when fabColor missing", () => {
    expect(resolveFabColor({ ...base, fabColor: undefined })).toBe("#3b82f6");
  });

  it("resolveFabColor falls back to blue default when both missing", () => {
    expect(resolveFabColor({ ...base, fabColor: undefined, accentColor: undefined })).toBeTruthy();
    expect(resolveFabColor({ ...base, fabColor: undefined, accentColor: undefined })).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("resolveInviteText defaults to 'Posso ajudar?'", () => {
    expect(resolveInviteText({ ...base, inviteText: undefined })).toBe("Posso ajudar?");
  });

  it("resolveInviteText uses provided text", () => {
    expect(resolveInviteText({ ...base, inviteText: "Oi! Vamos finalizar?" })).toBe("Oi! Vamos finalizar?");
  });

  it("resolveShowCartBadge defaults to true", () => {
    expect(resolveShowCartBadge({ ...base, showCartBadge: undefined })).toBe(true);
  });

  it("resolveShowCartBadge respects explicit false", () => {
    expect(resolveShowCartBadge({ ...base, showCartBadge: false })).toBe(false);
  });
});