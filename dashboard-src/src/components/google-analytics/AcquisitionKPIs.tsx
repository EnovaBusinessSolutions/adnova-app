import React from "react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";

type Deltas = { totalUsers?: number; sessions?: number; newUsers?: number };

function DeltaChip({ value }: { value?: number }) {
  if (value === undefined || value === null || isNaN(value)) return null;
  const pct = value * 100;
  const sign = pct === 0 ? "neutral" : pct > 0 ? "up" : "down";
  const cls =
    sign === "up"
      ? "bg-emerald-500/12 text-emerald-300 ring-emerald-400/20"
      : sign === "down"
      ? "bg-rose-500/12 text-rose-300 ring-rose-400/20"
      : "bg-slate-500/12 text-slate-300 ring-slate-400/20";
  const Icon = sign === "up" ? ArrowUpRight : sign === "down" ? ArrowDownRight : Minus;

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-[6px] text-xs font-medium ring-1 ${cls} max-w-fit`}
      title="Comparado contra el mes anterior"
    >
      <Icon className="h-3.5 w-3.5" />
      {Math.abs(pct).toFixed(1)}%
      <span className="opacity-60 ml-1 hidden sm:inline">vs mes anterior</span>
    </span>
  );
}

const Card: React.FC<{ title: string; value: string; delta?: number }> = ({ title, value, delta }) => (
  <div className="rounded-2xl border border-border bg-card p-5 flex flex-col gap-2.5">
    <div className="text-sm text-muted-foreground">{title}</div>
    <div className="text-3xl font-semibold tracking-tight leading-tight">{value}</div>
    <DeltaChip value={delta} />
  </div>
);

const Skeleton: React.FC = () => (
  <div className="rounded-2xl border border-border bg-card p-5">
    <div className="h-4 w-24 bg-muted rounded mb-3" />
    <div className="h-8 w-40 bg-muted rounded mb-3" />
    <div className="h-5 w-28 bg-muted rounded" />
  </div>
);

export default function AcquisitionKPIs({
  totalUsers = 0,
  sessions = 0,
  newUsers = 0,
  deltas,
  loading,
}: {
  totalUsers?: number;
  sessions?: number;
  newUsers?: number;
  deltas?: Deltas | null;
  loading?: boolean;
}) {
  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} />
        ))}
      </div>
    );
  }

  const nf = new Intl.NumberFormat("es-MX");

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <Card title="Usuarios" value={nf.format(Math.round(totalUsers))} delta={deltas?.totalUsers} />
      <Card title="Sesiones" value={nf.format(Math.round(sessions))} delta={deltas?.sessions} />
      <Card title="Usuarios nuevos" value={nf.format(Math.round(newUsers))} delta={deltas?.newUsers} />
    </div>
  );
}
