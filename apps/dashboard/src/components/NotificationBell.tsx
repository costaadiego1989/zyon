import React, { useEffect, useLayoutEffect, useId, useRef, useState } from "react";
import { Bell, Package, X } from "lucide-react";
import { EmptyState } from "./EmptyState.js";
import { createPortal } from "react-dom";
import { Button } from "./Button.js";
import { notificationDate, type NotificationItem } from "./notification-inbox.js";
export type { NotificationItem } from "./notification-inbox.js";
import "./notification-bell.css";

// Base64 encoded short notification chime (tiny PCM beep)
const NOTIFICATION_SOUND = "data:audio/wav;base64,UklGRlQBAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YTABAACAf4B/gH+Af4J8h3eMcpJslGaYX5xYoFGkSqhDrDywNbQutie6ILwZvhLAC8IEwv2/9r/uv+a/3r/Wv86/xr++v7a/rr+mv56/lr+Ov4a/fr92v2+/Z79fv1e/T79Hv0K/Pb85vzS/ML8rvye/Ir8evxm/Fb8Qvwy/B78Dvv++/L74v/S/8L/sv+i/5L/gv9y/2L/Uv9C/zL/Iv8S/wL+8v7i/tL+wv6y/qL+kv6C/nL+Yv5S/kL+Mv4i/hL+Av3y/eL90v3C/bL9ov2S/YL9cv1S/UL9Mv0i/RL9Av0C/PL88vzy/OL84vza/NL80vzC/ML8svyy/Kr8qvym/Kb8ovyi/J78nvya/Jr8lvyW/Jb8kvyS/I78jvyO/Ir8ivyK/Ib8hvw==";

interface NotificationBellProps {
  notifications: NotificationItem[];
  onClear: () => void | Promise<void>;
  onClickNotification?: (n: NotificationItem) => void | Promise<void>;
}

export function NotificationBell({ notifications, onClear, onClickNotification }: NotificationBellProps) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [position, setPosition] = useState({ left: 12, top: 64, maxHeight: 560 });
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const close = () => { setOpen(false); trigger.current?.focus(); };
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const anchor = trigger.current?.getBoundingClientRect();
      if (!anchor) return;
      const width = Math.min(400, window.innerWidth - 24);
      const top = anchor.bottom + 10;
      setPosition({ left: Math.max(12, Math.min(anchor.right - width, window.innerWidth - width - 12)), top, maxHeight: Math.max(0, Math.min(560, window.innerHeight - top - 12)) });
    };
    place();
    closeButton.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); close(); } };
    const onOutside = (event: PointerEvent) => {
      if (!panel.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("resize", place);
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onOutside);
    return () => { window.removeEventListener("resize", place); document.removeEventListener("keydown", onKey); document.removeEventListener("pointerdown", onOutside); };
  }, [open]);
  const perform = async (action: () => void | Promise<void>) => {
    if (pending) return;
    setPending(true); setError(null);
    try { await action(); }
    catch { setError("Não foi possível marcar como lida. Tente novamente."); }
    finally { setPending(false); }
  };
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

  return <div className="notification-bell">
    <button type="button" ref={trigger} className="ui-icon-button notification-trigger" onClick={() => { setError(null); setOpen(value => !value); }}
      aria-label={"Notificações" + (count ? " (" + count + " novas)" : "")} aria-expanded={open} aria-controls={open ? panelId : undefined} aria-haspopup="dialog">
      <Bell size={16} aria-hidden="true" />{count > 0 && <span className="notification-count">{count > 99 ? "99+" : count}</span>}
    </button>
    {open && createPortal(<div ref={panel} id={panelId} className="dashboard-ui notification-inbox" role="dialog" aria-label="Notificações" style={position}>
      <header className="notification-inbox__header"><div><h2>Notificações</h2><p>{count ? count + (count === 1 ? " não lida" : " não lidas") : "Tudo em dia"}</p></div>
        <button ref={closeButton} type="button" className="ui-icon-button" onClick={close} aria-label="Fechar notificações"><X size={18} aria-hidden="true" /></button>
      </header>
      {error && <p role="alert" className="notification-inbox__error">{error}</p>}
      {count ? <ul className="notification-inbox__list">{notifications.map(n => <li key={n.id}>
        <button type="button" className="notification-inbox__item" disabled={pending} onClick={() => void perform(async () => { await onClickNotification?.(n); close(); })}>
          {n.type === "inventory_alert" ? <Package size={18} className="notification-inbox__symbol notification-inbox__symbol--stock" aria-hidden="true" /> : <Bell size={18} className="notification-inbox__symbol" aria-hidden="true" />}
          <span className="notification-inbox__copy"><span className="notification-inbox__title">{n.title}</span>{n.body && <span className="notification-inbox__body">{n.body}</span>}<span className="notification-inbox__date">{notificationDate(n.createdAt)}</span></span>
        </button>
      </li>)}</ul> : <EmptyState icon={Bell} title="Nenhuma notificação pendente" description="Alertas de estoque, pedidos e novidades da loja aparecerão aqui." />}
      {count > 0 && <footer className="notification-inbox__footer"><Button variant="ghost" size="sm" fullWidth loading={pending} onClick={() => void perform(onClear)}>Marcar todas como lidas</Button></footer>}
    </div>, document.body)}
  </div>;
}
