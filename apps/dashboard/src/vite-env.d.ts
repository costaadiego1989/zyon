/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_MERCHANT_ID?: string;
  readonly VITE_STOREFRONT_URL?: string;
  readonly VITE_WIDGET_BUNDLE_URL?: string;
  readonly VITE_GOOGLE_CLIENT_ID?: string;
  readonly VITE_MICROSOFT_CLIENT_ID?: string;
  readonly VITE_FACEBOOK_CLIENT_ID?: string;
  readonly VITE_FACEBOOK_GRAPH_API_VERSION?: string;
  readonly VITE_OAUTH_REDIRECT_URI?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
