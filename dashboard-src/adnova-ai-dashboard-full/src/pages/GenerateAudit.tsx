// dashboard-src/src/pages/GenerateAudit.tsx
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Brain, Zap, Sparkles, ChevronRight, AlertCircle } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";

type PlanSlug = "gratis" | "emprendedor" | "crecimiento" | "pro";

// Periodos posibles para el uso de auditorías
type UsagePeriod = "daily" | "rolling" | "weekly" | "monthly" | "unlimited";

type Usage = {
  plan: PlanSlug;
  limit: number | null;
  used: number;
  period: UsagePeriod;
  nextResetAt?: string | null;
  unlimited: boolean;
};

const PLAN_LABEL: Record<PlanSlug, string> = {
  // Plan Gratis: 1 auditoría IA por semana
  gratis: "1 auditoría IA por semana",
  emprendedor: "2 auditorías IA al mes",
  crecimiento: "1 auditoría IA por semana",
  pro: "Auditorías ilimitadas",
};

async function fetchAuditUsage(): Promise<Usage> {
  const res = await fetch("/api/audits/usage", { credentials: "include" });
  if (res.status === 401) throw new Error("NO_SESSION");
  if (!res.ok) throw new Error("FETCH_FAIL");
  const data = await res.json();
  return data as Usage;
}

const GenerateAudit = () => {
  const [isGenerating, setIsGenerating] = useState(false);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [loadingUsage, setLoadingUsage] = useState(true);
  const [usageError, setUsageError] = useState<string | null>(null);

  const refetchUsage = async () => {
    setLoadingUsage(true);
    setUsageError(null);
    try {
      const u = await fetchAuditUsage();
      setUsage(u);
    } catch (e: any) {
      console.error("Error cargando uso de auditorías:", e);
      setUsage(null);
      setUsageError(
        e?.message === "NO_SESSION"
          ? "Tu sesión expiró. Vuelve a iniciar sesión."
          : "No pudimos cargar tu uso de auditorías."
      );
    } finally {
      setLoadingUsage(false);
    }
  };

  useEffect(() => {
    refetchUsage();
  }, []);

  const reachedLimit =
    !!usage &&
    !usage.unlimited &&
    usage.limit !== null &&
    usage.used >= usage.limit;

  const buttonBlocked = loadingUsage || reachedLimit;

  const handleGenerateAudit = async () => {
    if (buttonBlocked || isGenerating) return;
    setIsGenerating(true);
    setUsageError(null);

    try {
      const res = await fetch("/api/audits/run", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        // Muy importante: marcar explícitamente que esto viene del PANEL
        body: JSON.stringify({
          source: "panel", // se convertirá en origin: "panel" en la colección Audit
        }),
      });

      let data: any = {};
      try {
        data = await res.json();
      } catch {
        data = {};
      }

      // Sesión expirada / usuario no autenticado
      if (res.status === 401 || data?.error === "UNAUTHENTICATED") {
        const msg = "Tu sesión expiró. Vuelve a iniciar sesión.";
        setUsageError(msg);
        alert(msg);
        return;
      }

      if (!res.ok || data?.ok === false) {
        const msg =
          data?.error ||
          data?.detail ||
          "No se pudo generar la auditoría. Intenta de nuevo.";
        console.error("Error en /api/audits/run:", data);
        setUsageError(msg);
        alert(msg);
        return;
      }

      if (Array.isArray(data.results)) {
        const okAny = data.results.some((r: any) => r?.ok);
        if (!okAny) {
          const firstErr =
            data.results.find((r: any) => !r.ok)?.error ||
            "No se pudo generar la auditoría (verifica tus conexiones).";
          console.warn("Resultados de auditoría sin éxito:", data.results);
          setUsageError(firstErr);
          alert(firstErr);
        } else {
          console.log("Auditorías generadas:", data.results);
        }
      }

      // Recalcular conteo usado justo después de generar
      await refetchUsage();
    } catch (err) {
      console.error("Error generando auditoría:", err);
      const msg = "Ocurrió un error al generar la auditoría. Intenta de nuevo.";
      setUsageError(msg);
      alert(msg);
    } finally {
      // ✅ Al terminar (éxito o error) ocultamos la leyenda automáticamente
      setIsGenerating(false);
    }
  };

  const planText = usage
    ? `Plan: ${usage.plan.charAt(0).toUpperCase() + usage.plan.slice(1)} · ${
        PLAN_LABEL[usage.plan]
      }`
    : "";

  // Contador visual “maquillado” 0/1 → 1/1,
  // sin afectar la lógica real de límites
  const hasGeneratedAtLeastOne =
    !!usage && typeof usage.used === "number" && usage.used > 0;

  const progressPercent =
    !usage || usage.unlimited || usage.limit === null
      ? 0
      : hasGeneratedAtLeastOne
      ? 100
      : 0;

  // 👇 helper para el texto de “Se reinicia…”
  const renderResetInfo = () => {
    if (!usage) return "";
    if (usage.unlimited) return "Uso ilimitado";

    const hasDate = !!usage.nextResetAt;
    const dateStr = hasDate
      ? new Date(usage.nextResetAt as string).toLocaleDateString()
      : "";

    if (usage.period === "daily") {
      return hasDate ? <>Se reinicia diariamente · {dateStr}</> : <>Periodo: diario</>;
    }

    if (usage.period === "rolling") {
      return <>Ventana: cada 15 días</>;
    }

    if (usage.period === "weekly") {
      return hasDate ? <>Periodo: semanal · {dateStr}</> : <>Periodo: semanal</>;
    }

    if (usage.period === "monthly") {
      return hasDate ? <>Periodo: mensual · {dateStr}</> : <>Periodo: mensual</>;
    }

    return "Uso ilimitado";
  };

  return (
    <DashboardLayout>
      <div className="min-h-screen bg-[#0B0B0D] p-6">
        <div className="max-w-4xl mx-auto space-y-8">
          {/* Header */}
          <div className="text-center space-y-4">
            <h1 className="text-4xl font-bold gradient-text">Generar Auditoría con IA</h1>
            <p className="text-[#9A8CA8] text-lg">
              Obtén un análisis completo de tu negocio digital con inteligencia artificial
            </p>
          </div>

          {/* AI Animation Section */}
          <div className="flex justify-center">
            <div className="relative">
              <div className="relative w-48 h-48 flex items-center justify-center">
                <div
                  className="absolute inset-0 rounded-full border border-[#B55CFF]/20 animate-spin"
                  style={{ animationDuration: "20s" }}
                />
                <div
                  className="absolute inset-4 rounded-full border border-[#B55CFF]/30 animate-spin"
                  style={{ animationDuration: "15s", animationDirection: "reverse" }}
                />
                <div
                  className="absolute inset-8 rounded-full border border-[#B55CFF]/40 animate-spin"
                  style={{ animationDuration: "10s" }}
                />

                <div
                  className={`relative w-24 h-24 bg-gradient-to-br from-[#B55CFF]/20 to-[#9D5BFF]/20 rounded-full flex items-center justify-center backdrop-blur-sm border border-[#B55CFF]/20 transition-all duration-1000 ${
                    isGenerating
                      ? "animate-pulse scale-110 shadow-[0_0_30px_rgba(181,92,255,0.5)]"
                      : "shadow-[0_0_15px_rgba(181,92,255,0.3)]"
                  }`}
                >
                  <Brain
                    className={`w-12 h-12 text-[#B55CFF] transition-all duration-1000 ${
                      isGenerating ? "animate-pulse" : ""
                    }`}
                  />
                </div>

                {[...Array(12)].map((_, i) => (
                  <div
                    key={i}
                    className="absolute w-2 h-2 bg-[#B55CFF] rounded-full animate-pulse"
                    style={{
                      top: "50%",
                      left: "50%",
                      transform: `rotate(${i * 30}deg) translateX(${80 + Math.sin(i) * 20}px) translateY(-50%)`,
                      animationDelay: `${i * 0.15}s`,
                      animationDuration: `${2 + (i % 3) * 0.5}s`,
                      opacity: 0.6 + (i % 3) * 0.2,
                    }}
                  />
                ))}

                {isGenerating && (
                  <>
                    <div className="absolute inset-0 animate-ping">
                      <div className="w-48 h-48 bg-[#B55CFF]/10 rounded-full" />
                    </div>
                    <div className="absolute inset-4 animate-ping" style={{ animationDelay: "0.5s" }}>
                      <div className="w-40 h-40 bg-[#B55CFF]/10 rounded-full" />
                    </div>
                  </>
                )}
              </div>

              <Zap
                className="absolute -top-6 -right-6 w-6 h-6 text-[#FFD700] animate-bounce"
                style={{ animationDelay: "0.5s" }}
              />
              <Sparkles
                className="absolute -bottom-6 -left-6 w-6 h-6 text-[#B55CFF] animate-bounce"
                style={{ animationDelay: "1s" }}
              />
              <Brain
                className="absolute top-0 -left-8 w-5 h-5 text-[#9D5BFF] animate-bounce"
                style={{ animationDelay: "1.5s" }}
              />
            </div>
          </div>

          {/* Generate Button */}
          <div className="flex justify-center">
            <Button
              onClick={handleGenerateAudit}
              disabled={isGenerating || buttonBlocked}
              title={
                reachedLimit
                  ? "Has alcanzado tu límite de auditorías para este periodo."
                  : usageError
                  ? usageError
                  : ""
              }
              size="lg"
              className="bg-gradient-to-r from-[#B55CFF] to-[#9D5BFF] hover:from-[#B55CFF]/90 hover:to-[#9D5BFF]/90 text-white px-8 py-6 text-lg font-semibold shadow-lg hover:shadow-xl transition-all duration-200 neon-glow"
            >
              {isGenerating ? (
                <>
                  <Brain className="w-5 h-5 mr-2 animate-spin" />
                  Generando Auditoría...
                </>
              ) : (
                <>
                  Generar Auditoría
                  <ChevronRight className="w-5 h-5 ml-2" />
                </>
              )}
            </Button>
          </div>

          {/* ✅ Leyenda SOLO mientras se genera */}
          {isGenerating && (
            <div
              className="max-w-2xl mx-auto -mt-2"
              role="status"
              aria-live="polite"
            >
              <div className="flex items-start gap-3 rounded-2xl border border-[#B55CFF]/30 bg-[#B55CFF]/10 px-5 py-4 backdrop-blur-sm shadow-[0_0_18px_rgba(181,92,255,0.15)]">
                <AlertCircle className="h-5 w-5 text-[#D7B6FF] mt-0.5 shrink-0" />
                <div className="text-sm sm:text-base leading-relaxed">
                  <div className="font-semibold text-[#EAD8FF]">
                    Estamos generando tu auditoría…
                  </div>
                  <div className="text-[#BFB2CB]">
                    Este proceso puede tomar de 2 a 8 minutos. Por favor, no cierres esta pestaña ni salgas del panel hasta que finalice.
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ======= BLOQUE DE USO ======= */}
          <Card className="glass-effect border-[#2C2530]">
            <CardHeader>
              <CardTitle className="text-xl font-bold">Tu uso de auditorías</CardTitle>
              <p className="text-[#9A8CA8]">
                {loadingUsage ? "Cargando uso…" : usage ? planText : usageError || "No disponible"}
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-end justify-between">
                <div className="text-3xl font-bold">
                  {loadingUsage
                    ? "— / —"
                    : !usage
                    ? "— / —"
                    : usage.unlimited
                    ? `${usage.used} / ∞`
                    : `${hasGeneratedAtLeastOne ? 1 : 0} / 1`}
                </div>
                <div className="text-xs text-right text-[#9A8CA8]">
                  {loadingUsage || !usage ? "" : renderResetInfo()}
                </div>
              </div>

              <div className="w-full h-2 rounded bg-white/10 overflow-hidden">
                <div
                  className="h-2 bg-[#B55CFF] transition-all"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>

              {/* Texto + mensaje de éxito + botón */}
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                {/* Texto + badge de éxito */}
                <div className="flex-1 space-y-2 text-sm">
                  <p>
                    {loadingUsage
                      ? " "
                      : !usage
                      ? usageError || "No disponible."
                      : usage.unlimited
                      ? "Uso ilimitado."
                      : reachedLimit
                      ? "Has alcanzado tu límite de auditorías."
                      : `Te ${usage.limit! - usage.used === 1 ? "queda" : "quedan"} ${
                          usage.limit! - usage.used
                        } auditoría${usage.limit! - usage.used === 1 ? "" : "s"} en este periodo.`}
                  </p>

                  {!loadingUsage && hasGeneratedAtLeastOne && (
                    <div className="inline-flex items-start gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs sm:text-sm text-emerald-300">
                      <Sparkles className="mt-0.5 h-4 w-4" />
                      <span>
                        Tu auditoría se generó con éxito.{" "}
                        <span className="font-medium">
                          Ve a revisarla con el botón &quot;Revisar auditoría&quot;.
                        </span>
                      </span>
                    </div>
                  )}
                </div>

                {/* Botón para ir al panel de auditorías */}
                {!loadingUsage && hasGeneratedAtLeastOne && (
                  <a
                    href="/dashboard/site-audit"
                    className="text-sm px-3 py-2 rounded-lg border border-emerald-400/60 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 transition inline-flex items-center gap-2 self-start sm:self-auto"
                  >
                    Revisar auditoría
                    <ChevronRight className="w-4 h-4" />
                  </a>
                )}
              </div>
            </CardContent>
          </Card>

          <Separator className="bg-[#2C2530]" />

          {/* Terms and Conditions */}
          <Card className="glass-effect border-[#2C2530]">
            <CardHeader>
              <CardTitle className="text-2xl font-bold text-center text-[#B55CFF]">
                Términos y Condiciones para la Generación de Auditorías con IA
              </CardTitle>
              <p className="text-center text-[#9A8CA8]">
                Antes de continuar, por favor, lee y acepta los siguientes términos:
              </p>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-4">
                <div className="space-y-2">
                  <h3 className="text-lg font-semibold text-[#E5D3FF]">1. Uso de Datos</h3>
                  <p className="text-[#9A8CA8] leading-relaxed">
                    Para generar la auditoría, recopilaremos y analizaremos información pública y
                    privada relacionada con tu tienda y tus cuentas de marketing digital, según lo
                    que autorices. Toda la información se utilizará únicamente con fines de análisis
                    y mejora de tu negocio.
                  </p>
                </div>

                <div className="space-y-2">
                  <h3 className="text-lg font-semibold text-[#E5D3FF]">2. Privacidad</h3>
                  <p className="text-[#9A8CA8] leading-relaxed">
                    No compartiremos tus datos ni los resultados de la auditoría con terceros no
                    autorizados. Tu información se protegerá conforme a nuestra{" "}
                    <a
                      href="/politica.html"
                      target="_blank"
                      rel="noreferrer"
                      className="text-[#B55CFF] underline"
                    >
                      Política de Privacidad
                    </a>
                    .
                  </p>
                </div>

                <div className="space-y-2">
                  <h3 className="text-lg font-semibold text-[#E5D3FF]">3. Propósito Informativo</h3>
                  <p className="text-[#9A8CA8] leading-relaxed">
                    Las auditorías generadas por nuestra IA tienen fines informativos y de asesoría.
                    No constituyen recomendaciones legales, fiscales ni garantías de resultados
                    específicos en ventas o rendimiento publicitario.
                  </p>
                </div>

                <div className="space-y-2">
                  <h3 className="text-lg font-semibold text-[#E5D3FF]">4. Responsabilidad</h3>
                  <p className="text-[#9A8CA8] leading-relaxed">
                    La decisión de implementar cualquier sugerencia recae exclusivamente en el
                    usuario. Adnova AI no se hace responsable de los resultados derivados de la
                    aplicación de las recomendaciones propuestas por la herramienta.
                  </p>
                </div>

                <div className="space-y-2">
                  <h3 className="text-lg font-semibold text-[#E5D3FF]">5. Consentimiento</h3>
                  <p className="text-[#9A8CA8] leading-relaxed">
                    Al utilizar la función de &quot;Generar Auditoría&quot;, aceptas estos términos
                    y autorizas el procesamiento de tus datos para la elaboración del informe de
                    auditoría con IA.
                  </p>
                </div>
              </div>

              <div className="pt-4 border-t border-[#2C2530]">
                <p className="text-sm text-[#9A8CA8] text-center italic">
                  Al hacer clic en &quot;Generar Auditoría&quot;, confirmas que has leído y aceptas
                  estos términos y condiciones.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default GenerateAudit;
