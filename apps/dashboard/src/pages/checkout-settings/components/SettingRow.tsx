import React from "react";

export function SettingRow({
  id,
  title,
  desc,
  control,
}: {
  id: string;
  title: string;
  desc: string;
  control: React.ReactNode;
}) {
  return (
    <div className="cfg-row">
      <div className="cfg-row-text">
        <strong id={id}>{title}</strong>
        <span>{desc}</span>
      </div>
      <div className="cfg-row-control">{control}</div>
    </div>
  );
}
