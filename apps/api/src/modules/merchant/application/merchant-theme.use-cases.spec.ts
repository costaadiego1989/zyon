import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_MERCHANT_THEME } from "@zyon/shared-types";
import { GetMerchantThemeUseCase } from "./get-merchant-theme.use-case.js";
import { UpdateMerchantThemeUseCase } from "./update-merchant-theme.use-case.js";
import { InMemoryMerchantRepository } from "../infrastructure/in-memory-merchant.repository.js";

function repoWithMerchant(): InMemoryMerchantRepository {
  const repo = new InMemoryMerchantRepository();
  repo.seedProfile({ id: "m1", name: "Demo" });
  return repo;
}

test("GetMerchantThemeUseCase returns default theme when none stored", async () => {
  const repo = repoWithMerchant();
  const result = await new GetMerchantThemeUseCase(repo, {} as any).execute("m1");
  assert.deepEqual(result, DEFAULT_MERCHANT_THEME);
});

test("UpdateMerchantThemeUseCase rejects invalid hex color", async () => {
  const repo = repoWithMerchant();
  await assert.rejects(
    new UpdateMerchantThemeUseCase(repo).execute("m1", {
      ...DEFAULT_MERCHANT_THEME,
      surfaceColor: "blue"
    }),
    /invalid_color:surfaceColor/
  );
});

test("UpdateMerchantThemeUseCase rejects insecure logo url", async () => {
  const repo = repoWithMerchant();
  await assert.rejects(
    new UpdateMerchantThemeUseCase(repo).execute("m1", {
      ...DEFAULT_MERCHANT_THEME,
      logoUrl: "http://insecure.example/logo.png"
    }),
    /invalid_logo_url/
  );
});

test("UpdateMerchantThemeUseCase rejects invalid enterprise theme options", async () => {
  const repo = repoWithMerchant();
  await assert.rejects(
    new UpdateMerchantThemeUseCase(repo).execute("m1", {
      ...DEFAULT_MERCHANT_THEME,
      backgroundImageUrl: "http://insecure.example/bg.png"
    }),
    /invalid_background_image_url/
  );
  await assert.rejects(
    new UpdateMerchantThemeUseCase(repo).execute("m1", {
      ...DEFAULT_MERCHANT_THEME,
      borderRadius: 40
    }),
    /invalid_border_radius/
  );
  await assert.rejects(
    new UpdateMerchantThemeUseCase(repo).execute("m1", {
      ...DEFAULT_MERCHANT_THEME,
      density: "tiny" as never
    }),
    /invalid_density/
  );
  await assert.rejects(
    new UpdateMerchantThemeUseCase(repo).execute("m1", {
      ...DEFAULT_MERCHANT_THEME,
      trustBadges: ["A", "B", "C", "D", "E"]
    }),
    /invalid_trust_badges/
  );
});

test("UpdateMerchantThemeUseCase persists valid theme and GetMerchantThemeUseCase returns it", async () => {
  const repo = repoWithMerchant();
  const next = {
    ...DEFAULT_MERCHANT_THEME,
    accentColor: "#FF0066",
    fontFamily: "Manrope, system-ui, sans-serif",
    fontDisplay: "Sora, Manrope, sans-serif",
    logoUrl: "https://cdn.example/logo.png",
    agentAvatarUrl: "https://cdn.example/avatar.png",
    surfaceColor: "#FFFFFF",
    surfaceElevatedColor: "#F8FAFC",
    borderColor: "#D9E2EC",
    successColor: "#047857",
    warningColor: "#B45309",
    mutedTextColor: "#64748B",
    backgroundImageUrl: "https://cdn.example/bg.png",
    borderRadius: 10,
    density: "spacious" as const,
    headerTitle: "Concierge Northstar",
    headerSubtitle: "Compra segura com acompanhamento premium",
    agentName: "Aurora Concierge",
    trustBadges: ["Pagamento seguro", "Frete rastreavel"]
  };
  const saved = await new UpdateMerchantThemeUseCase(repo).execute("m1", next);
  assert.equal(saved.accentColor, "#FF0066");
  assert.equal(saved.borderRadius, 10);
  assert.equal(saved.headerTitle, "Concierge Northstar");
  const stored = await new GetMerchantThemeUseCase(repo, {} as any).execute("m1");
  assert.equal(stored.logoUrl, "https://cdn.example/logo.png");
  assert.equal(stored.fontFamily, "Manrope, system-ui, sans-serif");
  assert.equal(stored.fontDisplay, "Sora, Manrope, sans-serif");
  assert.equal(stored.trustBadges?.[0], "Pagamento seguro");
});
