import { useState, useCallback } from "react";

export const WOOCOMMERCE_KEY_PATTERN = /^ck_[a-f0-9]{32,}$/;
export const WOOCOMMERCE_SECRET_PATTERN = /^cs_[a-f0-9]{32,}$/;
export const MAGENTO_TOKEN_PATTERN = /^[a-z0-9]{32,}$/;

export interface ApiKeyAuthState {
  storeUrl: string;
  consumerKey: string;
  consumerSecret: string;
  magentoBaseUrl: string;
  magentoToken: string;
  magentoStoreCode: string;
}

export function useApiKeyAuth() {
  const [state, setState] = useState<ApiKeyAuthState>({
    storeUrl: "",
    consumerKey: "",
    consumerSecret: "",
    magentoBaseUrl: "",
    magentoToken: "",
    magentoStoreCode: "default",
  });

  const setStoreUrl = useCallback((value: string) => {
    setState((s) => ({ ...s, storeUrl: value }));
  }, []);

  const setConsumerKey = useCallback((value: string) => {
    setState((s) => ({ ...s, consumerKey: value }));
  }, []);

  const setConsumerSecret = useCallback((value: string) => {
    setState((s) => ({ ...s, consumerSecret: value }));
  }, []);

  const setMagentoBaseUrl = useCallback((value: string) => {
    setState((s) => ({ ...s, magentoBaseUrl: value }));
  }, []);

  const setMagentoToken = useCallback((value: string) => {
    setState((s) => ({ ...s, magentoToken: value }));
  }, []);

  const setMagentoStoreCode = useCallback((value: string) => {
    setState((s) => ({ ...s, magentoStoreCode: value }));
  }, []);

  const reset = useCallback(() => {
    setState({
      storeUrl: "",
      consumerKey: "",
      consumerSecret: "",
      magentoBaseUrl: "",
      magentoToken: "",
      magentoStoreCode: "default",
    });
  }, []);

  const isWooCommerceValid = state.storeUrl && state.consumerKey && state.consumerSecret;
  const isMagentoValid = state.magentoBaseUrl && state.magentoToken;

  return {
    state,
    setStoreUrl,
    setConsumerKey,
    setConsumerSecret,
    setMagentoBaseUrl,
    setMagentoToken,
    setMagentoStoreCode,
    reset,
    isWooCommerceValid,
    isMagentoValid,
  };
}
