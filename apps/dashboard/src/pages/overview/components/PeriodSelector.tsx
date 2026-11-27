import React from "react";
import { CalendarDays } from "lucide-react";
import { TabBar } from "../../../components/TabBar.js";

export type PeriodValue = "today" | "7d" | "30d" | "90d";
export type PeriodSelectorProps = {
  value: PeriodValue;
  onChange: (period: PeriodValue) => void;
};
const OPTIONS = [
  { key: "today", label: "Hoje", icon: <CalendarDays size={16} /> },
  { key: "7d", label: "7 dias", icon: <CalendarDays size={16} /> },
  { key: "30d", label: "30 dias", icon: <CalendarDays size={16} /> },
  { key: "90d", label: "90 dias", icon: <CalendarDays size={16} /> },
];
export function PeriodSelector({ value, onChange }: PeriodSelectorProps) {
  return (
    <TabBar
      tabs={OPTIONS}
      activeTab={value}
      onTabChange={(key) => onChange(key as PeriodValue)}
      label="Período dos indicadores"
    />
  );
}
