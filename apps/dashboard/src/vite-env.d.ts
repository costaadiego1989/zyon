/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_MERCHANT_ID?: string;
  readonly VITE_STOREFRONT_URL?: string;
  readonly VITE_WIDGET_BUNDLE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
