// dashboard-src/src/components/ActionCenter.tsx
import {
  Sparkles,
  Rocket,
  ShieldCheck,
  Link2,
  BadgeCheck,
  ArrowRight,
  CheckCircle2,
  Check,
} from "lucide-react";
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useGettingStartedProgress } from "@/hooks/useGettingStartedProgress";

const ROUTES = {
  pixelAudit: "/pixel-checker",      // AJUSTA si tu ruta real es otra
  metaAds: "/meta-ads",
  googleAds: "/google-ads",
  ga4: "/google-analytics",
  shopify: "/shopify",              // si aún no existe, puedes apuntar a "/dashboard"
  insights: "/auditorias",           // AJUSTA: donde quieras mandar "primer insight" (auditorías)
};

type PillProps = { label: string; done?: boolean };
function Pill({ label, done }: PillProps) {
  return (
    <span
      className={[
        "text-[10.5px] px-2.5 py-1 rounded-full border bg-white/[0.02] inline-flex items-center gap-1.5",
        done ? "border-[#B55CFF]/40 text-white/90" : "border-white/10 text-white/75",
      ].join(" ")}
    >
      {done ? <Check className="w-3.5 h-3.5 text-[#B55CFF]" /> : null}
      {label}
    </span>
  );
}

export const ActionCenter = () => {
  const nav = useNavigate();
  const gs = useGettingStartedProgress();

  const completed = gs.completed;
  const total = gs.total;
  const pct = gs.pct;

  const chips = useMemo(
    () => [
      { label: "Pixel Audit", done: gs.pixelAuditDone },
      { label: "Meta", done: gs.metaConnected },
      { label: "Google Ads", done: gs.googleAdsConnected },
      { label: "GA4", done: gs.ga4Connected },
      { label: "Sitio Web", done: false }, // cuando exista, lo conectamos
      { label: "Shopify", done: gs.shopifyConnected },
    ],
    [gs.pixelAuditDone, gs.metaConnected, gs.googleAdsConnected, gs.ga4Connected, gs.shopifyConnected]
  );

  const missions = useMemo(
    () => [
      {
        icon: <ShieldCheck className="w-4 h-4 text-[#B55CFF]" />,
        title: "Audita tus píxeles",
        desc: "Detecta eventos faltantes y bloqueos de tracking.",
        badge: gs.pixelAuditDone ? "Completado" : "Recomendado",
        done: gs.pixelAuditDone,
        to: ROUTES.pixelAudit,
      },
      {
        icon: <Link2 className="w-4 h-4 text-[#B55CFF]" />,
        title: "Conecta tu primera cuenta",
        desc: "Meta Ads, Google Ads o GA4 (1 clic).",
        badge:
          gs.metaConnected || gs.googleAdsConnected || gs.ga4Connected
            ? "Completado"
            : "Setup",
        done: gs.metaConnected || gs.googleAdsConnected || gs.ga4Connected,
        to: gs.metaConnected
          ? ROUTES.metaAds
          : gs.googleAdsConnected
          ? ROUTES.googleAds
          : gs.ga4Connected
          ? ROUTES.ga4
          : ROUTES.metaAds, // default para iniciar
      },
      {
        icon: <BadgeCheck className="w-4 h-4 text-[#B55CFF]" />,
        title: "Obtén tu primer insight",
        desc: "Resumen automático + próximos pasos por impacto.",
        badge: "IA",
        done: false, // cuando tengas un “primer insight” real lo conectamos
        to: ROUTES.insights,
      },
    ],
    [gs.pixelAuditDone, gs.metaConnected, gs.googleAdsConnected, gs.ga4Connected]
  );

  const statusText = gs.loading
    ? "Estado: verificando conexiones..."
    : pct >= 80
    ? "Estado: ya casi listo — 1 paso más"
    : "Estado: preparando tutorial guiado (próximamente)";

  return (
    <div
      className="
        bg-[#15121A] border border-[#2C2530] rounded-2xl
        hover:shadow-[0_6px_24px_rgba(181,92,255,0.14)] hover:border-[#A664FF]
        transition-all duration-300
        h-full flex flex-col p-6
      "
    >
      {/* Header + status */}
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex items-start gap-3">
          <div className="h-9 w-9 rounded-xl bg-[#0B0B0D] border border-[#2C2530] flex items-center justify-center shrink-0">
            <Rocket className="w-4 h-4 text-[#B55CFF]" />
          </div>

          <div className="min-w-0">
            <h3 className="text-[#E5D3FF] text-lg font-bold leading-5">
              Launchpad — <span className="text-[#B55CFF]">Empieza aquí</span>
            </h3>
            <p className="text-[#9A8CA8] text-sm mt-1">
              Completa 3 misiones rápidas y desbloquea tu primer insight.
            </p>

            <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] text-white/70">
              <span className="h-2 w-2 rounded-full bg-[#EB2CFF] animate-pulse" />
              {statusText}
            </div>
          </div>
        </div>

        {/* pill */}
        <span className="shrink-0 text-[11px] px-2.5 py-1 rounded-full border border-white/10 bg-white/[0.04] text-white/70">
          Próximamente
        </span>
      </div>

      {/* Progress card */}
      <div className="rounded-2xl border border-[#2C2530] bg-[#0B0B0D] p-4 mb-4">
        <div className="flex items-center justify-between">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-white/90">Setup Progress</p>
            <p className="text-xs text-[#9A8CA8]">
              {gs.loading ? "Cargando..." : `${completed} de ${total} pasos completados · ${pct}%`}
            </p>
          </div>

          <div className="h-8 w-8 rounded-xl bg-white/[0.03] border border-white/10 flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-[#B55CFF]" />
          </div>
        </div>

        <div className="mt-3 h-2 w-full rounded-full bg-white/10 overflow-hidden">
          <div
            className="h-full bg-[#B55CFF] transition-all"
            style={{ width: `${gs.loading ? 10 : pct}%` }}
          />
        </div>

        {/* Chips con estado */}
        <div className="mt-3 flex flex-wrap gap-2">
          {chips.map((c) => (
            <Pill key={c.label} label={c.label} done={c.done} />
          ))}
        </div>
      </div>

      {/* Missions */}
      <div className="space-y-3 flex-1">
        {missions.map((m) => (
          <div
            key={m.title}
            className="rounded-2xl border border-[#2C2530] bg-[#0B0B0D] p-4 hover:border-[#A664FF]/60 transition-colors"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3 min-w-0">
                <div className="h-9 w-9 rounded-xl bg-white/[0.03] border border-white/10 flex items-center justify-center shrink-0">
                  {m.icon}
                </div>

                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-white/90 truncate">
                      {m.title}
                    </p>

                    <span
                      className={[
                        "text-[10.5px] px-2 py-0.5 rounded-full border bg-white/[0.03] shrink-0",
                        m.done ? "border-[#B55CFF]/40 text-white/90" : "border-white/10 text-white/70",
                      ].join(" ")}
                    >
                      {m.badge}
                    </span>
                  </div>

                  <p className="text-xs text-[#9A8CA8] mt-1">
                    {m.desc}
                  </p>
                </div>
              </div>

              {/* CTA real */}
              <button
                onClick={() => nav(m.to)}
                className={[
                  "shrink-0 inline-flex items-center gap-1.5 text-xs px-3 py-2 rounded-xl border transition-colors",
                  "border-white/10 bg-white/[0.02] text-white/80 hover:bg-white/[0.05]",
                ].join(" ")}
                title="Abrir"
              >
                Abrir <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Teaser de “insight” */}
      <div className="mt-4 rounded-2xl border border-[#2C2530] bg-[#0B0B0D] p-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-semibold text-white/90">Insight Preview</p>
          <span className="text-[10.5px] px-2 py-0.5 rounded-full border border-white/10 bg-white/[0.03] text-white/70">
            IA
          </span>
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs text-white/75">
            <CheckCircle2 className="w-3.5 h-3.5 text-white/30" />
            <span className="h-2 w-48 rounded-full bg-white/5" />
          </div>
          <div className="flex items-center gap-2 text-xs text-white/75">
            <CheckCircle2 className="w-3.5 h-3.5 text-white/30" />
            <span className="h-2 w-56 rounded-full bg-white/5" />
          </div>
          <div className="flex items-center gap-2 text-xs text-white/75">
            <CheckCircle2 className="w-3.5 h-3.5 text-white/30" />
            <span className="h-2 w-40 rounded-full bg-white/5" />
          </div>
        </div>

        <p className="text-[11px] text-[#6D5A80] mt-3">
          Próximamente: Adray generará tus próximos pasos más importantes (por impacto),
          con evidencia numérica y acceso directo para ejecutarlos.
        </p>
      </div>
    </div>
  );
};
