import React, { type ReactNode } from "react";

export interface TabItem {
  key: string;
  label: string;
  icon?: ReactNode;
  panelId?: string;
}

export interface TabBarProps {
  tabs: TabItem[];
  activeTab: string;
  onTabChange: (key: string) => void;
  label?: string;
  /** Filters share the visual control but do not represent content panels. */
  role?: "tablist" | "group";
}

export function TabBar({ tabs, activeTab, onTabChange, label, role = "tablist" }: TabBarProps) {
  return (
    <div className="tab-bar" role={role} aria-label={label}>
      {tabs.map((tab, index) => {
        const active = tab.key === activeTab;
        return (
          <button
            key={tab.key}
            type="button"
            className="tab-bar__tab"
            role={role === "tablist" ? "tab" : undefined}
            aria-selected={role === "tablist" ? active : undefined}
            aria-pressed={role === "group" ? active : undefined}
            aria-controls={tab.panelId}
            id={tab.panelId ? tab.panelId + "-tab" : undefined}
            tabIndex={role === "tablist" && !active ? -1 : 0}
            onClick={() => onTabChange(tab.key)}
            onKeyDown={event => {
              if (role !== "tablist") return;
              const next = event.key === "ArrowRight" ? (index + 1) % tabs.length
                : event.key === "ArrowLeft" ? (index - 1 + tabs.length) % tabs.length
                : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : -1;
              if (next < 0) return;
              event.preventDefault();
              onTabChange(tabs[next].key);
              event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("button")[next]?.focus();
            }}
          >
            {tab.icon ? <span aria-hidden="true">{tab.icon}</span> : null}
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
