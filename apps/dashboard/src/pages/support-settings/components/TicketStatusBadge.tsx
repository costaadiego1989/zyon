import React from "react";
import type { SupportTicketStatus } from "@zyon/shared-types";

const STATUS_BADGE: Record<SupportTicketStatus, string> = {
  open: "warn",
  in_progress: "muted",
  resolved: "ok",
  closed: "muted",
};

const STATUS_DOT: Record<SupportTicketStatus, string> = {
  open: "amber",
  in_progress: "blue",
  resolved: "green",
  closed: "",
};

const SUPPORT_STATUS_LABELS: Record<SupportTicketStatus, string> = {
  open: "Aberto",
  in_progress: "Em atendimento",
  resolved: "Resolvido",
  closed: "Fechado"
};

interface Props {
  status: SupportTicketStatus;
}

export function TicketStatusBadge(props: Props) {
  return (
    <>
      <span
        className={`status-dot ${STATUS_DOT[props.status]}`}
        aria-hidden="true"
      />
      <span className={`badge ${STATUS_BADGE[props.status]}`}>
        {SUPPORT_STATUS_LABELS[props.status]}
      </span>
    </>
  );
}
