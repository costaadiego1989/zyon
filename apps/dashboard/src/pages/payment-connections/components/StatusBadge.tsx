import React from "react";

type Status = "active" | "pending" | "restricted" | "error" | string;

interface StatusBadgeProps {
  status: Status;
}

function getLabel(status: Status): string {
  if (status === "active") return "Conectado";
  if (status === "restricted") return "Restrito";
  if (status === "pending") return "Pendente";
  if (status === "degraded") return "Falha na sincronização";
  if (status === "error") return "Erro";
  return "Desconectado";
}

function getVariant(status: Status): string {
  if (status === "active") return "active";
  if (status === "restricted") return "restricted";
  if (status === "pending") return "pending";
  if (status === "error" || status === "degraded") return "error";
  return "disconnected";
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const variant = getVariant(status);
  const label = getLabel(status);

  return (
    <span role="status" aria-live="polite" className={`status-badge status-badge--${variant}`}>
      <span className={`status-dot status-dot--${variant}`} />
      {label}
    </span>
  );
}
