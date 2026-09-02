import React from "react";

interface LogoProps {
  size?: number;
}

function LogoImg({ src, alt, style }: { src: string; alt: string; style?: React.CSSProperties }) {
  return <img src={src} alt={alt} style={{ objectFit: "contain", display: "block", margin: "0 auto", ...style }} />;
}

export function AsaasLogo(_props: LogoProps) {
  return <LogoImg src="/logo-asaas.png" alt="Asaas" />;
}

export function MercadoPagoLogo(_props: LogoProps) {
  return <LogoImg src="/logo-mercadopago.png" alt="Mercado Pago"  />;
}

export function StripeLogo(_props: LogoProps) {
  return <LogoImg src="/logo-stripe.png" alt="Stripe" />;
}
