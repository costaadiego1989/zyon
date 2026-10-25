import React from "react";

interface AgentOrbProps {
  color: string;
  size?: number;
  showSmile?: boolean;
}

export function AgentOrb({ color, size = 64, showSmile = false }: AgentOrbProps) {
  const orbStyle = {
    "--orb-c1": color,
    "--orb-c2": color + "cc",
    "--orb-c3": color + "66",
    width: size,
    height: size,
  } as React.CSSProperties;

  return (
    <div className="onb-widget-orb" style={orbStyle}>
      <div className="onb-widget-orb__halo" />
      <div className="onb-widget-orb__core" />
      <div className="onb-widget-orb__eyes" style={showSmile ? { flexDirection: "column", alignItems: "center", gap: 6 } : {}}>
        {showSmile ? (
          <>
            <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
              <span style={{ width: 10, height: 14, borderRadius: "50%", background: "#fff", boxShadow: "0 0 6px rgba(0,0,0,0.2)" }} />
              <span style={{ width: 10, height: 14, borderRadius: "50%", background: "#fff", boxShadow: "0 0 6px rgba(0,0,0,0.2)" }} />
            </div>
            <svg width="20" height="10" viewBox="0 0 20 10" fill="none" style={{ marginTop: 4 }}>
              <path d="M4 4c3 4 9 4 12 0" stroke="#fff" strokeWidth="2" strokeLinecap="round" fill="none" />
            </svg>
          </>
        ) : (
          <>
            <span />
            <span />
          </>
        )}
      </div>
    </div>
  );
}
