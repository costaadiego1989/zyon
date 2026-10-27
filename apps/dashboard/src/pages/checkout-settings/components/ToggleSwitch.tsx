import React from "react";

export function ToggleSwitch({
  checked,
  disabled,
  onChange,
  id,
}: {
  checked: boolean;
  disabled: boolean;
  onChange: (v: boolean) => void;
  id: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={id}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`cfg-switch${checked ? " on" : ""}`}
    >
      <span className="cfg-switch-thumb" />
    </button>
  );
}
