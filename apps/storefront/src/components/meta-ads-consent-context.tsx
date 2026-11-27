"use client";
import { createContext } from "react";
export interface MetaAdsConsentState {
  storeKey: string; merchantId?: string; pixelId?: string; version: string; ready: boolean; granted: boolean;
  registerRevoker(revoke: () => Promise<void>): () => void;
}
export const MetaAdsConsentContext = createContext<MetaAdsConsentState | null>(null);
