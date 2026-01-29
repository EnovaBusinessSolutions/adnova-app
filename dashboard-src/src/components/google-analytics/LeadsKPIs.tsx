// dashboard-src/src/components/google-analytics/LeadsKPIs.tsx
import React from "react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";

type Deltas = { leads?: number; conversionRate?: number } | null;

interface Props {
  leads?: number;              // entero
  conversionRate?: number;     // ratio 0–1
  deltas?: Deltas;             // ratios 0–1 (comparado vs mes anterior)
  loading?: boolean;
  error?: string | null;
}

const nfInt = new Intl.NumberFormat("es-MX");
const fmtInt = (n?: number) =>
  Number.isFinite(n as number) ? nfInt.format(Math.round(n as number)) : "0";
const fmtPct = (r?: number) =>
  Number.isFinite(r as number) ? `${((r as number) * 100).toFixed(2)}%` : "0.00%";

function DeltaChip({ value }: { value?: number }) {
  if (value === undefined || value === null || !Number.isFinite(value)) return null;
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
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${cls} max-w-fit`}
      aria-label={`Variación ${Math.abs(pct).toFixed(1)}% vs mes anterior`}
      title={`Variación vs mes anterior: ${Math.abs(pct).toFixed(1)}%`}
    >
      <Icon className="h-3.5 w-3.5" />
      {Math.abs(pct).toFixed(1)}% <span className="opacity-70 ml-1">vs mes anterior</span>
    </span>
  );
}

const CardBox: React.FC<{ title: string; value: string; delta?: number }> = ({ title, value, delta }) => (
  <div className="rounded-2xl border border-border bg-card p-5 flex flex-col gap-3">
    <div className="text-sm text-muted-foreground">{title}</div>
    <div className="text-3xl font-semibold tracking-tight">{value}</div>
    <DeltaChip value={delta} />
  </div>
);

const Skeleton: React.FC = () => (
  <div className="rounded-2xl border border-border bg-card p-5">
    <div className="h-4 w-24 bg-muted rounded mb-3" />
    <div className="h-8 w-40 bg-muted rounded mb-3" />
    <div className="h-5 w-32 bg-muted rounded" />
  </div>
);

const ErrorState: React.FC<{ msg?: string }> = ({ msg }) => (
  <div className="rounded-2xl border border-destructive/40 bg-destructive/10 p-6 text-sm">
    <div className="font-medium text-destructive-foreground mb-1">No se pudieron cargar los KPIs de Leads.</div>
    <div className="text-muted-foreground">{msg || "Intenta actualizar el rango o la propiedad."}</div>
  </div>
);

const LeadsKPIs: React.FC<Props> = ({
  leads = 0,
  conversionRate = 0,
  deltas = null,
  loading = false,
  error = null,
}) => {
  if (loading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Skeleton />
        <Skeleton />
      </div>
    );
  }

  if (error) {
    return <ErrorState msg={error} />;
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <CardBox
        title="Leads generados"
        value={fmtInt(leads)}
        delta={deltas?.leads}
      />
      <CardBox
        title="Tasa de conversión a lead"
        value={fmtPct(conversionRate)}
        delta={deltas?.conversionRate}
      />
    </div>
  );
};

export default LeadsKPIs;
