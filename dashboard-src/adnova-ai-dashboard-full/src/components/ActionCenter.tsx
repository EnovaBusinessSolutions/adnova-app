//  dashboard-src/src/components/ActionCenter.tsx
import {
  Sparkles,
  Rocket,
  ShieldCheck,
  Link2,
  BadgeCheck,
  ArrowRight,
  CheckCircle2,
} from "lucide-react";

export const ActionCenter = () => {
  // Mock progresivo (luego lo conectas a estado real)
  const completed = 2;
  const total = 6;
  const pct = Math.round((completed / total) * 100);

  const missions = [
    {
      icon: <ShieldCheck className="w-4 h-4 text-[#B55CFF]" />,
      title: "Audita tus píxeles",
      desc: "Detecta eventos faltantes y bloqueos de tracking.",
      badge: "Recomendado",
    },
    {
      icon: <Link2 className="w-4 h-4 text-[#B55CFF]" />,
      title: "Conecta tu primera cuenta",
      desc: "Meta Ads, Google Ads o GA4 (1 clic).",
      badge: "Setup",
    },
    {
      icon: <BadgeCheck className="w-4 h-4 text-[#B55CFF]" />,
      title: "Obtén tu primer insight",
      desc: "Resumen automático + próximos pasos por impacto.",
      badge: "IA",
    },
  ];

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
              Estado: preparando tutorial guiado (próximamente)
            </div>
          </div>
        </div>

        {/* “Próximamente” pill */}
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
              {completed} de {total} pasos completados · {pct}%
            </p>
          </div>

          <div className="h-8 w-8 rounded-xl bg-white/[0.03] border border-white/10 flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-[#B55CFF]" />
          </div>
        </div>

        <div className="mt-3 h-2 w-full rounded-full bg-white/10 overflow-hidden">
          <div className="h-full bg-[#B55CFF]" style={{ width: `${pct}%` }} />
        </div>

        {/* mini chips */}
        <div className="mt-3 flex flex-wrap gap-2">
          {["Pixel Audit", "Meta", "Google Ads", "GA4", "Sitio Web", "Shopify"].map((t) => (
            <span
              key={t}
              className="text-[10.5px] px-2.5 py-1 rounded-full border border-white/10 text-white/75 bg-white/[0.02]"
            >
              {t}
            </span>
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
                    <span className="text-[10.5px] px-2 py-0.5 rounded-full border border-white/10 bg-white/[0.03] text-white/70 shrink-0">
                      {m.badge}
                    </span>
                  </div>
                  <p className="text-xs text-[#9A8CA8] mt-1">
                    {m.desc}
                  </p>
                </div>
              </div>

              {/* CTA visual (disabled) */}
              <button
                disabled
                className="shrink-0 inline-flex items-center gap-1.5 text-xs px-3 py-2 rounded-xl border border-white/10 bg-white/[0.02] text-white/60 cursor-not-allowed"
                title="Próximamente"
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
