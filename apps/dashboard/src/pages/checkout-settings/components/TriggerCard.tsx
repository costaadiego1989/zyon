import React from "react";
import type { CheckoutTriggerName } from "@zyon/shared-types";
import { TRIGGER_LABELS, TRIGGER_HELP, TRIGGER_STATUS } from "../lib/constants.js";
import { ToggleSwitch } from "./ToggleSwitch.js";

export function TriggerCard({
  trigger,
  enabled,
  busy,
  onChange,
}: {
  trigger: CheckoutTriggerName;
  enabled: boolean;
  busy: boolean;
  onChange: (v: boolean) => void;
}) {
  const status = TRIGGER_STATUS[trigger];
  const isSoon = status === "soon";

  return (
    <div className={`cfg-trigger${enabled && !isSoon ? " on" : ""}${isSoon ? " soon" : ""}`}>
      <div className="cfg-trigger-main">
        <strong id={`trigger-${trigger}`}>
          {TRIGGER_LABELS[trigger]}
          {isSoon ? <span className="cfg-tag-soon">em breve</span> : null}
        </strong>
        <span>{TRIGGER_HELP[trigger]}</span>
      </div>
      <div className="cfg-trigger-controls">
        <ToggleSwitch
          id={`trigger-${trigger}`}
          checked={enabled}
          disabled={busy || isSoon}
          onChange={onChange}
        />
      </div>
    </div>
  );
}
