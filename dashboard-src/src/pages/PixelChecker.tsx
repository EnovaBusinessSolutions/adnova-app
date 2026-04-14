// dashboard-src/src/pages/PixelChecker.tsx
import { useCallback, useEffect, useMemo, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

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

  issues?: any[];
  events?: any[];

  raw?: any; // solo si includeDetails = true
};

/* =========================
   Small helpers
   ========================= */

type AnyObj = Record<string, any>;

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
   Issues / Events helpers (German-like)
   ========================= */

function toStr(v: any) {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

function normalizeArray(x: any) {
  if (!x) return [];
  if (Array.isArray(x)) return x;
  if (typeof x === "object") {
    if (Array.isArray(x.items)) return x.items;
    if (Array.isArray(x.list)) return x.list;
  }
  return [];
}

function pick(obj: any, keys: string[], fallback: any = "") {
  for (const k of keys) {
    const v = obj?.[k];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return fallback;
}

function normalizeIssue(x: any) {
  if (!x) {
    return {
      severity: "warning",
      title: "Problema detectado",
      description: "",
      impact: "",
      solution: "",
      docsUrl: "",
    };
  }
  if (typeof x === "string") {
    return { severity: "warning", title: x, description: "", impact: "", solution: "", docsUrl: "" };
  }

  const sevRaw = toStr(pick(x, ["severity", "level", "type"], "warning")).toLowerCase();
  const severity =
    sevRaw.includes("crit") || sevRaw === "error"
      ? "critical"
      : sevRaw.includes("info")
      ? "info"
      : "warning";

  const title = toStr(pick(x, ["title", "name", "code", "id"], "Problema detectado"));
  const description = toStr(pick(x, ["description", "message", "details", "what"], ""));
  const impact = toStr(pick(x, ["impact", "why", "risk"], ""));
  const solution = pick(x, ["solution", "fix", "howToFix", "recommendation"], "");
  const docsUrl = toStr(pick(x, ["docsUrl", "docUrl", "documentation", "url", "learnMoreUrl"], ""));

  return {
    severity,
    title,
    description,
    impact,
    solution: typeof solution === "string" ? solution : JSON.stringify(solution),
    docsUrl,
  };
}

function normalizeEvent(x: any) {
  if (!x) return { type: "Evento", name: "Evento", params: {} as AnyObj, source: "" };
  if (typeof x === "string") return { type: "Evento", name: x, params: {} as AnyObj, source: "" };

  return {
    type: toStr(pick(x, ["type", "platform", "provider"], "Evento")),
    name: toStr(pick(x, ["name", "event", "eventName"], "Evento")),
    params: (pick(x, ["params", "parameters", "data", "payload"], {}) as AnyObj) || {},
    source: toStr(pick(x, ["source", "from", "detectedIn"], "")),
  };
}

function issueBadge(sev: string) {
  if (sev === "critical") return { label: "Crítico", cls: "bg-rose-500/10 text-rose-200 border-rose-500/20" };
  if (sev === "info") return { label: "Info", cls: "bg-sky-500/10 text-sky-200 border-sky-500/20" };
  return { label: "Advertencia", cls: "bg-amber-500/10 text-amber-200 border-amber-500/20" };
}

/* =========================
   Friendly events (NO JSON fear)
   ========================= */

const META_EVENT_CATALOG: Record<
  string,
  { label: string; desc: string; bestPractice?: string }
> = {
  PageView: {
    label: "Visita a página",
    desc: "Alguien cargó una página de tu sitio.",
    bestPractice: "Debe disparar en todas las páginas.",
  },
  ViewContent: {
    label: "Vio un producto/contenido",
    desc: "Un usuario vio una página de producto o contenido.",
    bestPractice: "Incluye content_ids y content_type cuando sea posible.",
  },
  Search: {
    label: "Búsqueda",
    desc: "Un usuario hizo una búsqueda dentro del sitio.",
    bestPractice: "Incluye search_string para análisis de intención.",
  },
  AddToCart: {
    label: "Agregó al carrito",
    desc: "Un usuario agregó un producto al carrito.",
    bestPractice: "Incluye value y currency (y content_ids si aplica).",
  },
  InitiateCheckout: {
    label: "Inició checkout",
    desc: "Un usuario empezó el proceso de pago.",
    bestPractice: "Excelente para remarketing de abandono.",
  },
  AddPaymentInfo: {
    label: "Agregó método de pago",
    desc: "Un usuario ingresó datos de pago.",
    bestPractice: "Útil para optimización de conversiones.",
  },
  Purchase: {
    label: "Compra",
    desc: "Se detectó una compra / conversión final.",
    bestPractice: "Incluye value y currency. Idealmente incluye order_id.",
  },
  Lead: {
    label: "Lead",
    desc: "Un usuario envió un formulario / conversión de lead.",
    bestPractice: "Asegura deduplicación si usas CAPI.",
  },
  CompleteRegistration: {
    label: "Registro completado",
    desc: "Un usuario terminó un registro.",
  },
  Subscribe: {
    label: "Suscripción",
    desc: "Un usuario se suscribió (newsletter/plan).",
  },
};

function humanizePlatform(type: string) {
  const t = (type || "").toLowerCase();
  if (t.includes("meta")) return "Meta Pixel";
  if (t.includes("ga4") || t.includes("analytics")) return "Google Analytics";
  if (t.includes("gtm") || t.includes("tag manager")) return "Google Tag Manager";
  if (t.includes("gads") || t.includes("ads")) return "Google Ads";
  return type || "Evento";
}

function cleanMaybeJson(v: any) {
  if (v == null) return v;

  if (typeof v === "string") {
    const s = v.trim();

    // Unescape common sequences like \" seen in some collectors
    const unescaped = s.includes('\\"') ? s.replace(/\\"/g, '"') : s;

    // Try to parse JSON if it looks like it
    if (
      (unescaped.startsWith("{") && unescaped.endsWith("}")) ||
      (unescaped.startsWith("[") && unescaped.endsWith("]"))
    ) {
      try {
        return JSON.parse(unescaped);
      } catch {
        return unescaped;
      }
    }

    return unescaped;
  }

  return v;
}

function safeNum(v: any) {
  const x = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(x) ? x : null;
}

function toList(v: any): string[] {
  const c = cleanMaybeJson(v);
  if (!c) return [];
  if (Array.isArray(c)) return c.map((x) => toStr(x)).filter(Boolean);
  if (typeof c === "string") return c ? [c] : [];
  return [];
}

function formatCurrency(value: any, currency: any) {
  const n = safeNum(cleanMaybeJson(value));
  const c = toStr(cleanMaybeJson(currency)).toUpperCase();
  if (n == null) return null;
  if (!c) return `${n}`;
  try {
    return new Intl.NumberFormat("es-MX", { style: "currency", currency: c }).format(n);
  } catch {
    return `${n} ${c}`;
  }
}

function extractEventHighlights(params: AnyObj) {
  const p = (params || {}) as AnyObj;

  const value = pick(p, ["value", "revenue", "amount", "price"], null);
  const currency = pick(p, ["currency"], null);
  const prettyMoney = formatCurrency(value, currency);

  const contentIds = toList(pick(p, ["content_ids", "contentIds", "product_ids", "productIds", "item_ids", "items"], []));
  const contentType = toStr(cleanMaybeJson(pick(p, ["content_type", "contentType"], "")));
  const searchString = toStr(cleanMaybeJson(pick(p, ["search_string", "searchString", "query", "q"], "")));
  const numItems = safeNum(cleanMaybeJson(pick(p, ["num_items", "numItems", "quantity", "qty"], null)));
  const orderId = toStr(cleanMaybeJson(pick(p, ["order_id", "orderId", "transaction_id", "transactionId"], "")));
  const eventId = toStr(cleanMaybeJson(pick(p, ["eventID", "event_id", "eventId"], "")));

  const chips: { label: string; value: string }[] = [];

  if (prettyMoney) chips.push({ label: "Valor", value: prettyMoney });
  if (currency && !prettyMoney) chips.push({ label: "Moneda", value: toStr(currency).toUpperCase() });

  if (searchString) chips.push({ label: "Búsqueda", value: searchString });

  if (Number.isFinite(numItems as any) && numItems !== null) chips.push({ label: "Cantidad", value: String(numItems) });

  if (contentType) chips.push({ label: "Tipo", value: contentType });

  if (contentIds.length) {
    const show = contentIds.slice(0, 3);
    const rest = contentIds.length - show.length;
    chips.push({
      label: "Productos",
      value: rest > 0 ? `${show.join(", ")} +${rest}` : show.join(", "),
    });
  }

  if (orderId) chips.push({ label: "Orden", value: orderId });
  if (eventId) chips.push({ label: "Event ID", value: eventId });

  // warnings (best-practice hints)
  const hints: string[] = [];
  const hasPurchaseLike = ["Purchase", "AddToCart", "InitiateCheckout"].some((k) => String(pick(p, ["event_name", "eventName"], "")).includes(k));
  if (!hasPurchaseLike) {
    // no-op; we don't know actual name here
  }

  // Generic: if money-like event but missing currency/value
  // We'll decide this in renderer using event name; still keep basic hints here:
  if (value != null && !currency) hints.push("Se detectó un valor, pero no viene moneda (currency).");
  if (currency && value == null) hints.push("Se detectó moneda, pero no viene valor (value).");

  return { chips, hints };
}

function friendlyEventTitle(evType: string, evName: string) {
  const platform = humanizePlatform(evType);
  const name = evName || "Evento";

  if (platform === "Meta Pixel") {
    const meta = META_EVENT_CATALOG[name];
    if (meta) return meta.label;
  }

  // Title-case-ish fallback
  return name;
}

function friendlyEventDesc(evType: string, evName: string) {
  const platform = humanizePlatform(evType);
  const name = evName || "Evento";

  if (platform === "Meta Pixel") {
    const meta = META_EVENT_CATALOG[name];
    if (meta) return meta.desc;
    return "Evento detectado desde Meta Pixel.";
  }

  if (platform === "Google Analytics") return "Evento detectado desde Google Analytics (GA4).";
  if (platform === "Google Tag Manager") return "Evento detectado/emitido por Google Tag Manager.";
  if (platform === "Google Ads") return "Evento relacionado a medición de Google Ads.";
  return "Evento detectado en tu sitio.";
}

function isCustomEvent(evType: string, evName: string) {
  const platform = humanizePlatform(evType);
  if (platform !== "Meta Pixel") return false;
  return !META_EVENT_CATALOG[evName];
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

        <Badge variant="outline" className={["border px-3 py-1", toneClasses(tone)].join(" ")}>
          {label}
        </Badge>

        <p className="mt-1 text-sm md:text-base text-white/75 max-w-2xl">
          Mientras más alto, más consistente está tu medición (scripts + IDs básicos).
        </p>

        <div className="w-full max-w-2xl mt-4">
          <div className="h-2.5 rounded-full bg-white/10 overflow-hidden">
            <div className="h-full bg-[#EB2CFF]" style={{ width: `${clamped}%` }} />
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
            className={["border", installed ? toneClasses("success") : toneClasses("warn")].join(" ")}
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

      {!installed && guideKey ? (
        <div className="mt-3">
          <InstallDropdown guideKey={guideKey} />
        </div>
      ) : null}
    </div>
  );
}

/* =========================
   E2E: Getting Started flags (SCOPED + LEGACY + SAME TAB EVENT)
   ========================= */

function safeLSSet(key: string, val: string) {
  try {
    localStorage.setItem(key, val);
  } catch {}
}

function safeSSGet(key: string) {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}
function safeSSSet(key: string, val: string) {
  try {
    sessionStorage.setItem(key, val);
  } catch {}
}
function safeSSRemove(key: string) {
  try {
    sessionStorage.removeItem(key);
  } catch {}
}

async function fetchUserKeyNow(): Promise<string | null> {
  try {
    const r = await fetch("/api/me", {
      credentials: "include",
      headers: { Accept: "application/json" },
    });

    if (!r.ok) return null;

    const j = await r.json().catch(() => ({}));
    const payload = (j?.data ?? j) as any;

    const u = payload?.user ?? payload;
    const k =
      (u?._id && String(u._id)) ||
      (u?.id && String(u.id)) ||
      (u?.email && String(u.email)) ||
      null;

    return k;
  } catch {
    return null;
  }
}

function scopedKey(userKey: string, rawKey: string) {
  return `adray:${String(userKey)}:${rawKey}`;
}

function markPixelAuditDone(userKey: string | null, auditedUrl?: string) {
  try {
    const now = Date.now();

    if (userKey) {
      const u = String(userKey);
      safeLSSet(scopedKey(u, "pixel_audit_done"), "1");
      safeLSSet(scopedKey(u, "pixel_audit_done_at"), String(now));
      if (auditedUrl) safeLSSet(scopedKey(u, "pixel_audit_last_url"), String(auditedUrl));
    }

    safeLSSet("adray_pixel_audit_done", "1");
    safeLSSet("adray_pixel_audit_done_at", String(now));
    if (auditedUrl) safeLSSet("adray_pixel_audit_last_url", String(auditedUrl));

    window.dispatchEvent(
      new CustomEvent("adray:gs-flags-updated", {
        detail: { kind: "pixel_audit_done", userKey: userKey || null, auditedUrl: auditedUrl || null },
      })
    );
  } catch {
    // ignore
  }
}

const PENDING_PIXEL_DONE = "adray:pending:pixel_audit_done";
const PENDING_PIXEL_URL = "adray:pending:pixel_audit_last_url";

/* =========================
   Main Page
   ========================= */

export default function PixelChecker() {
  const [urlInput, setUrlInput] = useState("");
  const [includeDetails, setIncludeDetails] = useState(false);
  const [loading, setLoading] = useState(false);

  const [data, setData] = useState<PixelAuditNormalized | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [userKey, setUserKey] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    (async () => {
      const k = await fetchUserKeyNow();
      if (!alive) return;
      setUserKey(k);
    })();

    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!userKey) return;

    const pending = safeSSGet(PENDING_PIXEL_DONE);
    if (pending !== "1") return;

    const pendingUrl = safeSSGet(PENDING_PIXEL_URL) || undefined;

    markPixelAuditDone(userKey, pendingUrl);

    safeSSRemove(PENDING_PIXEL_DONE);
    safeSSRemove(PENDING_PIXEL_URL);
  }, [userKey]);

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

      const audited = payload?.auditedUrl || normalizedUrl;

      if (userKey) {
        markPixelAuditDone(userKey, audited);
      } else {
        markPixelAuditDone(null, audited);

        safeSSSet(PENDING_PIXEL_DONE, "1");
        if (audited) safeSSSet(PENDING_PIXEL_URL, audited);

        const k = await fetchUserKeyNow();
        if (k) setUserKey(k);
      }
    } catch (e: any) {
      setError(e?.message || "Error ejecutando auditoría.");
    } finally {
      setLoading(false);
    }
  }, [urlInput, normalizedUrl, includeDetails, userKey]);

  const score = data?.healthScore ?? 0;
  const tracking = Array.isArray(data?.tracking) ? data!.tracking : [];

  const issues = useMemo(() => normalizeArray(data?.issues).map(normalizeIssue), [data]);
  const events = useMemo(() => normalizeArray(data?.events).map(normalizeEvent), [data]);

  const issuesCount = data?.issuesCount ?? issues.length ?? 0;
  const eventsCount = data?.eventsCount ?? events.length ?? 0;

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
                  {/* Toggle (modo avanzado) */}
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
                        Issues: <span className="ml-1 text-white">{issuesCount}</span>
                      </Badge>
                      <Badge variant="outline" className={["border", toneClasses("muted")].join(" ")}>
                        Events: <span className="ml-1 text-white">{eventsCount}</span>
                      </Badge>
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="pt-2 space-y-4">
                  <BigScorePanel score={score} />

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

                  {/* =========================
                      Problemas detectados
                     ========================= */}
                  <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-semibold text-white/90">Problemas detectados</div>
                      <Badge variant="outline" className={["border", toneClasses("muted")].join(" ")}>
                        {issues.length}
                      </Badge>
                    </div>

                    <div className="mt-3">
                      {issues.length === 0 ? (
                        <div className="text-xs text-white/55">No se detectaron problemas. 🎉</div>
                      ) : (
                        <Accordion type="single" collapsible className="w-full">
                          {issues.map((it: any, idx: number) => {
                            const b = issueBadge(it.severity);
                            return (
                              <AccordionItem key={idx} value={`issue-${idx}`} className="border-white/10">
                                <AccordionTrigger className="text-left hover:no-underline">
                                  <div className="flex w-full items-center justify-between gap-3 pr-2">
                                    <div className="font-medium text-white/90">{it.title}</div>
                                    <Badge variant="outline" className={["border", b.cls].join(" ")}>
                                      {b.label}
                                    </Badge>
                                  </div>
                                </AccordionTrigger>

                                <AccordionContent>
                                  <div className="space-y-3">
                                    {it.description ? (
                                      <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                                        <div className="text-[11px] font-semibold text-white/60">Descripción</div>
                                        <div className="mt-1 text-xs text-white/80">{it.description}</div>
                                      </div>
                                    ) : null}

                                    {it.impact ? (
                                      <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                                        <div className="text-[11px] font-semibold text-white/60">Impacto</div>
                                        <div className="mt-1 text-xs text-white/80">{it.impact}</div>
                                      </div>
                                    ) : null}

                                    {it.solution ? (
                                      <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                                        <div className="text-[11px] font-semibold text-white/60">Solución</div>
                                        <div className="mt-1 text-xs text-white/80 whitespace-pre-wrap">
                                          {it.solution}
                                        </div>
                                      </div>
                                    ) : null}

                                    {it.docsUrl ? (
                                      <a
                                        href={it.docsUrl}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="inline-flex items-center gap-2 text-xs text-[#B55CFF] hover:underline"
                                      >
                                        <ExternalLink className="h-3.5 w-3.5" />
                                        Ver documentación
                                      </a>
                                    ) : null}
                                  </div>
                                </AccordionContent>
                              </AccordionItem>
                            );
                          })}
                        </Accordion>
                      )}
                    </div>
                  </div>

                  {/* =========================
                      Eventos detectados (friendly)
                     ========================= */}
                  <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-semibold text-white/90">Eventos detectados</div>
                      <Badge variant="outline" className={["border", toneClasses("muted")].join(" ")}>
                        {events.length}
                      </Badge>
                    </div>

                    <div className="mt-1 text-xs text-white/55">
                      Esto te ayuda a confirmar qué acciones está midiendo tu sitio (sin mostrar “código raro”).
                    </div>

                    <div className="mt-3">
                      {events.length === 0 ? (
                        <div className="text-xs text-white/55">
                          No se detectaron eventos. Tip: prueba una URL de “gracias” / checkout.
                        </div>
                      ) : (
                        <Accordion type="single" collapsible className="w-full">
                          {events.map((ev: any, idx: number) => {
                            const platform = humanizePlatform(ev.type);
                            const title = friendlyEventTitle(ev.type, ev.name);
                            const desc = friendlyEventDesc(ev.type, ev.name);
                            const { chips, hints } = extractEventHighlights(ev.params || {});
                            const custom = isCustomEvent(ev.type, ev.name);

                            const showBestPractice =
                              platform === "Meta Pixel" && !!META_EVENT_CATALOG[ev.name]?.bestPractice;

                            return (
                              <AccordionItem key={idx} value={`event-${idx}`} className="border-white/10">
                                <AccordionTrigger className="text-left hover:no-underline">
                                  <div className="flex w-full items-center justify-between gap-3 pr-2">
                                    <div className="flex items-center gap-2 min-w-0">
                                      <Badge
                                        variant="outline"
                                        className={["border", toneClasses("muted")].join(" ")}
                                      >
                                        {platform}
                                      </Badge>
                                      <div className="font-medium text-white/90 truncate">{title}</div>
                                      {custom ? (
                                        <Badge
                                          variant="outline"
                                          className="border bg-amber-500/10 text-amber-200 border-amber-500/20"
                                        >
                                          Personalizado
                                        </Badge>
                                      ) : null}
                                    </div>
                                    {ev.source ? (
                                      <div className="text-[11px] text-white/45">{ev.source}</div>
                                    ) : null}
                                  </div>
                                </AccordionTrigger>

                                <AccordionContent>
                                  <div className="space-y-3">
                                    <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                                      <div className="text-[11px] font-semibold text-white/60">¿Qué significa?</div>
                                      <div className="mt-1 text-xs text-white/80">{desc}</div>

                                      {showBestPractice ? (
                                        <div className="mt-2 text-[11px] text-white/55">
                                          <span className="text-white/50">Mejor práctica:</span>{" "}
                                          {META_EVENT_CATALOG[ev.name]?.bestPractice}
                                        </div>
                                      ) : null}
                                    </div>

                                    {chips.length ? (
                                      <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                                        <div className="text-[11px] font-semibold text-white/60">Datos detectados</div>
                                        <div className="mt-2 flex flex-wrap gap-2">
                                          {chips.map((c, i) => (
                                            <div
                                              key={i}
                                              className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.02] px-3 py-1"
                                            >
                                              <span className="text-[11px] text-white/55">{c.label}</span>
                                              <span className="text-xs text-white/85">{c.value}</span>
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    ) : (
                                      <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                                        <div className="text-[11px] font-semibold text-white/60">Datos detectados</div>
                                        <div className="mt-1 text-xs text-white/55">
                                          Este evento se detectó, pero no trae campos “importantes” (como valor, moneda,
                                          productos, etc.). Aun así puede estar funcionando correctamente.
                                        </div>
                                      </div>
                                    )}

                                    {hints.length ? (
                                      <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-3">
                                        <div className="text-[11px] font-semibold text-amber-200">Sugerencia</div>
                                        <ul className="mt-1 space-y-1 text-xs text-amber-100/90 list-disc pl-5">
                                          {hints.map((h, i) => (
                                            <li key={i}>{h}</li>
                                          ))}
                                        </ul>
                                      </div>
                                    ) : null}

                                    {/* Detalles técnicos opcionales (para devs) */}
                                    <details className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
                                      <summary className="cursor-pointer list-none flex items-center justify-between">
                                        <div className="text-xs font-semibold text-white/75">Detalles técnicos</div>
                                        <div className="text-[11px] text-white/45">Ver parámetros</div>
                                      </summary>

                                      <div className="mt-3">
                                        <div className="flex justify-end">
                                          <Button
                                            variant="outline"
                                            className="border-white/10 text-white/80 hover:bg-white/5"
                                            onClick={() => copyText(JSON.stringify(ev.params ?? {}, null, 2))}
                                          >
                                            <Copy className="h-4 w-4 mr-2" />
                                            Copiar
                                          </Button>
                                        </div>

                                        <pre className="mt-3 text-xs overflow-auto rounded-lg bg-white/[0.03] border border-white/10 p-3 text-white/80 max-h-72">
                                          {JSON.stringify(ev.params ?? {}, null, 2)}
                                        </pre>
                                      </div>
                                    </details>
                                  </div>
                                </AccordionContent>
                              </AccordionItem>
                            );
                          })}
                        </Accordion>
                      )}
                    </div>
                  </div>

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
                    Si un sitio usa Shopify/Apps, algunas etiquetas se inyectan de forma dinámica. Si dudas, prueba también con
                    la URL de checkout/thank-you y desactiva AdBlock.
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
