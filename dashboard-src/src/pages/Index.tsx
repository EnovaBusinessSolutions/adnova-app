import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DashboardLayout } from "@/components/DashboardLayout";
import { DashboardHeader } from "@/components/DashboardHeader";
import { ActionCenter } from "@/components/ActionCenter";
import { Button } from "@/components/ui/button";
import { Info, CheckCircle2, Sparkles, Check } from "lucide-react";
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useGettingStartedProgress } from "@/hooks/useGettingStartedProgress";

// ✅ Ajusta estas rutas a tus rutas reales (según tu App.tsx / Sidebar)
const ROUTES = {
  pixelAudit: "/pixel-checker",      // o "/auditor-pixeles" etc.
  metaAds: "/meta-ads",
  googleAds: "/google-ads",
  ga4: "/google-analytics",
  shopify: "/shopify",              // si aún no existe, puedes dejarlo apuntando a "/dashboard"
};

function ComingSoonGettingStarted() {
  const nav = useNavigate();
  const gs = useGettingStartedProgress();

  // ✅ marcar como “visto” para apagar el badge "Nuevo" en el sidebar (lo haremos en el sidebar después)
  useEffect(() => {
    try {
      localStorage.setItem("adray_getting_started_seen", "1");
    } catch {}
  }, []);

  const tags = [
    "Tour guiado",
    "Checklist de setup",
    "Barra de progreso",
    "Tips contextuales",
    "Validación automática",
    "Primer insight en <2 min",
  ];

  const steps = [
    {
      key: "pixel",
      label: "Audita los píxeles de tu sitio",
      hint: "Qué es un pixel? Para qué sirve?",
      done: gs.pixelAuditDone,
      to: ROUTES.pixelAudit,
    },
    { key: "meta", label: "Conecta tu cuenta de Meta Ads", done: gs.metaConnected, to: ROUTES.metaAds },
    { key: "gads", label: "Conecta tu cuenta de Google Ads", done: gs.googleAdsConnected, to: ROUTES.googleAds },
    { key: "ga4", label: "Conecta tu cuenta de Google Analytics", done: gs.ga4Connected, to: ROUTES.ga4 },
    { key: "shop", label: "Conecta tu tienda (Shopify o WooCommerce)", done: gs.shopifyConnected, to: ROUTES.shopify },
  ];

  return (
    <Card className="glass-effect border-[#2C2530] bg-[#0F1012] h-full">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 bg-[#EB2CFF] rounded-full animate-pulse" />
          <CardTitle className="text-xl font-bold text-white/90">
            👋🏻 Empieza aquí{" "}
            <span className="text-[#B55CFF]">— Próximamente</span>
          </CardTitle>
        </div>
      </CardHeader>

      <CardContent className="pt-2">
        <p className="text-[13px] text-[#9A8CA8] mb-5">
          Estamos construyendo un mini-tutorial dentro de{" "}
          <span className="text-[#E5D3FF] font-semibold">Adray</span> para que obtengas tu primer insight en menos de{" "}
          <span className="text-white/90 font-semibold">2 minutos</span>.
          Aquí verás un checklist de pasos, barra de progreso y accesos directos a cada módulo.
        </p>

        {/* Tags */}
        <div className="flex flex-wrap gap-2 mb-6">
          {tags.map((tag) => (
            <span
              key={tag}
              className="text-xs px-3 py-1 rounded-full border border-white/10 text-white/80 bg-white/[0.02]"
            >
              {tag}
            </span>
          ))}
        </div>

        {/* Layout principal */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          {/* Checklist / pasos */}
          <div className="xl:col-span-2 min-w-0">
            <div className="rounded-xl border border-white/5 bg-[#0B0B0D] p-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-white/90 inline-flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-[#B55CFF]" />
                  Checklist de configuración
                </h3>

                <div className="text-xs text-[#9A8CA8]">
                  {gs.loading ? "Cargando..." : `${gs.completed} de ${gs.total} · ${gs.pct}%`}
                </div>
              </div>

              <div className="space-y-3">
                {steps.map((s) => (
                  <div
                    key={s.key}
                    className="flex items-start justify-between gap-3 rounded-lg border border-white/5 bg-white/[0.03] px-3 py-2"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="h-5 w-5 rounded-md bg-white/[0.06] flex items-center justify-center">
                          {s.done ? (
                            <Check className="w-3.5 h-3.5 text-[#B55CFF]" />
                          ) : (
                            <CheckCircle2 className="w-3.5 h-3.5 text-white/30" />
                          )}
                        </span>

                        <p className="text-sm text-white/85 truncate">{s.label}</p>

                        {s.done ? (
                          <span className="text-[10.5px] px-2 py-0.5 rounded-full border border-white/10 bg-white/[0.03] text-white/70">
                            Completado
                          </span>
                        ) : null}
                      </div>

                      {s.hint ? (
                        <div className="mt-1 flex items-center gap-2 text-xs text-[#9A8CA8]">
                          <Info className="w-3.5 h-3.5" />
                          <span className="truncate">{s.hint}</span>
                        </div>
                      ) : null}
                    </div>

                    {/* ✅ CTA real */}
                    <Button
                      variant="outline"
                      onClick={() => nav(s.to)}
                      className="shrink-0 border-white/10 bg-white/[0.02] text-white/80 hover:bg-white/[0.05]"
                    >
                      Abrir
                    </Button>
                  </div>
                ))}
              </div>

              {/* Progress real */}
              <div className="mt-4 rounded-xl border border-white/5 bg-white/[0.02] p-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-semibold text-white/85">
                    Account Set Up Progress
                  </p>
                  <span className="text-xs text-[#9A8CA8]">
                    {gs.loading ? "..." : `${gs.completed} de ${gs.total} pasos completados`}
                  </span>
                </div>

                <div className="h-2 w-full rounded-full bg-white/10 overflow-hidden">
                  <div
                    className="h-full bg-[#B55CFF] transition-all"
                    style={{ width: `${gs.loading ? 10 : gs.pct}%` }}
                  />
                </div>

                <p className="text-xs text-[#9A8CA8] mt-3">
                  Próximamente: este panel será un tutorial guiado con pasos automáticos y verificación por cuenta.
                </p>
              </div>
            </div>
          </div>

          {/* Columna derecha: “contexto” / mensaje */}
          <div className="min-w-0">
            <div className="rounded-xl border border-white/5 bg-[#0B0B0D] p-4 h-full overflow-hidden min-w-0">
              <h3 className="text-sm font-semibold text-white/90 mb-2">
                ¿No tienes sitio web?
              </h3>

              <p className="text-[13px] text-[#9A8CA8] mb-4 break-words leading-relaxed">
                Adray también puede ayudarte aunque no tengas web. Podrás iniciar conectando una cuenta publicitaria
                para recibir insights sobre gasto, ROAS/CPL/CAC y conversiones.
              </p>

              <div className="space-y-3">
                <Button
                  variant="outline"
                  onClick={() => nav(ROUTES.metaAds)}
                  className="
                    w-full justify-start border-white/10 bg-white/[0.02] text-white/80
                    whitespace-normal h-auto py-2 text-left leading-snug min-w-0
                  "
                >
                  <span className="min-w-0 break-words">Conectar Meta Ads</span>
                </Button>

                <Button
                  variant="outline"
                  onClick={() => nav(ROUTES.googleAds)}
                  className="
                    w-full justify-start border-white/10 bg-white/[0.02] text-white/80
                    whitespace-normal h-auto py-2 text-left leading-snug min-w-0
                  "
                >
                  <span className="min-w-0 break-words">Conectar Google Ads</span>
                </Button>

                <Button
                  variant="outline"
                  onClick={() => nav(ROUTES.ga4)}
                  className="
                    w-full justify-start border-white/10 bg-white/[0.02] text-white/80
                    whitespace-normal h-auto py-2 text-left leading-snug min-w-0
                  "
                >
                  <span className="min-w-0 break-words">Conectar Google Analytics</span>
                </Button>
              </div>

              <div className="mt-6 flex items-start gap-2 text-xs text-[#9A8CA8] min-w-0">
                <span className="w-2 h-2 bg-[#EB2CFF] rounded-full animate-pulse mt-1 shrink-0" />
                <span className="break-words">
                  Lanzamiento en fases · Recibe acceso anticipado vía correo &gt; Beta
                </span>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

const Index = () => {
  return (
    <DashboardLayout>
      <div className="min-h-screen bg-[#0B0B0D]">
        <DashboardHeader
          title="Empieza aquí"
          subtitle="Obtén tu primer insight en menos de 2 minutos"
          badge="Próximamente"
          showControls={false}
        />

        <div className="p-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-stretch">
            <div className="lg:col-span-2 min-w-0">
              <ComingSoonGettingStarted />
            </div>

            {/* Launchpad */}
            <div className="h-full min-w-0">
              <ActionCenter />
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default Index;
