// dashboard-src/src/components/google-analytics/GoogleAnalyticsConversionFunnel.tsx
import React, { useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
// NUEVO: iconos para chips de delta
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";

type RawFunnel = {
  view_item?: number;
  add_to_cart?: number;
  begin_checkout?: number;
  purchase?: number;
  revenue?: number; // si lo pasas, calculamos AOV
};

type Stage = {
  key: string;
  label: string;
  value: number;
  pctOfInitial: number;       // 0–100
  dropoffFromInitial: number; // 0–100
  isMoney?: boolean;
};

type Props = {
  raw?: RawFunnel; // <-- sales?.funnel + revenue inyectado
  // NUEVO: periodo anterior para chips de comparación
  prev?: { view_item?: number; purchase?: number; revenue?: number };
  currencyCode?: string;
};

function fmtInt(n = 0) {
  return new Intl.NumberFormat("es-MX").format(Math.round(n));
}
function fmtMoney(n = 0, currency = "USD") {
  try {
    return new Intl.NumberFormat("es-MX", { style: "currency", currency, maximumFractionDigits: 0 }).format(n);
  } catch {
    return `$${fmtInt(n)}`;
  }
}
const pct1 = (v: number) => `${(Math.max(0, Math.min(100, v))).toFixed(1)}%`;
const pct2 = (v: number) => `${(Math.max(0, Math.min(100, v))).toFixed(2)}%`;

// NUEVO: chip reutilizable (igual estilo que Meta)
function DeltaChip({ value }: { value?: number | null }) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const pctVal = value * 100;
  const sign = pctVal === 0 ? "neutral" : pctVal > 0 ? "up" : "down";
  const cls =
    sign === "up"
      ? "bg-emerald-500/10 text-emerald-300 ring-emerald-400/20"
      : sign === "down"
      ? "bg-rose-500/10 text-rose-300 ring-rose-400/20"
      : "bg-slate-500/10 text-slate-300 ring-slate-400/20";
  const Icon = sign === "up" ? ArrowUpRight : sign === "down" ? ArrowDownRight : Minus;

  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${cls}`}>
      <Icon className="h-3 w-3" />
      {Math.abs(pctVal).toFixed(1)}% <span className="opacity-70 ml-1">vs mes anterior</span>
    </span>
  );
}

const GoogleAnalyticsConversionFunnel: React.FC<Props> = ({ raw, prev, currencyCode = "USD" }) => {
  const f = {
    view_item: Math.max(0, Number(raw?.view_item || 0)),
    add_to_cart: Math.max(0, Number(raw?.add_to_cart || 0)),
    begin_checkout: Math.max(0, Number(raw?.begin_checkout || 0)),
    purchase: Math.max(0, Number(raw?.purchase || 0)),
    revenue: Math.max(0, Number(raw?.revenue || 0)),
  };

  /** --------- KPIs de resumen (arriba) --------- */
  const summary = useMemo(() => {
    const v = f.view_item || 0;
    const a = f.add_to_cart || 0;
    const c = f.begin_checkout || 0;
    const p = f.purchase || 0;

    const convTotal = v > 0 ? (p / v) * 100 : 0;             // Compra / Vista (en %)
    const rateViewToCart = v > 0 ? (a / v) * 100 : 0;        // Vista -> Carrito
    const rateCartToCheckout = a > 0 ? (c / a) * 100 : 0;    // Carrito -> Checkout
    const rateCheckoutToPurchase = c > 0 ? (p / c) * 100 : 0;// Checkout -> Compra
    const aov = p > 0 && f.revenue > 0 ? f.revenue / p : 0;

    return { convTotal, rateViewToCart, rateCartToCheckout, rateCheckoutToPurchase, aov };
  }, [f.view_item, f.add_to_cart, f.begin_checkout, f.purchase, f.revenue]);

  // NUEVO: comparativas vs mes anterior para Conv. total y AOV
  const { deltaConv, deltaAov } = useMemo(() => {
    if (!prev) return { deltaConv: null, deltaAov: null };
    const pv = Math.max(0, Number(prev.view_item || 0));
    const pp = Math.max(0, Number(prev.purchase || 0));
    const pr = Math.max(0, Number(prev.revenue || 0));

    const prevConvPct = pv > 0 ? (pp / pv) * 100 : 0; // en %
    const prevAov = pp > 0 ? pr / pp : 0;

    const dConv = prevConvPct > 0 ? (summary.convTotal - prevConvPct) / prevConvPct : null;
    const dAov = prevAov > 0 ? (summary.aov - prevAov) / prevAov : null;
    return { deltaConv: dConv, deltaAov: dAov };
  }, [prev, summary.convTotal, summary.aov]);

  /** --------- Barras normalizadas vs etapa inicial --------- */
  const stages: Stage[] = useMemo(() => {
    const initial = Math.max(1, f.view_item);
    const mk = (key: string, label: string, value: number, isMoney = false): Stage => {
      const pctOfInitial = (value / initial) * 100;
      return {
        key, label, value, isMoney,
        pctOfInitial: Math.min(100, Math.max(0, pctOfInitial)),
        dropoffFromInitial: Math.min(100, Math.max(0, (1 - value / initial) * 100)),
      };
    };
    const list: Stage[] = [
      mk("view_item", "Vista producto", f.view_item),
      mk("add_to_cart", "Carrito", f.add_to_cart),
      mk("begin_checkout", "Checkout", f.begin_checkout),
      mk("purchase", "Compra", f.purchase),
    ];
    // Si quieres mostrar ingresos como última barra opcional:
    // if (f.revenue > 0) list.push(mk("revenue", "Ingresos", f.revenue, true));
    return list;
  }, [f.view_item, f.add_to_cart, f.begin_checkout, f.purchase /*, f.revenue */]);

  return (
    <Card className="glass-effect overflow-hidden">
      <CardHeader className="pb-3">
        <CardTitle className="text-foreground">Embudo de Conversión</CardTitle>
        <CardDescription>Journey desde la vista de producto hasta la compra</CardDescription>
      </CardHeader>

      <CardContent className="pt-0 space-y-6">
        {/* ===== Resumen arriba ===== */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3">
            <div className="text-xs text-muted-foreground mb-1">Conv. total (Compra/Vista)</div>
            <div className="flex items-center gap-2">
              <div className="text-xl font-semibold">{pct2(summary.convTotal)}</div>
              {/* NUEVO: chip vs mes anterior */}
              <DeltaChip value={deltaConv} />
            </div>
          </div>
          <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3">
            <div className="text-xs text-muted-foreground mb-1">Vista → Carrito</div>
            <div className="text-xl font-semibold">{pct1(summary.rateViewToCart)}</div>
          </div>
          <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3">
            <div className="text-xs text-muted-foreground mb-1">Carrito → Checkout</div>
            <div className="text-xl font-semibold">{pct1(summary.rateCartToCheckout)}</div>
          </div>
          <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3">
            <div className="text-xs text-muted-foreground mb-1">Checkout → Compra</div>
            <div className="text-xl font-semibold">{pct1(summary.rateCheckoutToPurchase)}</div>
          </div>
          <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3">
            <div className="text-xs text-muted-foreground mb-1">AOV</div>
            <div className="flex items-center gap-2">
              <div className="text-xl font-semibold">
                {summary.aov > 0 ? fmtMoney(summary.aov, currencyCode) : "—"}
              </div>
              {/* NUEVO: chip vs mes anterior */}
              <DeltaChip value={deltaAov} />
            </div>
          </div>
        </div>

        {/* ===== Barras del embudo ===== */}
        <div className="space-y-5">
          {stages.map((s, i) => {
            const width = `${s.pctOfInitial}%`;
            const valueLabel = s.isMoney ? fmtMoney(s.value, currencyCode) : fmtInt(s.value);
            const showDrop = i > 0 && s.dropoffFromInitial > 0;

            return (
              <div key={s.key} className="relative">
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-primary" />
                    <h3 className="font-medium text-foreground">{s.label}</h3>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">{valueLabel}</span>
                    {showDrop && (
                      <Badge variant="destructive" className="text-xs">
                        −{pct1(s.dropoffFromInitial)}
                      </Badge>
                    )}
                  </div>
                </div>

                <div className="h-3 w-full rounded-full bg-muted">
                  <div
                    className="h-3 rounded-full bg-gradient-to-r from-primary to-primary/80 transition-all duration-500"
                    style={{ width }}
                  />
                </div>

                <div className="mt-1 text-xs text-muted-foreground">
                  {pct1(s.pctOfInitial)} del total inicial
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
};

export default GoogleAnalyticsConversionFunnel;
