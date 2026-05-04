import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_MERCHANT_THEME } from "@aacp/shared-types";
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
  const result = await new GetMerchantThemeUseCase(repo).execute("m1");
  assert.deepEqual(result, DEFAULT_MERCHANT_THEME);
});

test("UpdateMerchantThemeUseCase rejects invalid hex color", async () => {
  const repo = repoWithMerchant();
  await assert.rejects(
    new UpdateMerchantThemeUseCase(repo).execute("m1", {
      ...DEFAULT_MERCHANT_THEME,
      accentColor: "blue"
    }),
    /invalid_color:accentColor/
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

test("UpdateMerchantThemeUseCase persists valid theme and GetMerchantThemeUseCase returns it", async () => {
  const repo = repoWithMerchant();
  const next = {
    ...DEFAULT_MERCHANT_THEME,
    accentColor: "#FF0066",
    fontFamily: "Manrope, system-ui, sans-serif",
    logoUrl: "https://cdn.example/logo.png"
  };
  const saved = await new UpdateMerchantThemeUseCase(repo).execute("m1", next);
  assert.equal(saved.accentColor, "#FF0066");
  const stored = await new GetMerchantThemeUseCase(repo).execute("m1");
  assert.equal(stored.logoUrl, "https://cdn.example/logo.png");
  assert.equal(stored.fontFamily, "Manrope, system-ui, sans-serif");
});
