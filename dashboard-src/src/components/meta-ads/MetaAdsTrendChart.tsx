// dashboard-src/src/components/meta-ads/MetaAdsTrendChart.tsx
import React, { useMemo, useState } from "react";
import type { MetaSeriesPoint, MetaObjective } from "@/hooks/useMetaInsights";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Brush,
} from "recharts";

type Props = {
  objective: MetaObjective;
  data: MetaSeriesPoint[];
  loading?: boolean;
  height?: number;
  /** Código de divisa ISO 4217 que viene de la cuenta (p.ej. "USD", "MXN", "EUR"). */
  currencyCode?: string;
};

function useFormatters(currencyCode = "MXN") {
  const money = new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: currencyCode,
    maximumFractionDigits: 2,
  });
  const short = (n: number) => {
    if (!Number.isFinite(n)) return "—";
    const abs = Math.abs(n);
    if (abs >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
    if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
    if (abs >= 1_000) return `${(n / 1_000).toFixed(2)}k`;
    return n.toFixed(0);
  };
  const date = (iso: string) => {
    const [y, m, d] = iso.split("-").map(Number);
    const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
    return dt.toLocaleDateString("es-MX", { day: "2-digit", month: "short" });
  };
  return { money, short, date };
}

/* ---------- Tooltips ---------- */
const TooltipVentas: React.FC<{
  active?: boolean;
  label?: string;
  payload?: any[];
  showRevenue: boolean;
  showSpend: boolean;
  showRoas: boolean;
  currencyCode: string;
}> = ({ active, label, payload, showRevenue, showSpend, showRoas, currencyCode }) => {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload ?? {};
  const money = new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: currencyCode,
    maximumFractionDigits: 2,
  });
  const roas = row.spend > 0 ? row.revenue / row.spend : 0;
  return (
    <div className="rounded-xl border border-border bg-card/90 px-3 py-2 shadow-lg">
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      {showRevenue && (
        <div className="text-sm flex items-center gap-2">
          <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: "#B55CFF" }} />
          <span className="opacity-70">Revenue:</span>
          <strong>{money.format(+row.revenue || 0)}</strong>
        </div>
      )}
      {showSpend && (
        <div className="text-sm flex items-center gap-2">
          <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: "#60A5FA" }} />
          <span className="opacity-70">Gasto:</span>
          <strong>{money.format(+row.spend || 0)}</strong>
        </div>
      )}
      {showRoas && (
        <div className="text-sm flex items-center gap-2">
          <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: "#F59E0B" }} />
          <span className="opacity-70">ROAS:</span>
          <strong>{roas.toFixed(2)}×</strong>
        </div>
      )}
    </div>
  );
};

const TooltipAlcance: React.FC<{
  active?: boolean;
  label?: string;
  payload?: any[];
  sImp: boolean;
  sReach: boolean;
  sFreq: boolean;
}> = ({ active, label, payload, sImp, sReach, sFreq }) => {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload ?? {};
  return (
    <div className="rounded-xl border border-border bg-card/90 px-3 py-2 shadow-lg">
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      {sImp && (
        <div className="text-sm flex items-center gap-2">
          <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: "#818CF8" }} />
          <span className="opacity-70">Impresiones:</span>
          <strong>{Intl.NumberFormat("es-MX").format(+row.impressions || 0)}</strong>
        </div>
      )}
      {sReach && (
        <div className="text-sm flex items-center gap-2">
          <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: "#22D3EE" }} />
          <span className="opacity-70">Alcance:</span>
          <strong>{Intl.NumberFormat("es-MX").format(+row.reach || 0)}</strong>
        </div>
      )}
      {sFreq && (
        <div className="text-sm flex items-center gap-2">
          <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: "#F59E0B" }} />
          <span className="opacity-70">Frecuencia:</span>
          <strong>{((+row.impressions || 0) / (+row.reach || 1)).toFixed(2)}×</strong>
        </div>
      )}
    </div>
  );
};

const TooltipLeads: React.FC<{
  active?: boolean;
  label?: string;
  payload?: any[];
  sLeads: boolean;
  sCpl: boolean;
  sCtr: boolean;
  sSpend: boolean;
  currencyCode: string;
}> = ({ active, label, payload, sLeads, sCpl, sCtr, sSpend, currencyCode }) => {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload ?? {};
  const money = new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: currencyCode,
    maximumFractionDigits: 2,
  });
  const ctr = (+row.impressions || 0) > 0 ? (+row.clicks || 0) / (+row.impressions || 1) : 0;
  const leads = +row.leads || 0;
  const cpl = leads > 0 ? (+row.spend || 0) / leads : 0;
  return (
    <div className="rounded-xl border border-border bg-card/90 px-3 py-2 shadow-lg">
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      {sLeads && (
        <div className="text-sm flex items-center gap-2">
          <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: "#34D399" }} />
          <span className="opacity-70">Leads:</span>
          <strong>{Intl.NumberFormat("es-MX").format(leads)}</strong>
        </div>
      )}
      {sCpl && (
        <div className="text-sm flex items-center gap-2">
          <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: "#10B981" }} />
          <span className="opacity-70">CPL:</span>
          <strong>{money.format(cpl)}</strong>
        </div>
      )}
      {sCtr && (
        <div className="text-sm flex items-center gap-2">
          <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: "#F59E0B" }} />
          <span className="opacity-70">CTR:</span>
          <strong>{(ctr * 100).toFixed(2)}%</strong>
        </div>
      )}
      {sSpend && (
        <div className="text-sm flex items-center gap-2">
          <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: "#60A5FA" }} />
          <span className="opacity-70">Gasto:</span>
          <strong>{money.format(+row.spend || 0)}</strong>
        </div>
      )}
    </div>
  );
};

/* ---------- Componente ---------- */
const MetaAdsTrendChart: React.FC<Props> = ({
  objective,
  data,
  loading = false,
  height = 360,
  currencyCode = "MXN",
}) => {
  const { short, date } = useFormatters(currencyCode);

  const [showRevenue, setShowRevenue] = useState(true);
  const [showSpend, setShowSpend] = useState(false);
  const [showRoas, setShowRoas] = useState(false);

  const [sImp, setSImp] = useState(true);
  const [sReach, setSReach] = useState(false);
  const [sFreq, setSFreq] = useState(false);

  const [sLeads, setSLeads] = useState(true);
  const [sCpl, setSCpl] = useState(false);
  const [sCtr, setSCtr] = useState(false);
  const [sSpend2, setSSpend2] = useState(false);

  // Normalización de datos
  const cooked = useMemo(() => {
    const safe = (data ?? []).map((d) => {
      const revenue = Number.isFinite(+d.revenue!) ? +d.revenue! : 0;
      const spend   = Number.isFinite(+d.spend!)   ? +d.spend!   : 0;
      const clicks  = Number.isFinite(+d.clicks!)  ? +d.clicks!  : 0;
      const imp     = Number.isFinite(+d.impressions!) ? +d.impressions! : 0;
      const reach   = Number.isFinite(+d.reach!)       ? +d.reach!       : 0;
      const purchases = Number.isFinite(+d.purchases!) ? +d.purchases!   : 0;

      // posibles nombres alternativos para leads
      const rawLeads =
        (d as any).leads ??
        (d as any).messaging_conversations_started ??
        (d as any).conversions ??
        purchases;

      const leads = Number.isFinite(+rawLeads) ? +rawLeads : 0;

      const roas = spend > 0 ? revenue / spend : 0;
      const ctr  = imp > 0 ? clicks / imp : 0;
      const freq = reach > 0 ? imp / reach : 0;
      const cpl  = leads > 0 ? spend / leads : 0;

      return { ...d, revenue, spend, clicks, impressions: imp, reach, purchases, roas, ctr, freq, leads, cpl };
    });
    return safe;
  }, [data]);

  const roasMax = useMemo(
    () => cooked.reduce((m, p) => Math.max(m, Number(p.roas) || 0), 0),
    [cooked]
  );
  const roasDomain: [number, number] = [0, roasMax > 0 ? roasMax * 1.1 : 1];

  if (loading) {
    return (
      <div className="rounded-xl border border-border bg-card/60 p-4 animate-pulse" style={{ height }}>
        <div className="h-6 w-40 bg-muted rounded mb-4" />
        <div className="h-[calc(100%-2rem)] w-full bg-muted rounded" />
      </div>
    );
  }

  if (!cooked.length) {
    return (
      <div className="rounded-xl border border-border bg-card/60 p-8 text-center text-sm text-muted-foreground" style={{ height }}>
        No hay datos suficientes para mostrar la tendencia.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card/60 p-4">
      {/* Controles de series */}
      <div className="flex items-center gap-2 mb-2">
        <span className="text-sm mr-2 text-white/80">Tendencia</span>

        {objective === "ventas" && (
          <>
            <button onClick={() => setShowRevenue((v) => !v)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition ${showRevenue ? "bg-[#B55CFF]/20 text-[#E9D5FF] border border-[#B55CFF]/40" : "bg-white/5 text-white/70 border border-white/10"}`}>
              Revenue
            </button>
            <button onClick={() => setShowSpend((v) => !v)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition ${showSpend ? "bg-[#60A5FA]/20 text-[#DCEBFF] border border-[#60A5FA]/40" : "bg-white/5 text-white/70 border border-white/10"}`}>
              Gasto
            </button>
            <button onClick={() => setShowRoas((v) => !v)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition ${showRoas ? "bg-[#F59E0B]/20 text-[#FFE7B2] border border-[#F59E0B]/40" : "bg-white/5 text-white/70 border border-white/10"}`}>
              ROAS
            </button>
          </>
        )}

        {objective === "alcance" && (
          <>
            <button onClick={() => setSImp((v) => !v)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition ${sImp ? "bg-[#818CF8]/20 text-white border border-[#818CF8]/30" : "bg-white/5 text-white/70 border border-white/10"}`}>
              Impresiones
            </button>
            <button onClick={() => setSReach((v) => !v)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition ${sReach ? "bg-[#22D3EE]/20 text-white border border-[#22D3EE]/30" : "bg-white/5 text-white/70 border border-white/10"}`}>
              Alcance
            </button>
            <button onClick={() => setSFreq((v) => !v)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition ${sFreq ? "bg-[#F59E0B]/20 text-white border border-[#F59E0B]/30" : "bg-white/5 text-white/70 border border-white/10"}`}>
              Frecuencia
            </button>
          </>
        )}

        {objective === "leads" && (
          <>
            <button onClick={() => setSLeads((v) => !v)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition ${sLeads ? "bg-emerald-500/20 text-white border border-emerald-400/40" : "bg-white/5 text-white/70 border border-white/10"}`}>
              Leads
            </button>
            <button onClick={() => setSCpl((v) => !v)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition ${sCpl ? "bg-teal-500/20 text-white border border-teal-400/40" : "bg-white/5 text-white/70 border border-white/10"}`}>
              CPL
            </button>
            <button onClick={() => setSCtr((v) => !v)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition ${sCtr ? "bg-amber-500/20 text-white border border-amber-400/40" : "bg-white/5 text-white/70 border border-white/10"}`}>
              CTR
            </button>
            <button onClick={() => setSSpend2((v) => !v)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition ${sSpend2 ? "bg-[#60A5FA]/20 text-[#DCEBFF] border border-[#60A5FA]/40" : "bg-white/5 text-white/70 border border-white/10"}`}>
              Gasto
            </button>
          </>
        )}
      </div>

      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={cooked} margin={{ top: 10, right: 18, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="gradRevenue" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"  stopColor="#B55CFF" stopOpacity={0.35} />
              <stop offset="100%" stopColor="#B55CFF" stopOpacity={0.02} />
            </linearGradient>
            <linearGradient id="gradSpend" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"  stopColor="#60A5FA" stopOpacity={0.30} />
              <stop offset="100%" stopColor="#60A5FA" stopOpacity={0.02} />
            </linearGradient>
            <linearGradient id="gradImp" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"  stopColor="#818CF8" stopOpacity={0.30} />
              <stop offset="100%" stopColor="#818CF8" stopOpacity={0.02} />
            </linearGradient>
            <linearGradient id="gradReach" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"  stopColor="#22D3EE" stopOpacity={0.30} />
              <stop offset="100%" stopColor="#22D3EE" stopOpacity={0.02} />
            </linearGradient>
            <linearGradient id="gradLeads" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"  stopColor="#34D399" stopOpacity={0.30} />
              <stop offset="100%" stopColor="#34D399" stopOpacity={0.02} />
            </linearGradient>
          </defs>

          <CartesianGrid stroke="rgba(255,255,255,0.06)" strokeDasharray="3 3" />

          <XAxis
            dataKey="date"
            tickFormatter={date}
            tick={{ fill: "rgba(255,255,255,0.55)", fontSize: 12 }}
            axisLine={{ stroke: "rgba(255,255,255,0.15)" }}
            tickLine={{ stroke: "rgba(255,255,255,0.15)" }}
            minTickGap={24}
          />

          {/* Ejes por objetivo */}
          {objective === "ventas" && (
            <>
              <YAxis
                yAxisId="money"
                tickFormatter={(v) => short(Number(v) || 0)}
                tick={{ fill: "rgba(255,255,255,0.55)", fontSize: 12 }}
                axisLine={{ stroke: "rgba(255,255,255,0.15)" }}
                tickLine={{ stroke: "rgba(255,255,255,0.15)" }}
                width={70}
              />
              <YAxis
                yAxisId="roas"
                orientation="right"
                tickFormatter={(v) => `${Number(v).toFixed(2)}×`}
                tick={{ fill: showRoas ? "rgba(255,255,255,0.6)" : "rgba(255,255,255,0.25)", fontSize: 12 }}
                axisLine={{ stroke: "rgba(255,255,255,0.15)" }}
                tickLine={{ stroke: "rgba(255,255,255,0.15)" }}
                width={50}
                hide={!showRoas}
                domain={roasDomain}
              />
            </>
          )}

          {objective === "alcance" && (
            <>
              <YAxis
                yAxisId="count"
                tickFormatter={(v) => short(Number(v) || 0)}
                tick={{ fill: "rgba(255,255,255,0.55)", fontSize: 12 }}
                axisLine={{ stroke: "rgba(255,255,255,0.15)" }}
                tickLine={{ stroke: "rgba(255,255,255,0.15)" }}
                width={70}
              />
              <YAxis
                yAxisId="freq"
                orientation="right"
                tickFormatter={(v) => `${Number(v).toFixed(2)}×`}
                tick={{ fill: sFreq ? "rgba(255,255,255,0.6)" : "rgba(255,255,255,0.25)", fontSize: 12 }}
                axisLine={{ stroke: "rgba(255,255,255,0.15)" }}
                tickLine={{ stroke: "rgba(255,255,255,0.15)" }}
                width={50}
                hide={!sFreq}
              />
            </>
          )}

          {objective === "leads" && (
            <>
              <YAxis
                yAxisId="count"
                tickFormatter={(v) => short(Number(v) || 0)}
                tick={{ fill: "rgba(255,255,255,0.55)", fontSize: 12 }}
                axisLine={{ stroke: "rgba(255,255,255,0.15)" }}
                tickLine={{ stroke: "rgba(255,255,255,0.15)" }}
                width={70}
              />
              <YAxis
                yAxisId="percent"
                orientation="right"
                tickFormatter={(v) => `${(Number(v) * 100).toFixed(0)}%`}
                tick={{ fill: sCtr ? "rgba(255,255,255,0.6)" : "rgba(255,255,255,0.25)", fontSize: 12 }}
                axisLine={{ stroke: "rgba(255,255,255,0.15)" }}
                tickLine={{ stroke: "rgba(255,255,255,0.15)" }}
                width={50}
                hide={!sCtr}
                domain={[0, 0.1]}
              />
              <YAxis yAxisId="money" hide tickFormatter={(v) => short(Number(v) || 0)} />
            </>
          )}

          {/* Tooltips */}
          {objective === "ventas" && (
            <Tooltip
              content={
                <TooltipVentas
                  showRevenue={showRevenue}
                  showSpend={showSpend}
                  showRoas={showRoas}
                  currencyCode={currencyCode}
                />
              }
              cursor={{ stroke: "rgba(181,92,255,0.35)", strokeWidth: 1 }}
              labelFormatter={(d) => d}
            />
          )}
          {objective === "alcance" && (
            <Tooltip
              content={<TooltipAlcance sImp={sImp} sReach={sReach} sFreq={sFreq} />}
              cursor={{ stroke: "rgba(129,140,248,0.35)", strokeWidth: 1 }}
              labelFormatter={(d) => d}
            />
          )}
          {objective === "leads" && (
            <Tooltip
              content={
                <TooltipLeads
                  sLeads={sLeads}
                  sCpl={sCpl}
                  sCtr={sCtr}
                  sSpend={sSpend2}
                  currencyCode={currencyCode}
                />
              }
              cursor={{ stroke: "rgba(52,211,153,0.35)", strokeWidth: 1 }}
              labelFormatter={(d) => d}
            />
          )}

          {/* Series */}
          {objective === "ventas" && (
            <>
              {showRevenue && (
                <Area yAxisId="money" type="monotone" dataKey="revenue" stroke="#B55CFF" strokeWidth={2} fill="url(#gradRevenue)" dot={false} activeDot={{ r: 4 }} name="Revenue" />
              )}
              {showSpend && (
                <Area yAxisId="money" type="monotone" dataKey="spend" stroke="#60A5FA" strokeWidth={2} fill="url(#gradSpend)" dot={false} activeDot={{ r: 3 }} name="Gasto" />
              )}
              {showRoas && (
                <Line yAxisId="roas" type="monotone" dataKey="roas" stroke="#F59E0B" strokeWidth={2} dot={false} isAnimationActive={false} name="ROAS" />
              )}
            </>
          )}

          {objective === "alcance" && (
            <>
              {sImp && <Area yAxisId="count" type="monotone" dataKey="impressions" stroke="#818CF8" strokeWidth={2} fill="url(#gradImp)" dot={false} activeDot={{ r: 3 }} name="Impresiones" />}
              {sReach && <Area yAxisId="count" type="monotone" dataKey="reach" stroke="#22D3EE" strokeWidth={2} fill="url(#gradReach)" dot={false} activeDot={{ r: 3 }} name="Alcance" />}
              {sFreq && <Line yAxisId="freq" type="monotone" dataKey="freq" stroke="#F59E0B" strokeWidth={2} dot={false} isAnimationActive={false} name="Frecuencia" />}
            </>
          )}

          {objective === "leads" && (
            <>
              {sLeads && <Area yAxisId="count" type="monotone" dataKey="leads" stroke="#34D399" strokeWidth={2} fill="url(#gradLeads)" dot={false} activeDot={{ r: 3 }} name="Leads" />}
              {sCpl &&   <Line yAxisId="money" type="monotone" dataKey="cpl" stroke="#10B981" strokeWidth={2} dot={false} isAnimationActive={false} name="CPL" />}
              {sCtr &&   <Line yAxisId="percent" type="monotone" dataKey="ctr" stroke="#F59E0B" strokeWidth={2} dot={false} isAnimationActive={false} name="CTR" />}
              {sSpend2 && <Area yAxisId="money" type="monotone" dataKey="spend" stroke="#60A5FA" strokeWidth={2} fill="url(#gradSpend)" dot={false} activeDot={{ r: 3 }} name="Gasto" />}
            </>
          )}

          <Brush dataKey="date" height={24} stroke="#B55CFF" travellerWidth={10} tickFormatter={date} fill="rgba(255,255,255,0.04)" />
        </AreaChart>
      </ResponsiveContainer>

      <div className="mt-2 text-xs text-muted-foreground">
        {objective === "ventas"
          ? `Valores en ${currencyCode}. Eje izquierdo en moneda abreviada; ROAS (der) en “×”.`
          : objective === "alcance"
          ? "Impresiones/Alcance en conteo (izq); Frecuencia en eje der (×)."
          : "Leads y Clics en conteo; CPL/Gasto en moneda; CTR en eje der (%)."}{" "}
        Activa/desactiva series con los botones para comparar.
      </div>
    </div>
  );
};

export default MetaAdsTrendChart;
