// dashboard-src/src/components/meta-ads/MetaAdsEntityTable.tsx
import { useEffect, useMemo, useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  TooltipProvider,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { ChevronLeft, ChevronRight, AlertCircle, Info } from "lucide-react";

/* ------------------------ Tipos ------------------------ */

type Row = {
  id: string;
  name: string;

  // básicos
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number; // %
  cpc: number; // $
  cpm: number; // $

  // alcance/frecuencia
  reach: number;
  frequency: number;

  // acciones y costes
  inline_link_clicks?: number; // “Clics en el enlace”
  landing_page_views?: number; // “Visitas a la página”
  cost_per_lpv?: number | null; // “Costo por visita”
  results: number; // Compras o Leads según objetivo
  cost_per_result: number | null; // CPA / CPL

  // estado / extras
  budget?: number | null; // presupuesto normalizado a moneda
  stop_time?: string | null; // ISO
  campaign_id?: string;
  adset_id?: string;
  ad_id?: string;
  status?: string | null;
  effective_status?: string | null;
};

type RespOk = {
  account_id: string;
  level: "campaign" | "adset" | "ad";
  objective: "ventas" | "alcance" | "leads";
  total: number;
  page: number;
  page_size: number;
  rows: Row[];
};

type RespErr = {
  error: string;
  details?: any;
  total?: number;
  page?: number;
  page_size?: number;
  rows?: Row[];
};

type Resp = RespOk | RespErr;

/** Claves de columnas: las reales de Row + la virtual "state" */
type ColumnKey = keyof Row | "state";
type ColumnDef = { key: ColumnKey; label: string };

interface Props {
  accountId: string;
  objective: "ventas" | "alcance" | "leads";
  datePreset?: string;
  since?: string;
  until?: string;
  apiBase?: string;
  currencyCode?: string;
}

/* ------------------------ Componente ------------------------ */

export default function MetaAdsEntityTable({
  accountId,
  objective,
  datePreset = "last_30d",
  since,
  until,
  apiBase = "/api/meta",
  currencyCode = "MXN",
}: Props) {
  const [level, setLevel] = useState<"campaign" | "adset" | "ad">("campaign");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("spend:desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [onlyActive, setOnlyActive] = useState(false);

  const [data, setData] = useState<RespOk | null>(null);
  const [loading, setLoading] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  const qs = useMemo(() => {
    const p = new URLSearchParams({
      account_id: accountId,
      level,
      objective,
      sort,
      page: String(page),
      page_size: String(pageSize),
    });
    if (datePreset && !(since && until)) p.set("date_preset", datePreset);
    if (since && until) {
      p.delete("date_preset");
      p.set("since", since);
      p.set("until", until);
    }
    if (search) p.set("search", search);
    if (onlyActive) p.set("only_active", "1");
    return p.toString();
  }, [
    accountId,
    level,
    objective,
    datePreset,
    since,
    until,
    sort,
    page,
    pageSize,
    search,
    onlyActive,
  ]);

  useEffect(() => {
    const ctrl = new AbortController();
    (async () => {
      setLoading(true);
      setApiError(null);
      try {
        const res = await fetch(`${apiBase}/table?${qs}`, { signal: ctrl.signal });
        const json: Resp = await res.json().catch(() => ({ error: "parse_error" }));
        if (!res.ok || !json || !Array.isArray((json as any).rows)) {
          const msg = (json as RespErr)?.error || `HTTP ${res.status}`;
          setApiError(typeof msg === "string" ? msg : "meta_table_failed");
          setData({
            account_id: accountId,
            level,
            objective,
            total: 0,
            page: 1,
            page_size: pageSize,
            rows: [],
          });
          return;
        }
        setData(json as RespOk);
      } catch (e: any) {
        if (e?.name !== "AbortError") {
          setApiError(e?.message || "request_failed");
          setData({
            account_id: accountId,
            level,
            objective,
            total: 0,
            page: 1,
            page_size: pageSize,
            rows: [],
          });
        }
      } finally {
        setLoading(false);
      }
    })();
    return () => ctrl.abort();
  }, [qs, apiBase, accountId, level, objective, pageSize]);

  useEffect(() => {
    setPage(1);
  }, [level, search, sort, objective, accountId, datePreset, since, until, onlyActive]);

  /* ------------------ Tooltips (descripciones) ------------------ */
  const METRIC_HELP: Partial<Record<ColumnKey, string>> = {
  state: "Indica si la entidad está activa (effective_status=ACTIVE) o inactiva.",
  name: level === "campaign" ? "Nombre de la campaña." : level === "adset" ? "Nombre del conjunto." : "Nombre del anuncio.",
  spend: "Cantidad aproximada de dinero gastado en el rango seleccionado.",
  impressions: "Número de veces que tus anuncios se mostraron en pantalla.",
  clicks: "Clics totales registrados por Meta (incluye varios tipos).",
  ctr: "Porcentaje de impresiones que generaron un clic. CTR = Clics / Impresiones.",
  cpc: "Costo promedio por clic. CPC = Gasto / Clics.",
  cpm: "Costo por mil impresiones. CPM = Gasto / (Impresiones / 1000).",
  inline_link_clicks: "Clics en el enlace principal del anuncio (hacia tu sitio o destino).",
  landing_page_views: "Visitas a la página de destino (se registra cuando la página carga).",
  cost_per_lpv: "Costo promedio por visita a la página de destino. Gasto / Visitas a la página.",
  results: objective === "leads" ? "Leads registrados según configuración." : objective === "alcance" ? "Alcance del anuncio." : "Compras atribuidas según la configuración de conversión.",
  cost_per_result: objective === "leads" ? "Costo por lead (CPL)." : objective === "alcance" ? "Costo por usuario alcanzado." : "Costo por compra (CPA).",
  reach: "Número de personas únicas que vieron al menos una impresión.",
  frequency: "Promedio de veces que una persona vio tu anuncio (Impresiones / Alcance).",
  budget: "Presupuesto configurado en la entidad. Si es diario, refleja el tope diario normalizado.",
  stop_time: "Fecha de finalización programada de la campaña/conjunto (si aplica).",
};

  /* ------------------ Columnas ------------------ */
  const columns: ReadonlyArray<ColumnDef> = useMemo(() => {
    return [
      { key: "state", label: "Estado" },
      {
        key: "name",
        label:
          level === "campaign" ? "Campaña" : level === "adset" ? "Conjunto" : "Anuncio",
      },
      { key: "spend", label: "Gasto" },
      { key: "impressions", label: "Impresiones" },
      { key: "clicks", label: "Clics" },
      { key: "ctr", label: "CTR" },
      { key: "cpc", label: "CPC" },
      { key: "cpm", label: "CPM" },
      { key: "inline_link_clicks", label: "Clics enlace" },
      { key: "landing_page_views", label: "Visitas página" },
      { key: "cost_per_lpv", label: "Costo/visita" },
      {
        key: "results",
        label: objective === "leads" ? "Leads" : objective === "alcance" ? "Alcance" : "Compras",
      },
      {
        key: "cost_per_result",
        label: objective === "leads" ? "CPL" : objective === "alcance" ? "Costo/alcance" : "CPA",
      },
      { key: "reach", label: "Alcance" },
      { key: "frequency", label: "Frecuencia" },
      { key: "budget", label: "Presupuesto" },
      { key: "stop_time", label: "Finalización" },
    ];
  }, [level, objective]);

  /* ------------------ Helpers de formato ------------------ */
  const fmt = (n: number | null | undefined, opts?: Intl.NumberFormatOptions) =>
    (Number.isFinite(n as number) ? (n as number) : 0).toLocaleString(undefined, opts);

  const fmtDate = (iso?: string | null) => {
    if (!iso) return "—";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleDateString(undefined, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  };

  const safeRows = Array.isArray(data?.rows) ? data!.rows : [];
  const total = typeof data?.total === "number" ? data!.total : 0;
  const canNext = (data?.page ?? 1) * (data?.page_size ?? pageSize) < total;

  /* ------------------ Encabezado con tooltip elegante ------------------ */
  const Th = ({ k, label }: { k: ColumnKey; label: string }) => (
    <Tooltip>
      <TooltipTrigger asChild>
        <TableHead className="group whitespace-nowrap text-xs font-medium tracking-wide">
          <span className="inline-flex items-center gap-1.5 cursor-help">
            {label}
            <span
              className="
                inline-flex items-center justify-center h-4 w-4 rounded-md
                opacity-0 group-hover:opacity-100 group-focus:opacity-100
                transition-opacity duration-150
                bg-violet-500/15 text-violet-300 border border-violet-500/30
              "
              aria-hidden
            >
              <Info className="h-3 w-3" />
            </span>
          </span>
        </TableHead>
      </TooltipTrigger>

      <TooltipContent
        side="bottom"
        align="start"
        className="
          max-w-xs text-[11.5px] leading-[1.15rem]
          rounded-xl px-3 py-2
          bg-zinc-900/95 backdrop-blur-md
          border border-violet-500/30
          shadow-[0_10px_40px_-10px_rgba(0,0,0,0.7)]
          text-zinc-200 relative
        "
      >
        {METRIC_HELP[k] ?? label}
        <div
          className="absolute -top-1 left-3 h-2 w-2 rotate-45
                     bg-zinc-900/95 border-l border-t border-violet-500/30"
          aria-hidden
        />
      </TooltipContent>
    </Tooltip>
  );

  /* ------------------ Render ------------------ */
  return (
    <Card className="rounded-2xl shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center gap-3">
          Detalle {level === "campaign" ? "por campaña" : level === "adset" ? "por conjunto" : "por anuncio"}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Select value={level} onValueChange={(v: any) => setLevel(v)}>
              <SelectTrigger className="w-[170px]">
                <SelectValue placeholder="Nivel" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="campaign">Campañas</SelectItem>
                <SelectItem value="adset">Conjuntos</SelectItem>
                <SelectItem value="ad">Anuncios</SelectItem>
              </SelectContent>
            </Select>
            <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
              <SelectTrigger className="w-[120px]">
                <SelectValue placeholder="Filas" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="25">25</SelectItem>
                <SelectItem value="50">50</SelectItem>
                <SelectItem value="100">100</SelectItem>
              </SelectContent>
            </Select>
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Buscar ${level}...`}
              className="w-[220px]"
            />
          </div>
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <div className="flex items-center gap-2">
            <span>Orden:</span>
            <Select value={sort} onValueChange={setSort}>
              <SelectTrigger className="w-[240px]">
                <SelectValue placeholder="Orden" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="spend:desc">Gasto ↓</SelectItem>
                <SelectItem value="spend:asc">Gasto ↑</SelectItem>
                <SelectItem value="results:desc">Resultados ↓</SelectItem>
                <SelectItem value="results:asc">Resultados ↑</SelectItem>
                <SelectItem value="ctr:desc">CTR ↓</SelectItem>
                <SelectItem value="cpc:asc">CPC ↑</SelectItem>
                <SelectItem value="inline_link_clicks:desc">Clics enlace ↓</SelectItem>
                <SelectItem value="landing_page_views:desc">Visitas página ↓</SelectItem>
                <SelectItem value="cost_per_lpv:asc">Costo/visita ↑</SelectItem>
                <SelectItem value="cost_per_result:asc">CPA/CPL ↑</SelectItem>
                <SelectItem value="reach:desc">Alcance ↓</SelectItem>
                <SelectItem value="frequency:desc">Frecuencia ↓</SelectItem>
                <SelectItem value="budget:desc">Presupuesto ↓</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <Switch checked={onlyActive} onCheckedChange={setOnlyActive} id="only-active" />
            <label htmlFor="only-active" className="cursor-pointer select-none">
              Solo activos
            </label>
          </div>

          {loading && <span className="opacity-70">Cargando…</span>}
          {apiError && !loading && (
            <span className="flex items-center gap-1 text-red-400">
              <AlertCircle className="w-4 h-4" /> {apiError}
            </span>
          )}
        </div>

        <TooltipProvider delayDuration={200}>
          <div className="overflow-auto rounded-lg border">
            <Table>
              <TableHeader className="bg-zinc-900/30">
                <TableRow className="[&>th]:py-3 [&>th]:text-zinc-300">
                  {columns.map((c) => (
                    <Th key={String(c.key)} k={c.key} label={c.label} />
                  ))}
                </TableRow>
              </TableHeader>

              <TableBody>
                {safeRows.map((r) => (
                  <TableRow key={r.id}>
                    {columns.map((c) => {
                      const key = c.key as ColumnKey;

                      // Estado (columna virtual)
                      if (key === "state") {
                        const eff = (r.effective_status || "").toUpperCase();
                        const active = eff === "ACTIVE";
                        const cls = active
                          ? "bg-violet-600/20 text-violet-200 border border-violet-500/40"
                          : "bg-zinc-700/40 text-zinc-300 border border-zinc-500/30";
                        return (
                          <TableCell key={`cell-${r.id}-state`}>
                            <Badge
                              className={`rounded-full px-2.5 py-0.5 font-medium tracking-wide ${cls}`}
                              aria-label={active ? "Activa" : "Inactiva"}
                            >
                              {active ? "Activa" : "Inactiva"}
                            </Badge>
                          </TableCell>
                        );
                      }

                      // Valor de la fila (solo claves reales de Row)
                      const value = (r as any)[key as keyof Row];

                      // Nombre
                      if (key === "name") {
                        return (
                          <TableCell key={`cell-${r.id}-name`} className="max-w-[420px] truncate">
                            {r.name}
                          </TableCell>
                        );
                      }

                      // Moneda
                      if (
                        ["spend", "cpc", "cpm", "cost_per_lpv", "cost_per_result", "budget"].includes(
                          String(key)
                        )
                      ) {
                        return (
                          <TableCell key={`cell-${r.id}-${String(key)}`}>
                            {fmt(value, { style: "currency", currency: currencyCode })}
                          </TableCell>
                        );
                      }

                      // Porcentaje
                      if (key === "ctr") {
                        return (
                          <TableCell key={`cell-${r.id}-ctr`}>
                            {fmt(value, { maximumFractionDigits: 2 })}%
                          </TableCell>
                        );
                      }

                      // Fecha
                      if (key === "stop_time") {
                        return <TableCell key={`cell-${r.id}-stop`}>{fmtDate(value)}</TableCell>;
                      }

                      // Enteros
                      return <TableCell key={`cell-${r.id}-${String(key)}`}>{fmt(value)}</TableCell>;
                    })}
                  </TableRow>
                ))}

                {!loading && safeRows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={columns.length} className="text-center py-8 opacity-70">
                      {apiError ? "No fue posible cargar datos." : "Sin datos"}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </TooltipProvider>

        <div className="flex items-center justify-between text-sm">
          <div>{`Mostrando ${safeRows.length} de ${total}`}</div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || loading}
            >
              <ChevronLeft className="w-4 h-4" /> Anterior
            </Button>
            <span>Página {page}</span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => p + 1)}
              disabled={!canNext || loading}
            >
              Siguiente <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
