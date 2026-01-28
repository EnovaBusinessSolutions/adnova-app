// dashboard-src/src/hooks/useLatestAudits.ts
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/* Tipos base */
export type SeverityNorm = "alta" | "media" | "baja";
export type Area =
  | "setup"
  | "performance"
  | "creative"
  | "tracking"
  | "budget"
  | "bidding"
  | "ux"
  | "seo"
  | "media"
  | "otros";

export type LinkRef = { label: string; url: string };

export type AuditIssueVM = {
  id?: string;
  area?: Area;
  title: string;
  severity: SeverityNorm;
  evidence?: string;
  metrics?: Record<string, any>;
  recommendation?: string;
  estimatedImpact?: "alto" | "medio" | "bajo";
  blockers?: string[];
  links?: LinkRef[];
};

export type AuditDocVM = {
  _id?: string;
  userId?: string;
  type: "google" | "meta" | "shopify" | "ga4" | string; // ← ga4
  generatedAt?: string | null;
  summary: string;
  issues: AuditIssueVM[];
  actionCenter: AuditIssueVM[];
  topProducts?: Array<{ name?: string; title?: string; sales?: number; revenue?: number }>;
  raw?: any;
};

/* Formatos de respuesta compatibles */
type LlmAudit = {
  summary: string;
  issues?: AuditIssueVM[];       // puede venir como "issues"
  findings?: AuditIssueVM[];     // o como "findings" (per-source latest)
  actionCenter?: AuditIssueVM[];
  topProducts?: any[];
  type?: AuditDocVM["type"];
  generatedAt?: string | null;
  createdAt?: string | null;     // per-source latest puede devolver createdAt
};

type LegacyIssue = {
  title?: string;
  description?: string;
  severity?: "high" | "medium" | "low";
  screenshot?: string;
  recommendation?: string;
};
type LegacyIssuesBucket = {
  productos?: { nombre: string; hallazgos: LegacyIssue[] }[];
  ux?: LegacyIssue[];
  seo?: LegacyIssue[];
  performance?: LegacyIssue[];
  media?: LegacyIssue[];
  [k: string]: any;
};
type LegacyAudit = {
  _id?: string;
  userId?: string;
  type?: AuditDocVM["type"];
  generatedAt?: string;
  resumen?: string;
  productsAnalizados?: number;
  actionCenter?: Array<{
    title: string;
    description: string;
    severity?: "high" | "medium" | "low";
    button?: string;
    estimated?: string;
  }>;
  issues?: LegacyIssuesBucket;
  salesLast30?: number;
  ordersLast30?: number;
  avgOrderValue?: number;
  topProducts?: Array<{ name: string; sales?: number; revenue?: number }>;
  customerStats?: { newPct?: number; repeatPct?: number };
};

type MultiLatestResp = {
  ok: boolean;
  // data puede traer google/meta/shopify/ga4 (y quizá "ga" legacy)
  data: Partial<Record<AuditDocVM["type"], LegacyAudit | LlmAudit | null>> & {
    ga?: LegacyAudit | LlmAudit | null;   // alias legacy
  };
};

type SingleLatestRespQuery = {
  ok: boolean;
  audit: LegacyAudit | LlmAudit | null;
};

/* Utils */
function sevToNorm(s?: string): SeverityNorm {
  const v = String(s || "").toLowerCase().trim();
  if (v === "high" || v === "alta") return "alta";
  if (v === "medium" || v === "media") return "media";
  if (v === "low" || v === "baja") return "baja";
  return "media";
}

function normalizeFromLlm(type: AuditDocVM["type"], src: LlmAudit, raw: any): AuditDocVM {
  // aceptar "issues" o "findings"
  const list = Array.isArray(src.issues)
    ? src.issues
    : Array.isArray(src.findings)
    ? src.findings
    : [];

  const issues = list.map((i) => ({
    id: i.id,
    area: (i.area as Area) || "otros",
    title: i.title || "Hallazgo",
    severity: sevToNorm((i as any).severity),
    evidence: i.evidence,
    metrics: i.metrics,
    recommendation: i.recommendation,
    estimatedImpact: i.estimatedImpact,
    blockers: i.blockers,
    links: i.links,
  }));

  const ac =
    Array.isArray(src.actionCenter) && src.actionCenter.length
      ? src.actionCenter.map((i) => ({
          id: i.id,
          area: (i.area as Area) || "otros",
          title: i.title || "Acción recomendada",
          severity: sevToNorm((i as any).severity),
          evidence: i.evidence,
          metrics: i.metrics,
          recommendation: i.recommendation,
          estimatedImpact: i.estimatedImpact,
          blockers: i.blockers,
          links: i.links,
        }))
      : issues.slice(0, 3);

  return {
    type,
    generatedAt: src.generatedAt ?? src.createdAt ?? null,
    summary: src.summary || "Sin resumen",
    issues,
    actionCenter: ac,
    topProducts: src.topProducts,
    raw,
  };
}

function normalizeFromLegacy(type: AuditDocVM["type"], src: LegacyAudit, raw: any): AuditDocVM {
  const issues: AuditIssueVM[] = [];
  const buckets = src.issues || {};

  const pushLegacy = (arr: LegacyIssue[] | undefined, area: Area) => {
    (arr || []).forEach((it, idx) => {
      issues.push({
        id: `legacy-${area}-${idx}`,
        area,
        title: it.title || "Hallazgo",
        severity: sevToNorm(it.severity),
        evidence: it.description,
        recommendation: it.recommendation,
      });
    });
  };

  pushLegacy(buckets.ux, "ux");
  pushLegacy(buckets.seo, "seo");
  pushLegacy(buckets.performance, "performance");
  pushLegacy(buckets.media, "media");

  (buckets.productos || []).forEach((p, pidx) => {
    (p.hallazgos || []).forEach((it, idx) => {
      issues.push({
        id: `legacy-prod-${pidx}-${idx}`,
        area: "performance",
        title: it.title || `Producto: ${p.nombre}`,
        severity: sevToNorm(it.severity),
        evidence: it.description,
        recommendation: it.recommendation,
      });
    });
  });

  const ac: AuditIssueVM[] = (src.actionCenter || []).map((a, i) => ({
    id: `legacy-ac-${i}`,
    area: "otros",
    title: a.title || "Acción",
    severity: sevToNorm(a.severity),
    evidence: a.description,
    recommendation: a.button ? `${a.description}\nBotón: ${a.button}` : a.description,
  }));

  return {
    _id: src._id,
    userId: src.userId,
    type,
    generatedAt: src.generatedAt ?? null,
    summary: src.resumen || "Sin resumen",
    issues,
    actionCenter: ac.length ? ac : issues.slice(0, 3),
    topProducts: src.topProducts,
    raw,
  };
}

/** Normaliza un documento cualquiera (nuevo o legacy) */
function normalizeDoc(type: AuditDocVM["type"], anyDoc: any): AuditDocVM | null {
  if (!anyDoc) return null;

  // Nuevo: { summary, issues } o { summary, findings }
  if (
    typeof anyDoc.summary === "string" &&
    (Array.isArray(anyDoc.issues) || Array.isArray(anyDoc.findings))
  ) {
    return normalizeFromLlm(type, anyDoc as LlmAudit, anyDoc);
  }

  // Legacy
  return normalizeFromLegacy(type, anyDoc as LegacyAudit, anyDoc);
}

/* Hook */
export type AuditType = "all" | "google" | "meta" | "shopify" | "ga4" | "ga"; // ga alias

export function useLatestAudits(type: AuditType = "all") {
  const [data, setData] =
    useState<Partial<Record<AuditDocVM["type"], AuditDocVM | null>> | null>(
      null
    );
  const [loading, setLoading] = useState(true);
  const [error, setErr] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setErr(null);
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    try {
      if (type === "all") {
        // Multi: /api/audits/latest
        const r = await fetch("/api/audits/latest", {
          credentials: "include",
          headers: { Accept: "application/json" },
          signal: ac.signal,
        });

        if (r.status === 401) {
          throw new Error("NO_SESSION");
        }

        const j: MultiLatestResp = await r.json();
        if (!r.ok || j?.ok !== true)
          throw new Error((j as any)?.error || "AUDITS_LATEST_ERROR");

        // Normalizamos llaves, con alias "ga" → "ga4" si viniera legacy
        const src = j?.data || {};
        const out: Partial<
          Record<AuditDocVM["type"], AuditDocVM | null>
        > = {};

        const keys: AuditDocVM["type"][] = [
          "google",
          "meta",
          "shopify",
          "ga4",
        ];
        keys.forEach((k) => {
          const payload =
            src[k] ?? (k === "ga4" ? (src as any).ga : null);
          out[k] = normalizeDoc(k, payload ?? null);
        });

        setData(out);
      } else {
        // Single: preferimos /api/audits/:source/latest (nuevo)
        const srcKey = type === "ga" ? "ga4" : type; // alias
        const r = await fetch(`/api/audits/${srcKey}/latest`, {
          credentials: "include",
          headers: { Accept: "application/json" },
          signal: ac.signal,
        });

        if (r.status === 401) {
          throw new Error("NO_SESSION");
        }

        // Puede devolver el formato per-source (summary+findings) sin {ok}
        let normalized: Partial<
          Record<AuditDocVM["type"], AuditDocVM | null>
        > = {};
        const txt = await r.text();
        let json: any = {};
        try {
          json = txt ? JSON.parse(txt) : {};
        } catch {
          json = {};
        }

        if (Array.isArray(json?.findings) || Array.isArray(json?.issues)) {
          // per-source latest
          const shaped: LlmAudit = {
            summary: json.summary || "",
            issues: json.issues, // si existiera
            findings: json.findings, // nuestro endpoint devuelve findings
            generatedAt: json.createdAt ?? null,
            createdAt: json.createdAt ?? null,
          };
          normalized[srcKey] = normalizeFromLlm(srcKey, shaped, json);
        } else if (json && typeof json === "object" && "ok" in json) {
          // Soporta también /api/audits/latest?type=source (legacy)
          const j2 = json as SingleLatestRespQuery;
          normalized[srcKey] = normalizeDoc(srcKey, j2.audit ?? null);
        } else {
          throw new Error("AUDITS_LATEST_SINGLE_SHAPE");
        }

        setData(normalized);
      }
    } catch (e: any) {
      if (e?.name !== "AbortError") {
        setErr(
          e?.message === "NO_SESSION"
            ? "NO_SESSION"
            : e?.message || "fetch_failed"
        );
      }
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [type]);

  useEffect(() => {
    refresh();
    return () => abortRef.current?.abort();
  }, [refresh]);

  const combinedActionCenter = useMemo(() => {
    if (!data) return [];
    const all = Object.values(data).filter(Boolean) as AuditDocVM[];
    return all.flatMap((d) =>
      (d.actionCenter || []).map((it) => ({ ...it, _from: d.type }))
    );
  }, [data]);

  return { data, loading, error, refresh, combinedActionCenter };
}
