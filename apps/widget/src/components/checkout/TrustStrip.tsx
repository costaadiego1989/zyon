import { LockKeyhole, ShieldCheck } from "lucide-react";

const DEFAULT_TRUST_ITEMS = [
  { id: "encrypted", label: "Checkout criptografado", icon: LockKeyhole },
  { id: "secure", label: "Pagamento seguro", icon: ShieldCheck },
  { id: "locale", label: "Brasil · BRL", flag: "BR" }
] as const;

export function TrustStrip({
  items,
  variant = "inline",
  className = ""
}: {
  items?: string[];
  variant?: "inline" | "stack";
  className?: string;
}) {
  const custom = (items ?? []).filter(Boolean).slice(0, 3);
  const showDefaults = custom.length === 0;

  return (
    <div
      className={`aacp-trust-strip aacp-trust-strip--${variant} ${className}`.trim()}
      role="group"
      aria-label="Garantias e segurança"
    >
      {showDefaults
        ? DEFAULT_TRUST_ITEMS.map((item) => (
            <span key={item.id} className="aacp-trust-seal">
              {"flag" in item ? (
                <span className="aacp-trust-flag" aria-hidden>
                  {item.flag}
                </span>
              ) : (
                <item.icon size={12} aria-hidden />
              )}
              {item.label}
            </span>
          ))
        : custom.map((label) => (
            <span key={label} className="aacp-trust-seal">
              <ShieldCheck size={12} aria-hidden />
              {label}
            </span>
          ))}
    </div>
  );
}
