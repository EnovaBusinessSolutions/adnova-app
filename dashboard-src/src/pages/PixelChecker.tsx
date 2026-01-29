// dashboard-src/src/pages/PixelChecker.tsx
import { useCallback, useMemo, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  Copy,
  ExternalLink,
  Link as LinkIcon,
  Search,
} from "lucide-react";

/* =========================
   Types (NEW API Pixel Auditor)
   ========================= */

type TrackingKey = "ga4" | "gtm" | "gads" | "meta" | string;

type TrackingItem = {
  key: TrackingKey;
  label: string;
  installed: boolean;
  ids?: string[];
};

type PixelAuditNormalized = {
  auditedUrl: string;
  healthScore: number;
  healthLabel?: string;
  tracking: TrackingItem[];
  recommendations?: string[];
  issuesCount?: number;
  eventsCount?: number;
  raw?: any; // solo si includeDetails = true
};

/* =========================
   Small helpers
   ========================= */

function normalizeUrl(input: string) {
  const raw = (input || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://${raw}`;
}

function isLikelyUrl(input: string) {
  const v = normalizeUrl(input);
  try {
    const u = new URL(v);
    return !!u.hostname && (u.protocol === "http:" || u.protocol === "https:");
  } catch {
    return false;
  }
}

function copyText(text: string) {
  try {
    navigator.clipboard?.writeText(text);
  } catch {
    // ignore
  }
}

function tinyIdList(ids?: string[]) {
  const clean = (ids || []).filter(Boolean);
  if (!clean.length) return "—";
  if (clean.length <= 2) return clean.join(", ");
  return `${clean[0]}, ${clean[1]} +${clean.length - 2}`;
}

function toneClasses(tone: "success" | "good" | "warn" | "bad" | "muted") {
  switch (tone) {
    case "success":
      return "bg-emerald-500/10 text-emerald-300 border-emerald-500/20";
    case "good":
      return "bg-sky-500/10 text-sky-300 border-sky-500/20";
    case "warn":
      return "bg-amber-500/10 text-amber-300 border-amber-500/20";
    case "bad":
      return "bg-rose-500/10 text-rose-300 border-rose-500/20";
    default:
      return "bg-white/5 text-white/70 border-white/10";
  }
}

function scoreTone(score: number): "success" | "good" | "warn" | "bad" {
  const s = Math.max(0, Math.min(100, Number.isFinite(score) ? score : 0));
  if (s >= 90) return "success";
  if (s >= 70) return "good";
  if (s >= 50) return "warn";
  return "bad";
}

function scoreLabel(score: number) {
  const s = Math.max(0, Math.min(100, Number.isFinite(score) ? score : 0));
  if (s >= 90) return "Excelente";
  if (s >= 70) return "Bueno";
  if (s >= 50) return "Regular";
  return "Crítico";
}

function GlowCard(props: React.ComponentProps<typeof Card>) {
  const { className = "", ...rest } = props;
  return (
    <Card
      className={[
        "glass-effect border-[#2C2530] bg-[#0F1012] shadow-[0_0_0_1px_rgba(255,255,255,0.03)_inset]",
        className,
      ].join(" ")}
      {...rest}
    />
  );
}

function InlineAlert({
  tone = "bad",
  title,
  desc,
}: {
  tone?: "bad" | "warn" | "good";
  title: string;
  desc?: string;
}) {
  const icon =
    tone === "good" ? (
      <CheckCircle2 className="h-4 w-4 text-emerald-300" />
    ) : tone === "warn" ? (
      <AlertTriangle className="h-4 w-4 text-amber-300" />
    ) : (
      <AlertTriangle className="h-4 w-4 text-rose-300" />
    );

  const cls =
    tone === "good"
      ? "border-emerald-500/20 bg-emerald-500/10"
      : tone === "warn"
      ? "border-amber-500/20 bg-amber-500/10"
      : "border-rose-500/20 bg-rose-500/10";

  return (
    <div className={["rounded-xl border p-3", cls].join(" ")}>
      <div className="flex items-start gap-2">
        {icon}
        <div className="min-w-0">
          <div className="text-sm font-semibold text-white/90">{title}</div>
          {desc ? <div className="text-xs text-white/70 mt-0.5">{desc}</div> : null}
        </div>
      </div>
    </div>
  );
}

/* =========================
   Install guides (dropdown)
   ========================= */

type Guide = {
  title: string;
  desc: string;
  steps: string[];
  docUrl?: string;
  extraTip?: string;
};

const GUIDES: Record<string, Guide> = {
  ga4: {
    title: "Cómo instalar Google Analytics 4 (GA4)",
    desc: "GA4 es la base para medir visitas, comportamiento y conversiones.",
    steps: [
      "Entra a Google Analytics → Admin → (Propiedad) → Data Streams (Web) → copia tu Measurement ID (G-XXXXXXX).",
      "Instálalo con Google Tag Manager (recomendado) o pegando el script de GA4 en el <head> de tu sitio.",
      "Verifica con Tag Assistant o revisa Realtime en GA4 para confirmar que llegan eventos.",
    ],
    docUrl: "https://support.google.com/analytics/answer/9304153",
    extraTip: "Tip: si tu sitio es Shopify, lo ideal es GA4 vía GTM o Web Pixels (según el setup).",
  },
  gtm: {
    title: "Cómo instalar Google Tag Manager (GTM)",
    desc: "GTM te permite administrar etiquetas sin tocar el código en cada cambio.",
    steps: [
      "Crea un contenedor en Google Tag Manager y copia el Container ID (GTM-XXXXXXX).",
      "Pega el snippet de GTM en tu sitio: una parte en <head> y otra justo después de <body>.",
      "Desde GTM, agrega tags (GA4, Google Ads, Meta vía custom HTML/CAPI, etc.) y publica el contenedor.",
    ],
    docUrl: "https://support.google.com/tagmanager/answer/6103696",
    extraTip: "Tip: GTM suele ser el “hub” ideal para todo el tracking.",
  },
  gads: {
    title: "Cómo instalar Google Ads (Conversiones/Remarketing)",
    desc: "Sirve para medir conversiones reales y remarketing en campañas.",
    steps: [
      "En Google Ads → Tools & Settings → Conversions, crea/elige tu acción de conversión.",
      "Copia el Conversion ID y Conversion Label (o usa el tag de Google).",
      "Instálalo con GTM (recomendado) configurando el tag de Google Ads Conversion Tracking y su trigger (Purchase/Lead).",
    ],
    docUrl: "https://support.google.com/google-ads/answer/6095821",
    extraTip: "Tip: mide conversiones en la página de “gracias” o evento de compra/leads.",
  },
  meta: {
    title: "Cómo instalar Meta Pixel",
    desc: "Necesario para medir conversiones en Meta Ads y hacer remarketing.",
    steps: [
      "En Meta Events Manager → Data Sources → selecciona tu Pixel → copia el Pixel ID.",
      "Instala el Pixel con GTM (Custom HTML) o con la integración nativa (Shopify/WooCommerce/etc.).",
      "Verifica con Meta Pixel Helper y prueba eventos clave (ViewContent, AddToCart, Purchase/Lead).",
    ],
    docUrl: "https://www.facebook.com/business/help/952192354843755",
    extraTip: "Tip: si tienes e-commerce, prueba en checkout/thank-you para ver Purchase.",
  },
};

function InstallDropdown({ guideKey }: { guideKey: string }) {
  const g = GUIDES[guideKey];
  if (!g) return null;

  return (
    <details className="group rounded-xl border border-white/10 bg-white/[0.02] p-3">
      <summary className="cursor-pointer list-none flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-white/90">{g.title}</div>
          <div className="text-xs text-white/55 mt-0.5">{g.desc}</div>
        </div>
        <div className="text-xs text-white/50 group-open:text-white/70">Ver guía</div>
      </summary>

      <div className="mt-3">
        <ol className="space-y-2 text-xs text-white/75 list-decimal pl-5">
          {g.steps.map((s, i) => (
            <li key={i} className="leading-relaxed">
              {s}
            </li>
          ))}
        </ol>

        {g.extraTip ? (
          <div className="mt-3 text-xs text-white/60">
            <span className="text-white/50">Tip:</span> {g.extraTip}
          </div>
        ) : null}

        {g.docUrl ? (
          <div className="mt-3">
            <a
              href={g.docUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 text-xs text-[#B55CFF] hover:underline"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Abrir documentación oficial
            </a>
          </div>
        ) : null}
      </div>
    </details>
  );
}

/* =========================
   BIG Score (hero)
   ========================= */

function BigScorePanel({ score }: { score: number }) {
  const clamped = Math.max(0, Math.min(100, Number.isFinite(score) ? score : 0));
  const tone = scoreTone(clamped);
  const label = scoreLabel(clamped);

  return (
    <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-[#0B0B0D] via-[#140B18] to-[#0B0B0D] p-7 md:p-10">
      <div className="flex flex-col items-center text-center gap-3">
        <div className="text-xs md:text-sm text-white/55">Health Score</div>

        <div className="text-6xl md:text-7xl font-extrabold text-white tracking-tight leading-none">
          {clamped}
        </div>

        <Badge
          variant="outline"
          className={["border px-3 py-1", toneClasses(tone)].join(" ")}
        >
          {label}
        </Badge>

        <p className="mt-1 text-sm md:text-base text-white/75 max-w-2xl">
          Mientras más alto, más consistente está tu medición (scripts + IDs básicos).
        </p>

        <div className="w-full max-w-2xl mt-4">
          <div className="h-2.5 rounded-full bg-white/10 overflow-hidden">
            <div
              className="h-full bg-[#EB2CFF]"
              style={{ width: `${clamped}%` }}
            />
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px] text-white/45">
            <span>Crítico</span>
            <span>Regular</span>
            <span>Bueno</span>
            <span>Excelente</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* =========================
   Tracking card
   ========================= */

function trackingGuideKey(key: string) {
  if (key === "ga4") return "ga4";
  if (key === "gtm") return "gtm";
  if (key === "gads") return "gads";
  if (key === "meta") return "meta";
  return "";
}

function TrackingRow({ item }: { item: TrackingItem }) {
  const installed = !!item.installed;
  const guideKey = trackingGuideKey(item.key);

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-white/90">{item.label}</div>
          <div className="text-xs text-white/55 mt-0.5">
            IDs detectados: <span className="text-white/75">{tinyIdList(item.ids)}</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Badge
            variant="outline"
            className={[
              "border",
              installed ? toneClasses("success") : toneClasses("warn"),
            ].join(" ")}
          >
            {installed ? "Instalado" : "No instalado"}
          </Badge>

          {installed ? (
            <CheckCircle2 className="h-4 w-4 text-emerald-300" />
          ) : (
            <AlertTriangle className="h-4 w-4 text-amber-300" />
          )}
        </div>
      </div>

      {/* Dropdown guía: solo si falta */}
      {!installed && guideKey ? (
        <div className="mt-3">
          <InstallDropdown guideKey={guideKey} />
        </div>
      ) : null}
    </div>
  );
}

/* =========================
   Main Page
   ========================= */

export default function PixelChecker() {
  const [urlInput, setUrlInput] = useState("");
  const [includeDetails, setIncludeDetails] = useState(false); // por defecto simple
  const [loading, setLoading] = useState(false);

  const [data, setData] = useState<PixelAuditNormalized | null>(null);
  const [error, setError] = useState<string | null>(null);

  const normalizedUrl = useMemo(() => normalizeUrl(urlInput), [urlInput]);

  const runAudit = useCallback(async () => {
    setError(null);
    setData(null);

    if (!isLikelyUrl(urlInput)) {
      setError("Pon una URL válida. Ejemplo: https://tusitio.com");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/auditor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ url: normalizedUrl, includeDetails }),
      });

      const text = await res.text();
      let json: any = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }

      if (!json) {
        setError(!res.ok ? `Error ${res.status}: el backend no devolvió JSON.` : "El backend no devolvió JSON.");
        return;
      }

      if (!res.ok || json.ok === false) {
        setError(json?.error || json?.details || `Error HTTP ${res.status}`);
        return;
      }

      const payload: PixelAuditNormalized = (json?.data ?? json) as PixelAuditNormalized;
      setData(payload);
    } catch (e: any) {
      setError(e?.message || "Error ejecutando auditoría.");
    } finally {
      setLoading(false);
    }
  }, [urlInput, normalizedUrl, includeDetails]);

  const score = data?.healthScore ?? 0;
  const tracking = Array.isArray(data?.tracking) ? data!.tracking : [];

  return (
    <DashboardLayout>
      <div className="min-h-screen bg-[#0B0B0D]">
        <div className="mx-auto p-6 space-y-6 max-w-6xl">
          {/* Header */}
          <div className="mb-1">
            <h1 className="text-2xl font-bold text-white">Auditor de Píxeles</h1>
            <p className="text-sm text-white/60">
              Coloca tu URL, inicia la auditoría y recibe un Health Score + qué tracking falta y cómo instalarlo.
            </p>
          </div>

          {/* Simple command bar */}
          <GlowCard>
            <CardContent className="p-4">
              <div className="flex flex-col md:flex-row md:items-center gap-3">
                <div className="flex-1">
                  <div className="relative">
                    <LinkIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40" />
                    <Input
                      value={urlInput}
                      onChange={(e) => setUrlInput(e.target.value)}
                      placeholder="https://tusitio.com"
                      className="pl-9 bg-[#0B0B0D] border-white/10 text-white placeholder:text-white/40"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") runAudit();
                      }}
                    />
                  </div>

                  <div className="mt-2 text-xs text-white/50">
                    Tip: prueba también la página de “gracias” o checkout para validar eventos de compra/leads.
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  {/* Toggle (modo avanzado) - se queda */}
                  <div className="hidden lg:flex items-center gap-2">
                    <Switch checked={includeDetails} onCheckedChange={setIncludeDetails} />
                    <div className="leading-tight">
                      <div className="text-xs font-semibold text-white/80">Modo avanzado</div>
                      <div className="text-[11px] text-white/40">Incluye raw para debug</div>
                    </div>
                  </div>

                  <Button
                    onClick={runAudit}
                    disabled={loading}
                    className="bg-[#a464f2] hover:bg-[#9356e6] text-white font-semibold"
                  >
                    {loading ? (
                      <>
                        <CircleDashed className="h-4 w-4 mr-2 animate-spin" />
                        Auditando…
                      </>
                    ) : (
                      <>
                        <Search className="h-4 w-4 mr-2" />
                        Iniciar auditoría
                      </>
                    )}
                  </Button>
                </div>
              </div>

              {error ? (
                <div className="mt-4">
                  <InlineAlert title="No se pudo ejecutar la auditoría" desc={error} />
                </div>
              ) : null}
            </CardContent>
          </GlowCard>

          {/* Empty state */}
          {!loading && !data ? (
            <GlowCard>
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-semibold text-white/90">¿Qué vas a ver aquí?</CardTitle>
              </CardHeader>
              <CardContent className="pt-2 space-y-3">
                <div className="text-sm text-white/70">
                  1) Health Score de tracking <br />
                  2) Qué etiquetas están instaladas (GA4, GTM, Meta Pixel, Google Ads) <br />
                  3) Para lo que falte: un dropdown con pasos claros para instalarlo
                </div>

                <Separator className="bg-white/10" />

                <div className="text-xs text-white/55">
                  Consejo rápido: si no detecta nada, prueba sin AdBlock/Brave Shields y valida otra ruta (checkout/thank-you).
                </div>
              </CardContent>
            </GlowCard>
          ) : null}

          {/* Loading */}
          {loading ? (
            <GlowCard>
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <CircleDashed className="h-4 w-4 text-[#EB2CFF] animate-spin" />
                  <CardTitle className="text-base font-semibold text-white/90">Ejecutando auditoría…</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="pt-2">
                <div className="text-xs text-white/50">
                  Escaneando scripts e IDs… (esto puede variar según el sitio y bloqueadores).
                </div>
              </CardContent>
            </GlowCard>
          ) : null}

          {/* Results */}
          {data ? (
            <div className="space-y-4">
              <GlowCard>
                <CardHeader className="pb-2">
                  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                    <div className="min-w-0">
                      <CardTitle className="text-base font-semibold text-white/90">Resultado</CardTitle>
                      <div className="text-xs text-white/50 mt-1">
                        URL auditada: <span className="text-white/80">{data.auditedUrl || normalizedUrl}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className={["border", toneClasses("muted")].join(" ")}>
                        Issues: <span className="ml-1 text-white">{data.issuesCount ?? 0}</span>
                      </Badge>
                      <Badge variant="outline" className={["border", toneClasses("muted")].join(" ")}>
                        Events: <span className="ml-1 text-white">{data.eventsCount ?? 0}</span>
                      </Badge>
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="pt-2 space-y-4">
                  {/* BIG Health Score */}
                  <BigScorePanel score={score} />

                  {/* Tracking detected */}
                  <div className="space-y-3">
                    <div className="text-sm font-semibold text-white/90">Tracking detectado</div>
                    <div className="text-xs text-white/50 -mt-2">
                      Aquí está el estado de cada etiqueta. Si falta alguna, abre el dropdown para ver cómo instalarla.
                    </div>

                    {tracking.length ? (
                      <div className="space-y-3">
                        {tracking.map((t, idx) => (
                          <TrackingRow key={`${t.key}-${idx}`} item={t} />
                        ))}
                      </div>
                    ) : (
                      <InlineAlert
                        tone="warn"
                        title="No se detectaron etiquetas"
                        desc="Puede ser por bloqueadores, CSP o porque el tracking se carga dinámicamente. Prueba sin AdBlock/Brave Shields."
                      />
                    )}
                  </div>

                  {/* Recommendations */}
                  <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
                    <div className="text-sm font-semibold text-white/90">Recomendaciones</div>
                    <div className="mt-2 space-y-2">
                      {(data.recommendations || []).length ? (
                        (data.recommendations || []).slice(0, 6).map((r, i) => (
                          <div
                            key={i}
                            className="flex items-start gap-2 rounded-lg border border-white/10 bg-white/[0.03] p-2"
                          >
                            <span className="mt-1 w-1.5 h-1.5 rounded-full bg-[#EB2CFF]" />
                            <div className="text-xs text-white/80">{r}</div>
                          </div>
                        ))
                      ) : (
                        <div className="text-xs text-white/50">Sin recomendaciones adicionales. 🎯</div>
                      )}
                    </div>
                  </div>

                  {/* Advanced raw */}
                  {includeDetails && data.raw ? (
                    <details className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
                      <summary className="cursor-pointer list-none flex items-center justify-between">
                        <div className="text-sm font-semibold text-white/90">Debug (raw)</div>
                        <div className="text-xs text-white/50">Ver JSON</div>
                      </summary>
                      <div className="mt-3">
                        <div className="flex justify-end">
                          <Button
                            variant="outline"
                            className="border-white/10 text-white/80 hover:bg-white/5"
                            onClick={() => copyText(JSON.stringify(data.raw, null, 2))}
                          >
                            <Copy className="h-4 w-4 mr-2" />
                            Copiar JSON
                          </Button>
                        </div>
                        <pre className="mt-3 text-xs overflow-auto rounded-lg bg-white/[0.03] border border-white/10 p-3 text-white/80">
                          {JSON.stringify(data.raw, null, 2)}
                        </pre>
                      </div>
                    </details>
                  ) : null}

                  <div className="text-xs text-white/50">
                    Si un sitio usa Shopify/Apps, algunas etiquetas se inyectan de forma dinámica. Si dudas, prueba también
                    con la URL de checkout/thank-you y desactiva AdBlock.
                  </div>
                </CardContent>
              </GlowCard>
            </div>
          ) : null}
        </div>
      </div>
    </DashboardLayout>
  );
}
