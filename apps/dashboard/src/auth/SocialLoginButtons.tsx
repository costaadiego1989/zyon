import React from "react";
import type { SocialLoginProvider } from "./auth-config.js";

export interface SocialLoginButtonsProps {
  busy: boolean;
  onProviderClick: (provider: SocialLoginProvider) => void;
}

export function SocialLoginButtons({ busy, onProviderClick }: SocialLoginButtonsProps) {
  const facebookEnabled = import.meta.env.VITE_FACEBOOK_LOGIN_ENABLED === "true";
  return (
    <div className="auth-social" role="group" aria-label="Acesso com sua conta">
      <button type="button" className="auth-social__btn auth-social__btn--google" onClick={() => onProviderClick("google")} disabled={busy} aria-label="Continuar com Google">
        <img src="/auth/google-g.png" width="18" height="18" alt="" /><span>Continuar com Google</span>
      </button>
      <button type="button" className="auth-social__btn" onClick={() => onProviderClick("microsoft")} disabled={busy} aria-label="Entrar com Microsoft">
        <img src="/auth/microsoft.svg" width="19" height="19" alt="" />
        <span>Entrar com Microsoft</span>
      </button>
      {facebookEnabled && <button type="button" className="auth-social__btn" onClick={() => onProviderClick("facebook")} disabled={busy} aria-label="Continuar com Facebook">
        <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true">
          <path fill="#0866ff" d="M24 12a12 12 0 1 0-13.875 11.854v-8.385H7.078V12h3.047V9.356c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874V12h3.328l-.532 3.469h-2.796v8.385A12.003 12.003 0 0 0 24 12Z" />
        </svg>
        <span>Continuar com Facebook</span>
      </button>}
    </div>
  );
}
