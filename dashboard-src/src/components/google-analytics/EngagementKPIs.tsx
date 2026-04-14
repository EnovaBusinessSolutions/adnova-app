import React from "react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";

const fmtPct = (v = 0) => `${(v * 100).toFixed(2)}%`;
const fmtTime = (sec = 0) => {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
};

function DeltaChip({ value }: { value?: number }) {
  if (value === undefined || value === null || isNaN(value)) return null;
  const pct = value * 100;
  const sign = pct === 0 ? "neutral" : pct > 0 ? "up" : "down";
  const cls =
    sign === "up"
      ? "bg-emerald-500/10 text-emerald-300 ring-emerald-400/20"
      : sign === "down"
      ? "bg-rose-500/10 text-rose-300 ring-rose-400/20"
      : "bg-slate-500/10 text-slate-300 ring-slate-400/20";
  const Icon = sign === "up" ? ArrowUpRight : sign === "down" ? ArrowDownRight : Minus;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${cls} max-w-fit`}>
      <Icon className="h-3.5 w-3.5" />
      {Math.abs(pct).toFixed(1)}% <span className="opacity-70 ml-1">vs mes ant.</span>
    </span>
  );
}

const Card: React.FC<{ title: string; value: string; delta?: number }> = ({ title, value, delta }) => (
  <div className="rounded-2xl border border-border bg-card p-5 flex flex-col gap-3">
    <div className="text-sm text-muted-foreground">{title}</div>
    <div className="text-3xl font-semibold tracking-tight">{value}</div>
    <DeltaChip value={delta} />
  </div>
);

export default function EngagementKPIs({
  engagementRate = 0,
  avgEngagementTime = 0,
  deltas,
  loading,
}: {
  engagementRate?: number;
  avgEngagementTime?: number;
  deltas?: { engagementRate?: number; avgEngagementTime?: number } | null;
  loading?: boolean;
}) {
  if (loading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {[0, 1].map(i => (
          <div key={i} className="rounded-2xl border border-border bg-card p-5">
            <div className="h-4 w-24 bg-muted rounded mb-3" />
            <div className="h-8 w-40 bg-muted rounded mb-3" />
            <div className="h-5 w-32 bg-muted rounded" />
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <Card title="Engagement rate" value={fmtPct(engagementRate)} delta={deltas?.engagementRate} />
      <Card title="Tiempo promedio en el sitio" value={fmtTime(avgEngagementTime)} delta={deltas?.avgEngagementTime} />
    </div>
  );
}
