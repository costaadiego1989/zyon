import type { LucideIcon } from "lucide-react";

export type IconFrameProps = {
  icon: LucideIcon;
  label?: string;
  size?: "sm" | "md";
  status?: "none" | "online" | "secure";
};

export function IconFrame({
  icon: Icon,
  label,
  size = "md",
  status = "none",
}: IconFrameProps) {
  return (
    <span
      className="zyon-icon-frame"
      data-size={size}
      data-status={status}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <Icon strokeWidth={1.75} />
      {status !== "none" ? <span className="zyon-icon-frame__status" /> : null}
    </span>
  );
}
