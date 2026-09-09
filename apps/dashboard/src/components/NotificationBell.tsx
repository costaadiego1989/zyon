import React, { useEffect, useRef, useState } from "react";
import { Bell } from "lucide-react";
import { EmptyState } from "./EmptyState.js";

// Base64 encoded short notification chime (tiny PCM beep)
const NOTIFICATION_SOUND = "data:audio/wav;base64,UklGRlQBAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YTABAACAf4B/gH+Af4J8h3eMcpJslGaYX5xYoFGkSqhDrDywNbQutie6ILwZvhLAC8IEwv2/9r/uv+a/3r/Wv86/xr++v7a/rr+mv56/lr+Ov4a/fr92v2+/Z79fv1e/T79Hv0K/Pb85vzS/ML8rvye/Ir8evxm/Fb8Qvwy/B78Dvv++/L74v/S/8L/sv+i/5L/gv9y/2L/Uv9C/zL/Iv8S/wL+8v7i/tL+wv6y/qL+kv6C/nL+Yv5S/kL+Mv4i/hL+Av3y/eL90v3C/bL9ov2S/YL9cv1S/UL9Mv0i/RL9Av0C/PL88vzy/OL84vza/NL80vzC/ML8svyy/Kr8qvym/Kb8ovyi/J78nvya/Jr8lvyW/Jb8kvyS/I78jvyO/Ir8ivyK/Ib8hvw==";

export interface NotificationItem {
  id: string;
  type: "handoff" | "message" | "return_requested" | "chargeback_opened" | "hold_released" | "refund_processed" | "order_paid";
  title: string;
  ticketId?: string;
  createdAt: string;
}

interface NotificationBellProps {
  notifications: NotificationItem[];
  onClear: () => void;
  onClickNotification?: (n: NotificationItem) => void;
}

export function NotificationBell({ notifications, onClear, onClickNotification }: NotificationBellProps) {
  const [open, setOpen] = useState(false);
  const seenNotificationIdsRef = useRef<Set<string> | null>(null);
  const chimeQueueRef = useRef(Promise.resolve());

  const queueChime = () => {
    // A separate Audio instance lets closely-arriving notifications remain
    // distinct instead of restarting and cutting one another off.
    chimeQueueRef.current = chimeQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        const audio = new Audio(NOTIFICATION_SOUND);
        audio.preload = "auto";
        audio.volume = 0.4;

        await new Promise<void>((resolve) => {
          let completed = false;
          const finish = () => {
            if (completed) return;
            completed = true;
            window.clearTimeout(timeout);
            resolve();
          };
          // A timeout keeps the next sound moving even on a browser that does
          // not emit `ended` for a data-URL audio clip.
          const timeout = window.setTimeout(finish, 1_500);
          audio.addEventListener("ended", finish, { once: true });
          audio.addEventListener("error", finish, { once: true });
          void audio.play().catch(finish);
        });
      });
  };

  // A count comparison misses replacements and simultaneous updates. Track
  // identities so every notification that was not in the previous snapshot
  // receives its own chime, while the initial historical load stays silent.
  useEffect(() => {
    const currentIds = new Set(notifications.map((notification) => notification.id));
    const seenIds = seenNotificationIdsRef.current;

    if (seenIds === null) {
      seenNotificationIdsRef.current = currentIds;
      return;
    }

    const newNotificationCount = notifications.reduce(
      (total, notification) => total + (seenIds.has(notification.id) ? 0 : 1),
      0,
    );
    seenNotificationIdsRef.current = currentIds;

    for (let index = 0; index < newNotificationCount; index += 1) {
      queueChime();
    }
  }, [notifications]);

  const count = notifications.length;

  return (
    <div style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={`Notificações${count > 0 ? ` (${count} novas)` : ""}`}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 36,
          height: 36,
          borderRadius: 9,
          border: "1px solid var(--color-border)",
          background: "var(--surface-2)",
          cursor: "pointer",
          position: "relative",
          transition: "background 0.15s",
        }}
      >
        <Bell size={16} style={{ color: count > 0 ? "var(--color-brand)" : "var(--color-text-muted)" }} />
        {count > 0 ? (
          <span
            style={{
              position: "absolute",
              top: -2,
              right: -2,
              width: 16,
              height: 16,
              borderRadius: "50%",
              background: "var(--color-brand)",
              color: "#fff",
              fontSize: 9,
              fontWeight: 700,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              lineHeight: 1,
            }}
          >
            {count > 9 ? "9+" : count}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            right: 0,
            width: 300,
            maxHeight: 360,
            overflowY: "auto",
            background: "var(--surface-2)",
            border: "1px solid var(--color-border)",
            borderRadius: 12,
            boxShadow: "0 8px 32px rgba(0,0,0,0.3)",
            zIndex: 9999,
            padding: 8,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 8px 4px" }}>
            <span style={{ font: "600 11px var(--font-mono)", color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>Notificações</span>
            {count > 0 ? (
              <button
                type="button"
                onClick={() => { onClear(); setOpen(false); }}
                style={{ font: "11px var(--font-sans)", color: "var(--color-brand)", background: "none", border: "none", cursor: "pointer", padding: "2px 6px" }}
              >
                Limpar
              </button>
            ) : null}
          </div>

          {count === 0 ? (
            <EmptyState
              icon={Bell}
              title="Nenhuma notificação"
              description="Novas notificações aparecerão aqui"
            />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 4 }}>
              {notifications.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => { onClickNotification?.(n); setOpen(false); }}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 2,
                    padding: "8px 10px",
                    borderRadius: 8,
                    border: "none",
                    background: "transparent",
                    cursor: "pointer",
                    textAlign: "left",
                    transition: "background 0.1s",
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = "var(--surface-raised, rgba(255,255,255,0.04))"}
                  onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                >
                  <span style={{ fontSize: 12, color: "var(--color-text)", fontWeight: 500 }}>{n.title}</span>
                  <span style={{ fontSize: 10, color: "var(--color-text-faint)" }}>
                    {new Date(n.createdAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
