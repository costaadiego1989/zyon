import React from "react";

export interface TabItem {
  key: string;
  label: string;
}

export interface TabBarProps {
  tabs: TabItem[];
  activeTab: string;
  onTabChange: (key: string) => void;
}

export function TabBar({ tabs, activeTab, onTabChange }: TabBarProps) {
  return (
    <div
      role="tablist"
      style={{
        display: "inline-flex",
        background: "oklch(16% 0.003 145)",
        border: "1px solid var(--color-border)",
        borderRadius: 10,
        padding: 3,
        gap: 2,
      }}
    >
      {tabs.map((tab) => {
        const active = tab.key === activeTab;
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onTabChange(tab.key)}
            style={{
              background: active ? "var(--surface-2)" : "transparent",
              color: active ? "var(--color-text)" : "var(--color-text-muted)",
              border: active ? "1px solid var(--color-border)" : "1px solid transparent",
              borderRadius: 7,
              padding: "7px 16px",
              font: "600 12.5px var(--font-sans)",
              cursor: "pointer",
              transition: "all 150ms",
              boxShadow: active ? "0 1px 4px rgba(0,0,0,0.15)" : "none",
            }}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
