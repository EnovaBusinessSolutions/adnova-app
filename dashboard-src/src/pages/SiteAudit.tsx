// dashboard-src/src/pages/SiteAudit.tsx
import { useMemo, useState, useEffect, useCallback, useRef } from "react";

import { Sidebar } from "@/components/Sidebar";
import MobileBottomNav from "@/components/MobileBottomNav";
import RichText from "@/components/RichText";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

import {
  AlertTriangle,
  Target,
  BarChart3,
  Users,
  Bot,
  Search,
  SlidersHorizontal,
  CheckCircle2,
  Circle,
  RotateCcw,
  CheckCheck,
  ChevronDown,
} from "lucide-react";

import {
  useLatestAudits,
  AuditDocVM,
  AuditIssueVM,
  SeverityNorm,
} from "@/hooks/useLatestAudits";

/** Detecta móvil robusto (ancho o pointer coarse) */
function useIsMobileLike() {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const mqWidth = window.matchMedia("(max-width: 900px)");
    const mqCoarse = window.matchMedia("(pointer: coarse)");

    const calc = () => setIsMobile(Boolean(mqWidth.matches || mqCoarse.matches));
    calc();

    const onChange = () => calc();

    try {
      mqWidth.addEventListener("change", onChange);
      mqCoarse.addEventListener("change", onChange);
      return () => {
        mqWidth.removeEventListener("change", onChange);
        mqCoarse.removeEventListener("change", onChange);
      };
    } catch {
      mqWidth.addListener(onChange);
      mqCoarse.addListener(onChange);
      return () => {
        mqWidth.removeListener(onChange);
        mqCoarse.removeListener(onChange);
      };
    }
  }, []);

  return isMobile;
}

/** ===== Tabs ===== */
const tabsData = [
  { id: "google-ads", label: "Google Ads", icon: Target },
  { id: "google-analytics", label: "Google Analytics", icon: BarChart3 },
  { id: "meta-ads", label: "Meta Ads", icon: Users },
];

/** ===== Utils de normalización ===== */
const asArr = <T,>(x: any): T[] => (Array.isArray(x) ? x : []);

const normalizeSeverity = (s: any): SeverityNorm => {
  const v = String(s ?? "").toLowerCase().trim();
  if (v === "high" || v === "alta") return "alta";
  if (v === "low" || v === "baja") return "baja";
  return "media";
};

type Issue = {
  title?: string;
  description?: string;
  severity?: SeverityNorm;
  recommendation?: string;
  area?: string;
};

const mapIssue = (i: AuditIssueVM): Issue => ({
  title: i?.title ?? "Hallazgo",
  description:
    i?.evidence ??
    (i as any)?.descripcion ??
    (i as any)?.description ??
    (i as any)?.detail ??
    "",
  severity: normalizeSeverity((i as any)?.severity),
  recommendation:
    i?.recommendation ??
    (i as any)?.action ??
    (i as any)?.suggestion ??
    undefined,
  area: typeof (i as any)?.area === "string" ? (i as any).area : undefined,
});

/** ========= Hook para historial de auditorías por fuente ========= */
type HistorySource = "google" | "meta" | "ga4";

function useAuditHistory(source: HistorySource, limit = 5) {
  const [data, setData] = useState<AuditDocVM[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<any>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const fetchHistory = async () => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          type: source,
          limit: String(limit),
        });

        const res = await fetch(`/api/audits/site/history?${params.toString()}`, {
          credentials: "include",
        });

        if (!res.ok) throw new Error(`Error ${res.status} al cargar historial`);

        const json = await res.json();
        const audits = Array.isArray(json?.audits) ? json.audits : [];

        if (!cancelled) setData(audits);
      } catch (e: any) {
        if (!cancelled) {
          setError(e?.message || "Error cargando historial");
          setData(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchHistory();
    return () => {
      cancelled = true;
    };
  }, [source, limit, nonce]);

  const refresh = () => setNonce((v) => v + 1);

  return { data, loading, error, refresh };
}

/** ========= Hook para estado de conexiones (Google / GA4 / Meta) ========= */
type Connections = {
  google: boolean;
  ga4: boolean;
  meta: boolean;
};

function useConnectionsStatus() {
  const [status, setStatus] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const fetchStatus = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/onboarding/status", {
          credentials: "include",
        });
        if (!res.ok) {
          throw new Error(`Error ${res.status} al cargar estado de conexiones`);
        }
        const json = await res.json();
        if (!cancelled) setStatus(json?.status || null);
      } catch (e: any) {
        if (!cancelled) {
          setError(e?.message || "Error cargando estado de conexiones");
          setStatus(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchStatus();
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  const connections: Connections = useMemo(
    () => ({
      google: !!status?.googleAds?.connected || !!status?.google?.connected,
      ga4: !!status?.ga4?.connected,
      meta: !!status?.meta?.connected,
    }),
    [status]
  );

  const refresh = () => setNonce((v) => v + 1);

  return { connections, loading, error, refresh, rawStatus: status };
}

/** =========================
 *  LEÍDO / NO LEÍDO (localStorage)
 *  ========================= */
function djb2Hash(input: string) {
  let h = 5381;
  for (let i = 0; i < input.length; i++) h = (h * 33) ^ input.charCodeAt(i);
  return (h >>> 0).toString(16);
}

function safeLower(x: any) {
  return String(x ?? "").toLowerCase();
}

function useReadStore(storageKey: string) {
  const [readMap, setReadMap] = useState<Record<string, true>>({});

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") setReadMap(parsed);
    } catch {
      // ignore
    }
  }, [storageKey]);

  const persist = useCallback(
    (next: Record<string, true>) => {
      setReadMap(next);
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        // ignore
      }
    },
    [storageKey]
  );

  const isRead = useCallback((key: string) => !!readMap[key], [readMap]);

  const toggleRead = useCallback(
    (key: string) => {
      const next = { ...readMap };
      if (next[key]) delete next[key];
      else next[key] = true;
      persist(next);
    },
    [readMap, persist]
  );

  const markManyRead = useCallback(
    (keys: string[]) => {
      if (!keys.length) return;
      const next = { ...readMap };
      for (const k of keys) next[k] = true;
      persist(next);
    },
    [readMap, persist]
  );

  const clearAll = useCallback(() => {
    persist({});
  }, [persist]);

  return { isRead, toggleRead, markManyRead, clearAll, readMap };
}

/** =========================
 *  UI helpers
 *  ========================= */
function sevBadgeClasses(sev: SeverityNorm) {
  if (sev === "alta") return "bg-red-500/15 text-red-300 border-red-500/25";
  if (sev === "baja") return "bg-green-500/15 text-green-300 border-green-500/25";
  return "bg-yellow-500/15 text-yellow-300 border-yellow-500/25";
}

function sevLabel(sev: SeverityNorm) {
  return sev === "alta" ? "Alta" : sev === "baja" ? "Baja" : "Media";
}

function sevPillLabel(sev: "all" | SeverityNorm) {
  if (sev === "all") return "Todas";
  return sevLabel(sev);
}

const NotConnectedState = ({ appName }: { appName: string }) => (
  <div className="flex flex-col items-center justify-center py-10 text-center space-y-4">
    <div className="inline-flex items-center justify-center w-11 h-11 rounded-full bg-[#24162F] text-[#EB2CFF] shadow-[0_0_22px_rgba(235,44,255,0.35)]">
      <AlertTriangle className="h-5 w-5" />
    </div>
    <div className="max-w-md space-y-1 px-4">
      <p className="text-sm font-semibold text-[#E5D3FF]">{appName} no está conectado.</p>
      <p className="text-xs text-[#9A8CA8]">
        Para ver auditorías de {appName}, conecta la aplicación en{" "}
        <span className="font-semibold">Configuración &gt; Integraciones de aplicaciones</span>.
      </p>
    </div>
    <a
      href="/dashboard/settings"
      className="inline-flex items-center px-4 py-2 rounded-md text-xs font-medium bg-gradient-to-r from-[#B55CFF] to-[#9D5BFF] hover:from-[#B55CFF]/90 hover:to-[#9D5BFF]/90 text-white shadow-lg shadow-[#B55CFF]/30 transition"
    >
      Ir a configuración
    </a>
  </div>
);

/** =========================
 *  Dropdown simple (sin libs)
 *  - Cierra con click afuera y con ESC
 *  ========================= */
function useOutsideClose(onClose: () => void) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const el = ref.current;
      if (!el) return;
      if (!el.contains(e.target as any)) onClose();
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };

    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return ref;
}

function FiltersDropdown({
  isMobile,
  sev,
  setSev,
  onlyUnread,
  setOnlyUnread,
  anyFilterOn,
  onClearFilters,
  onMarkVisibleRead,
  onResetRead,
  totalVisibleIssues,
}: {
  isMobile: boolean;
  sev: "all" | SeverityNorm;
  setSev: (v: "all" | SeverityNorm) => void;
  onlyUnread: boolean;
  setOnlyUnread: (v: boolean) => void;
  anyFilterOn: boolean;
  onClearFilters: () => void;
  onMarkVisibleRead: () => void;
  onResetRead: () => void;
  totalVisibleIssues: number;
}) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const toggle = () => setOpen((v) => !v);

  const ref = useOutsideClose(() => setOpen(false));

  const countBadges = [
    sev !== "all" ? `Severidad: ${sevPillLabel(sev)}` : null,
    onlyUnread ? "Solo no leídos" : null,
  ].filter(Boolean) as string[];

  return (
    <div className="relative" ref={ref as any}>
      <button
        type="button"
        onClick={toggle}
        className={[
          "inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium transition",
          "border-[#2C2530] bg-[#0B0B0D]/40 text-white/80 hover:bg-white/[0.06]",
          open ? "ring-2 ring-[#A96BFF]/20 border-[#A96BFF]/50" : "",
          isMobile ? "w-full justify-between" : "",
        ].join(" ")}
        aria-expanded={open}
      >
        <span className="inline-flex items-center gap-2">
          <SlidersHorizontal className="h-4 w-4 text-[#B55CFF]" />
          Filtros
          {anyFilterOn ? (
            <span className="ml-1 inline-flex items-center rounded-full border border-[#A96BFF]/40 bg-[#A96BFF]/12 px-2 py-0.5 text-[11px] text-[#E5D3FF]">
              activos
            </span>
          ) : null}
        </span>

        <ChevronDown className={["h-4 w-4 text-white/60 transition", open ? "rotate-180" : ""].join(" ")} />
      </button>

      {open ? (
        <div
          className={[
            "absolute z-50 mt-2 rounded-2xl border border-[#2C2530] bg-[#15121A] shadow-2xl shadow-black/40",
            isMobile ? "w-full" : "w-[360px] right-0",
          ].join(" ")}
        >
          <div className="p-3">
            {/* resumen */}
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-[#E5D3FF]">Filtrar hallazgos</div>
                <div className="mt-1 text-[11px] text-white/50">
                  Visible ahora: <span className="text-white/70">{totalVisibleIssues}</span>
                </div>
              </div>

              {anyFilterOn ? (
                <button
                  type="button"
                  onClick={() => {
                    onClearFilters();
                    close();
                  }}
                  className="text-[11px] text-white/60 hover:text-white/85 underline"
                >
                  Limpiar
                </button>
              ) : null}
            </div>

            {countBadges.length ? (
              <div className="mt-2 flex flex-wrap gap-2">
                {countBadges.map((b) => (
                  <span
                    key={b}
                    className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[11px] text-white/70"
                  >
                    {b}
                  </span>
                ))}
              </div>
            ) : null}

            <div className="my-3 h-px bg-white/10" />

            {/* severidad */}
            <div>
              <div className="text-[11px] font-semibold text-white/70 mb-2">Severidad</div>
              <div className="flex flex-wrap gap-2">
                {(["all", "alta", "media", "baja"] as const).map((s) => {
                  const active = sev === s;
                  const label = s === "all" ? "Todas" : sevLabel(s);
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setSev(s)}
                      className={[
                        "inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-medium transition",
                        active
                          ? "border-[#A96BFF]/60 bg-[#A96BFF]/15 text-[#E5D3FF]"
                          : "border-white/10 bg-white/[0.04] text-white/70 hover:bg-white/[0.07]",
                      ].join(" ")}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="my-3 h-px bg-white/10" />

            {/* no leídos */}
            <button
              type="button"
              onClick={() => setOnlyUnread(!onlyUnread)}
              className={[
                "w-full inline-flex items-center justify-between rounded-xl border px-3 py-2 text-sm transition",
                onlyUnread
                  ? "border-[#A96BFF]/60 bg-[#A96BFF]/12 text-[#E5D3FF]"
                  : "border-white/10 bg-white/[0.04] text-white/70 hover:bg-white/[0.07]",
              ].join(" ")}
            >
              <span className="inline-flex items-center gap-2">
                {onlyUnread ? (
                  <CheckCircle2 className="h-4 w-4 text-[#B55CFF]" />
                ) : (
                  <Circle className="h-4 w-4 text-white/40" />
                )}
                Solo no leídos
              </span>
              <span className="text-[11px] text-white/45">{onlyUnread ? "ON" : "OFF"}</span>
            </button>

            <div className="my-3 h-px bg-white/10" />

            {/* acciones */}
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => {
                  onMarkVisibleRead();
                  close();
                }}
                className="w-full inline-flex items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm font-medium text-white/75 hover:bg-white/[0.07] transition"
                title="Marca como leído todo lo visible (respetando filtros)"
              >
                <CheckCheck className="h-4 w-4 mr-2 text-[#B55CFF]" />
                Marcar visible como leído
              </button>

              <button
                type="button"
                onClick={() => {
                  onResetRead();
                  close();
                }}
                className="w-full inline-flex items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm font-medium text-white/75 hover:bg-white/[0.07] transition"
                title="Reinicia el estado leído/no leído (solo esta fuente)"
              >
                <RotateCcw className="h-4 w-4 mr-2 text-[#B55CFF]" />
                Reset leído
              </button>
            </div>

            <div className="mt-3">
              <button
                type="button"
                onClick={close}
                className="w-full inline-flex items-center justify-center rounded-xl border border-[#2C2530] bg-[#0B0B0D]/40 px-3 py-2 text-xs font-medium text-white/65 hover:bg-white/[0.06] transition"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** =========================
 *  Lista de auditorías (MÓVIL + DESKTOP)
 *  - Dropdown por auditoría
 *  - Dropdown por hallazgo
 *  - Search + filtros + leído/no leído (UX simplificado)
 *  ========================= */
function AuditHistoryUnified({
  docs,
  loading,
  error,
  onRetry,
  sourceKey,
  isMobile,
}: {
  docs: AuditDocVM[] | null;
  loading: boolean;
  error: any;
  onRetry?: () => void;
  sourceKey: "google" | "ga4" | "meta";
  isMobile: boolean;
}) {
  const storageKey = `adray_audit_read_${sourceKey}`;
  const { isRead, toggleRead, markManyRead, clearAll } = useReadStore(storageKey);

  const [q, setQ] = useState("");
  const [sev, setSev] = useState<"all" | SeverityNorm>("all");
  const [onlyUnread, setOnlyUnread] = useState(false);

  // Reset filtros cuando cambia fuente
  useEffect(() => {
    setQ("");
    setSev("all");
    setOnlyUnread(false);
  }, [sourceKey]);

  if (loading) {
    return (
      <div className="h-32 flex items-center justify-center text-[#9A8CA8] text-sm">
        Cargando...
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-32 flex items-center justify-center text-[#fda4af] text-sm text-center px-3">
        {String(error)} —{" "}
        {onRetry && (
          <button onClick={onRetry} className="ml-2 underline">
            Reintentar
          </button>
        )}
      </div>
    );
  }

  if (!docs || docs.length === 0) {
    return (
      <div className="h-32 flex items-center justify-center text-[#9A8CA8] text-sm">
        No hay auditorías por mostrar
      </div>
    );
  }

  const query = q.trim().toLowerCase();

  const computed = docs.map((doc, idx) => {
    const ts = (doc as any).generatedAt || (doc as any).createdAt;
    const dateLabel = ts ? new Date(ts).toLocaleString() : "Sin fecha";
    const summary = (doc as any).summary || (doc as any).resumen || "";

    const rawIssues = asArr<AuditIssueVM>(doc.issues);
    const issuesSource =
      rawIssues.length > 0 ? rawIssues : asArr<AuditIssueVM>((doc as any).actionCenter);

    const issues = issuesSource.map(mapIssue);

    const docId = String((doc as any)._id || `${sourceKey}-${idx}-${ts || "no-ts"}`);
    const auditIndex = idx + 1;

    const enriched = issues.map((it, i) => {
      const keyMaterial = [
        sourceKey,
        docId,
        it.title ?? "",
        it.description ?? "",
        it.recommendation ?? "",
        String(i),
      ].join("||");
      const issueKey = `${docId}::${djb2Hash(keyMaterial)}`;
      return {
        ...it,
        _issueKey: issueKey,
        _read: isRead(issueKey),
      };
    });

    const filtered = enriched.filter((it) => {
      if (sev !== "all" && (it.severity || "media") !== sev) return false;
      if (onlyUnread && it._read) return false;

      if (!query) return true;
      const blob = [
        safeLower(it.title),
        safeLower(it.description),
        safeLower(it.recommendation),
      ].join(" ");
      return blob.includes(query);
    });

    const allKeysFiltered = filtered.map((x) => x._issueKey);

    return {
      docId,
      auditIndex,
      dateLabel,
      summary,
      totalIssues: enriched.length,
      issues: filtered,
      keysFiltered: allKeysFiltered,
      hasAny: filtered.length > 0,
    };
  });

  const totalVisibleIssues = computed.reduce((acc, d) => acc + d.issues.length, 0);
  const totalAuditsVisible = computed.filter((d) => d.hasAny).length;

  const markVisibleRead = () => {
    const all = computed.flatMap((d) => d.keysFiltered);
    markManyRead(all);
  };

  const anyFilterOn = Boolean(query) || sev !== "all" || onlyUnread;

  const clearFilters = () => {
    setQ("");
    setSev("all");
    setOnlyUnread(false);
  };

  return (
    <div className="space-y-4">
      {/* Controls (UX simplificado) */}
      <div
        className={[
          "rounded-2xl border border-[#2C2530] bg-[#15121A]",
          isMobile ? "p-3" : "p-4",
        ].join(" ")}
      >
        <div className={isMobile ? "space-y-3" : "flex items-start gap-3"}>
          {/* Search */}
          <div className={isMobile ? "" : "flex-1"}>
            <div className="relative">
              <Search className="h-4 w-4 text-[#B55CFF] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Buscar hallazgos…"
                className={[
                  "w-full rounded-xl border bg-[#0B0B0D]/40",
                  "border-[#2C2530] text-white/90 placeholder:text-white/35",
                  "pl-10 pr-3 py-2 text-sm outline-none",
                  "focus:border-[#A96BFF]/60 focus:ring-2 focus:ring-[#A96BFF]/15",
                ].join(" ")}
              />
            </div>

            <div className="mt-2 text-[11px] text-white/45">
              Mostrando <span className="text-white/70">{totalVisibleIssues}</span> hallazgos en{" "}
              <span className="text-white/70">{totalAuditsVisible}</span> auditorías
              {anyFilterOn ? (
                <>
                  {" "}
                  <button
                    type="button"
                    onClick={clearFilters}
                    className="ml-2 underline text-white/60 hover:text-white/80"
                  >
                    limpiar
                  </button>
                </>
              ) : null}
            </div>
          </div>

          {/* One button: Filters dropdown (contains everything) */}
          <div className={isMobile ? "" : "shrink-0 pt-[2px]"}>
            <FiltersDropdown
              isMobile={isMobile}
              sev={sev}
              setSev={setSev}
              onlyUnread={onlyUnread}
              setOnlyUnread={setOnlyUnread}
              anyFilterOn={anyFilterOn}
              onClearFilters={clearFilters}
              onMarkVisibleRead={markVisibleRead}
              onResetRead={clearAll}
              totalVisibleIssues={totalVisibleIssues}
            />
          </div>
        </div>
      </div>

      {/* List */}
      <div className="space-y-3">
        <Accordion type="single" collapsible className="w-full space-y-2">
          {computed.map((d) => {
            // Si hay filtros activos, ocultamos auditorías vacías para no “ensuciar”
            if (anyFilterOn && !d.hasAny) return null;

            return (
              <AccordionItem
                key={d.docId}
                value={d.docId}
                className="border border-[#2C2530] rounded-2xl bg-[#17131c] px-3"
              >
                <AccordionTrigger className="py-3 hover:no-underline">
                  <div className="flex w-full flex-col gap-1 text-left">
                    <div className="text-[11px] text-[#6D5A80]">Auditoría #{d.auditIndex}</div>
                    <div className="text-sm font-semibold text-[#E5D3FF] leading-snug whitespace-normal break-words">
                      {d.dateLabel}
                    </div>
                    <div className="text-[11px] text-[#9A8CA8]">
                      {d.issues.length} / {d.totalIssues} hallazgos
                      {anyFilterOn ? <span className="ml-2 text-white/40">(filtrado)</span> : null}
                    </div>
                  </div>
                </AccordionTrigger>

                <AccordionContent className="pb-4">
                  {d.summary ? (
                    <div className="mb-3 rounded-xl border border-[#2C2530] bg-[#15121A] p-3">
                      <div className="text-[11px] font-semibold text-[#B55CFF] mb-1">Resumen</div>
                      <div className="text-xs text-[#9A8CA8] leading-relaxed break-words whitespace-normal">
                        <RichText text={d.summary} className="whitespace-pre-wrap" />
                      </div>
                    </div>
                  ) : null}

                  {d.issues.length ? (
                    <Accordion type="multiple" className="w-full space-y-2">
                      {d.issues.map((h, i) => {
                        const sevNorm = (h.severity || "media") as SeverityNorm;
                        const badge = sevBadgeClasses(sevNorm);
                        const label = sevLabel(sevNorm);
                        const issueId = `${d.docId}-issue-${i}-${(h as any)._issueKey}`;

                        const read = (h as any)._read as boolean;
                        const issueKey = (h as any)._issueKey as string;

                        return (
                          <AccordionItem
                            key={issueId}
                            value={issueId}
                            className={[
                              "border border-[#2C2530] rounded-2xl px-3",
                              read ? "bg-[#141018] opacity-[0.92]" : "bg-[#15121A]",
                            ].join(" ")}
                          >
                            <AccordionTrigger className="py-3 hover:no-underline">
                              <div className="flex w-full flex-col gap-2 text-left">
                                <div className="flex items-start gap-2">
                                  <Bot className="h-4 w-4 text-[#EB2CFF] mt-0.5 shrink-0" />
                                  <span className="text-sm font-semibold text-[#E5D3FF] leading-snug whitespace-normal break-words">
                                    {h.title || `Hallazgo ${i + 1}`}
                                  </span>
                                </div>

                                <div className="flex flex-wrap items-center gap-2">
                                  <span
                                    className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] ${badge}`}
                                  >
                                    {label}
                                  </span>

                                  {!!h.recommendation && (
                                    <span className="text-[11px] text-[#9A8CA8]">
                                      Incluye recomendación
                                    </span>
                                  )}

                                  <span className="ml-auto inline-flex items-center gap-2 text-[11px] text-white/55">
                                    {read ? (
                                      <>
                                        <CheckCircle2 className="h-4 w-4 text-[#B55CFF]" />
                                        Leído
                                      </>
                                    ) : (
                                      <>
                                        <Circle className="h-4 w-4 text-white/40" />
                                        No leído
                                      </>
                                    )}
                                  </span>
                                </div>
                              </div>
                            </AccordionTrigger>

                            <AccordionContent className="pb-4">
                              <div className="text-xs text-[#9A8CA8] leading-relaxed break-words whitespace-normal">
                                <RichText
                                  text={h.description || ""}
                                  className="whitespace-pre-wrap"
                                />
                              </div>

                              {h.recommendation ? (
                                <div className="mt-3 rounded-xl border border-[#2C2530] bg-[#0B0B0D]/40 p-3">
                                  <div className="text-[11px] font-semibold text-[#B55CFF]">
                                    Recomendación
                                  </div>
                                  <div className="mt-1 text-xs text-[#E5D3FF] leading-relaxed break-words whitespace-normal">
                                    <RichText
                                      text={h.recommendation}
                                      className="whitespace-pre-wrap"
                                    />
                                  </div>
                                </div>
                              ) : null}

                              <div className="mt-3 flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  onClick={() => toggleRead(issueKey)}
                                  className={[
                                    "inline-flex items-center rounded-xl border px-3 py-2 text-xs font-medium transition",
                                    read
                                      ? "border-white/10 bg-white/[0.04] text-white/70 hover:bg-white/[0.07]"
                                      : "border-[#A96BFF]/40 bg-[#A96BFF]/12 text-[#E5D3FF] hover:bg-[#A96BFF]/18",
                                  ].join(" ")}
                                >
                                  {read ? (
                                    <>
                                      <Circle className="h-4 w-4 mr-2" />
                                      Marcar como no leído
                                    </>
                                  ) : (
                                    <>
                                      <CheckCircle2 className="h-4 w-4 mr-2" />
                                      Marcar como leído
                                    </>
                                  )}
                                </button>
                              </div>
                            </AccordionContent>
                          </AccordionItem>
                        );
                      })}
                    </Accordion>
                  ) : (
                    <div className="h-20 flex items-center justify-center text-[#9A8CA8] text-sm">
                      No hay hallazgos por mostrar
                    </div>
                  )}
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      </div>
    </div>
  );
}

/** ========================= Componente ========================= */
const SiteAudit = () => {
  const isMobile = useIsMobileLike();

  // Sidebar desktop
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Hook central (lo seguimos dejando por compat, aunque el UI usa history)
  const { refresh } = useLatestAudits("all");

  // Historial por fuente
  const {
    data: googleHistory,
    loading: googleLoading,
    error: googleError,
    refresh: refreshGoogleHistory,
  } = useAuditHistory("google", 8);

  const {
    data: gaHistory,
    loading: gaLoading,
    error: gaError,
    refresh: refreshGaHistory,
  } = useAuditHistory("ga4", 8);

  const {
    data: metaHistory,
    loading: metaLoading,
    error: metaError,
    refresh: refreshMetaHistory,
  } = useAuditHistory("meta", 8);

  // Estado conexiones
  const {
    connections,
    loading: connLoading,
    error: connError,
    refresh: refreshConnections,
    rawStatus,
  } = useConnectionsStatus();

  const handleRefreshAll = () => {
    refresh();
    refreshGoogleHistory();
    refreshGaHistory();
    refreshMetaHistory();
    refreshConnections();
  };

  const isConnLoadingInitial = connLoading && !rawStatus;

  return (
    <div className="min-h-screen bg-[#0B0B0D] text-white font-['Inter'] overflow-x-hidden">
      {/* Sidebar solo md+ */}
      <div className="hidden md:block">
        <Sidebar isOpen={sidebarOpen} onToggle={() => setSidebarOpen((v) => !v)} />
      </div>

      {/* Content con margen SOLO en desktop */}
      <div
        className={`ml-0 transition-all duration-300 ${
          sidebarOpen ? "md:ml-64" : "md:ml-16"
        }`}
      >
        {/* Header */}
        <header className="px-4 py-4 md:p-6 border-b border-[#2C2530] bg-[#15121A]">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h1 className="text-xl md:text-2xl font-bold text-[#E5D3FF] mb-1">
                Informe de Auditoría del Sitio
              </h1>
              <p className="text-[#9A8CA8] text-sm">
                Hallazgos accionables con control de lectura, búsqueda y priorización por severidad
              </p>
            </div>

            <button
              onClick={handleRefreshAll}
              className="w-full md:w-auto px-3 py-2 text-sm rounded-md border border-[#2C2530] hover:border-[#A664FF] bg-[#0B0B0D] text-[#9A8CA8] transition-colors"
            >
              Actualizar
            </button>
          </div>
        </header>

        {/* Content */}
        <main className="px-4 py-5 md:p-6 pb-24 md:pb-6">
          <Tabs defaultValue="google-ads" className="w-full">
            {/* Tabs */}
            <TabsList className="flex md:grid md:grid-cols-3 w-full bg-transparent border-b border-[#2C2530] rounded-none h-auto p-0 overflow-x-auto">
              {tabsData.map((tab) => (
                <TabsTrigger
                  key={tab.id}
                  value={tab.id}
                  className="min-w-[140px] md:min-w-0 px-3 md:px-4 py-4 text-[11px] md:text-xs font-medium transition-all duration-200 rounded-none border-b-2 border-transparent hover:text-[#E5D3FF] data-[state=active]:border-[#EB2CFF] data-[state=active]:text-[#EB2CFF] data-[state=active]:bg-transparent bg-transparent text-[#9A8CA8] flex flex-col items-center gap-2"
                >
                  <tab.icon className="h-4 w-4" />
                  <span className="whitespace-nowrap">{tab.label}</span>
                </TabsTrigger>
              ))}
            </TabsList>

            <div className="mt-5 md:mt-6">
              {/* Google Ads */}
              <TabsContent value="google-ads" className="space-y-6">
                <Card className="bg-[#15121A] border-[#2C2530]">
                  <CardHeader>
                    <CardTitle className="text-[#E5D3FF] flex items-center gap-2">
                      <Target className="h-5 w-5 text-[#EB2CFF]" />
                      Auditoría de Google Ads
                    </CardTitle>
                    <CardDescription className="text-[#9A8CA8]">
                      Análisis del rendimiento de campañas publicitarias
                    </CardDescription>
                  </CardHeader>

                  <CardContent className="space-y-4">
                    {isConnLoadingInitial ? (
                      <div className="h-32 flex items-center justify-center text-[#9A8CA8] text-sm">
                        Cargando estado de conexión...
                      </div>
                    ) : connError ? (
                      <AuditHistoryUnified
                        docs={googleHistory}
                        loading={googleLoading}
                        error={googleError}
                        onRetry={refreshGoogleHistory}
                        sourceKey="google"
                        isMobile={isMobile}
                      />
                    ) : !connections.google ? (
                      <NotConnectedState appName="Google Ads" />
                    ) : (
                      <AuditHistoryUnified
                        docs={googleHistory}
                        loading={googleLoading}
                        error={googleError}
                        onRetry={refreshGoogleHistory}
                        sourceKey="google"
                        isMobile={isMobile}
                      />
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Google Analytics */}
              <TabsContent value="google-analytics" className="space-y-6">
                <Card className="bg-[#15121A] border-[#2C2530]">
                  <CardHeader>
                    <CardTitle className="text-[#E5D3FF] flex items-center gap-2">
                      <BarChart3 className="h-5 w-5 text-[#EB2CFF]" />
                      Auditoría de Google Analytics
                    </CardTitle>
                    <CardDescription className="text-[#9A8CA8]">
                      Análisis del comportamiento de usuarios y conversiones
                    </CardDescription>
                  </CardHeader>

                  <CardContent className="space-y-4">
                    {isConnLoadingInitial ? (
                      <div className="h-32 flex items-center justify-center text-[#9A8CA8] text-sm">
                        Cargando estado de conexión...
                      </div>
                    ) : connError ? (
                      <AuditHistoryUnified
                        docs={gaHistory}
                        loading={gaLoading}
                        error={gaError}
                        onRetry={refreshGaHistory}
                        sourceKey="ga4"
                        isMobile={isMobile}
                      />
                    ) : !connections.ga4 ? (
                      <NotConnectedState appName="Google Analytics" />
                    ) : (
                      <AuditHistoryUnified
                        docs={gaHistory}
                        loading={gaLoading}
                        error={gaError}
                        onRetry={refreshGaHistory}
                        sourceKey="ga4"
                        isMobile={isMobile}
                      />
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Meta Ads */}
              <TabsContent value="meta-ads" className="space-y-6">
                <Card className="bg-[#15121A] border-[#2C2530]">
                  <CardHeader>
                    <CardTitle className="text-[#E5D3FF] flex items-center gap-2">
                      <Users className="h-5 w-5 text-[#EB2CFF]" />
                      Auditoría de Meta Ads (Facebook/Instagram)
                    </CardTitle>
                    <CardDescription className="text-[#9A8CA8]">
                      Análisis del rendimiento en redes sociales
                    </CardDescription>
                  </CardHeader>

                  <CardContent className="space-y-4">
                    {isConnLoadingInitial ? (
                      <div className="h-32 flex items-center justify-center text-[#9A8CA8] text-sm">
                        Cargando estado de conexión...
                      </div>
                    ) : connError ? (
                      <AuditHistoryUnified
                        docs={metaHistory}
                        loading={metaLoading}
                        error={metaError}
                        onRetry={refreshMetaHistory}
                        sourceKey="meta"
                        isMobile={isMobile}
                      />
                    ) : !connections.meta ? (
                      <NotConnectedState appName="Meta Ads" />
                    ) : (
                      <AuditHistoryUnified
                        docs={metaHistory}
                        loading={metaLoading}
                        error={metaError}
                        onRetry={refreshMetaHistory}
                        sourceKey="meta"
                        isMobile={isMobile}
                      />
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            </div>
          </Tabs>
        </main>
      </div>

      {/* Mobile bottom nav (solo móvil) */}
      <div className="md:hidden">
        <MobileBottomNav />
      </div>
    </div>
  );
};

export default SiteAudit;
