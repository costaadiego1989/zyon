import React, { useState, useEffect, useCallback, useRef } from "react";
import { ArrowLeft, Send, FileText } from "lucide-react";
import { Button } from "../../components/Button.js";

interface DisputeMessage {
  id: string;
  sender: "merchant" | "system" | "processor";
  content: string;
  createdAt: string;
}

interface ChargebackDetail {
  id: string;
  orderId: string;
  amount: number;
  reason: string;
  status: "opened" | "disputed" | "resolved" | "lost";
  createdAt: string;
  updatedAt: string;
  messages: DisputeMessage[];
}

export function ChargebackDisputeChat(props: {
  apiBaseUrl: string;
  chargebackId: string;
  onBack: () => void;
  onRefresh: () => void;
}) {
  const [detail, setDetail] = useState<ChargebackDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const fetchDetail = useCallback(async () => {
    try {
      setLoading(true);
      const url = `${props.apiBaseUrl}/marketplace/dashboard/chargebacks/${props.chargebackId}`;
      const response = await fetch(url, {
        method: "GET",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      setDetail(data);
    } catch {
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }, [props.apiBaseUrl, props.chargebackId]);

  useEffect(() => { fetchDetail(); }, [fetchDetail]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [detail?.messages]);

  const handleSendMessage = async () => {
    if (!message.trim()) return;
    setSending(true);
    try {
      const url = `${props.apiBaseUrl}/marketplace/dashboard/chargebacks/${props.chargebackId}/dispute`;
      const response = await fetch(url, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: message.trim() }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setMessage("");
      await fetchDetail();
      props.onRefresh();
    } catch {
      // Keep message so user can retry
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const statusTimeline = [
    { key: "opened", label: "Opened" },
    { key: "disputed", label: "Disputed" },
    { key: "resolved", label: "Resolved" },
  ];

  const getTimelinePosition = (status: string) => {
    if (status === "disputed") return 1;
    if (status === "resolved" || status === "lost") return 2;
    return 0;
  };

  if (loading) {
    return (
      <div style={{ textAlign: "center", padding: 48 }}>
        <p style={{ color: "var(--color-text-muted)" }}>Loading dispute details...</p>
      </div>
    );
  }

  if (!detail) {
    return (
      <div style={{ textAlign: "center", padding: 48 }}>
        <p style={{ color: "var(--color-error)" }}>Could not load chargeback details</p>
        <Button onClick={props.onBack} style={{ marginTop: 16 }}>Back to list</Button>
      </div>
    );
  }

  const currentStep = getTimelinePosition(detail.status);

  return (
    <div style={{ maxWidth: 720, margin: "0 auto" }}>
      {/* Back */}
      <button
        type="button"
        onClick={props.onBack}
        style={{ display: "flex", alignItems: "center", gap: 6, border: "none", background: "none", color: "var(--color-brand)", cursor: "pointer", marginBottom: 16, fontSize: 14, fontWeight: 500, padding: 0 }}
      >
        <ArrowLeft size={16} />
        Back to chargebacks
      </button>

      {/* Details */}
      <div style={{ border: "1px solid var(--color-border)", borderRadius: 12, padding: 20, marginBottom: 16, background: "var(--surface-2)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
          <div>
            <p style={{ fontSize: 12, color: "var(--color-text-muted)" }}>Order</p>
            <p style={{ fontWeight: 600 }}>{detail.orderId}</p>
          </div>
          <div style={{ textAlign: "right" }}>
            <p style={{ fontSize: 12, color: "var(--color-text-muted)" }}>Amount</p>
            <p style={{ fontWeight: 600, fontSize: 18 }}>R$ {(detail.amount / 100).toFixed(2)}</p>
          </div>
        </div>
        <div>
          <p style={{ fontSize: 12, color: "var(--color-text-muted)" }}>Reason</p>
          <p style={{ fontSize: 14 }}>{detail.reason}</p>
        </div>
      </div>

      {/* Timeline */}
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 20, padding: 12, border: "1px solid var(--color-border)", borderRadius: 12, background: "var(--surface-2)" }}>
        {statusTimeline.map((step, idx) => {
          const isActive = idx <= currentStep;
          return (
            <div key={step.key} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, flex: 1 }}>
              <div style={{ width: 24, height: 24, borderRadius: "50%", backgroundColor: isActive ? "var(--color-brand)" : "var(--color-border)", color: isActive ? "white" : "var(--color-text-muted)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 600 }}>
                {idx + 1}
              </div>
              <span style={{ fontSize: 11, fontWeight: isActive ? 600 : 400, color: isActive ? "var(--color-text)" : "var(--color-text-muted)" }}>{step.label}</span>
            </div>
          );
        })}
      </div>

      {/* Chat */}
      <div style={{ border: "1px solid var(--color-border)", borderRadius: 12, overflow: "hidden", background: "var(--surface-2)" }}>
        <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--color-border)", background: "var(--surface-1)" }}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>Dispute Evidence & Messages</span>
        </div>

        <div style={{ maxHeight: 400, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
          {(detail.messages || []).length === 0 ? (
            <div style={{ textAlign: "center", padding: 32, color: "var(--color-text-muted)" }}>
              <FileText size={24} style={{ margin: "0 auto", marginBottom: 8 }} />
              <p style={{ fontSize: 13 }}>No messages yet. Start your dispute by sending evidence below.</p>
            </div>
          ) : (
            detail.messages.map((msg) => (
              <div key={msg.id} style={{ display: "flex", flexDirection: "column", alignItems: msg.sender === "merchant" ? "flex-end" : "flex-start" }}>
                <div style={{ maxWidth: "80%", padding: 12, borderRadius: 10, backgroundColor: msg.sender === "merchant" ? "var(--color-brand)" : "var(--color-border)", color: msg.sender === "merchant" ? "white" : "var(--color-text)", fontSize: 14, lineHeight: 1.5 }}>
                  {msg.content}
                </div>
                <span style={{ fontSize: 11, color: "var(--color-text-muted)", marginTop: 4 }}>
                  {msg.sender === "merchant" ? "You" : msg.sender === "system" ? "System" : "Processor"} · {new Date(msg.createdAt).toLocaleString()}
                </span>
              </div>
            ))
          )}
          <div ref={messagesEndRef} />
        </div>

        {(detail.status === "opened" || detail.status === "disputed") && (
          <div style={{ borderTop: "1px solid var(--color-border)", padding: "12px 16px", display: "flex", gap: 8, alignItems: "flex-end", background: "var(--surface-1)" }}>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Describe your evidence or dispute reason..."
              rows={2}
              style={{ flex: 1, resize: "vertical", borderRadius: 8, border: "1px solid var(--color-border)", padding: "8px 12px", fontSize: 14, fontFamily: "inherit", background: "var(--surface-2)", color: "var(--color-text)", minHeight: 38, maxHeight: 120 }}
            />
            <Button onClick={handleSendMessage} disabled={sending || !message.trim()} style={{ minWidth: 80, height: 38 }}>
              <Send size={16} />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
