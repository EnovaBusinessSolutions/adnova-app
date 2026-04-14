// dashboard-src/src/components/ActionCenter.tsx
import {
  Sparkles,
  ShieldCheck,
  Link2,
  Bot,
  BadgeCheck,
  ArrowRight,
  Check,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useGettingStartedProgress } from "@/hooks/useGettingStartedProgress";

const ROUTES = {
  pixelAudit: "/pixel-checker",
  metaAds: "/meta-ads",
  google: "/google-ads",        // ✅ Google = 1 conexión (Ads + GA4)
  generateAudit: "/generate-audit",
  audits: "/auditorias-con-ia", // ⚠️ AJUSTA si tu ruta real es otra
};

function safeGetLS(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function safeSetLS(key: string, val: string) {
  try {
    localStorage.setItem(key, val);
  } catch {}
}

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

type Mission = {
  icon: JSX.Element;
  title: string;
  desc: string;
  badge: string;
  done?: boolean;
  locked?: boolean;
  to: string;
};

export const ActionCenter = () => {
  const nav = useNavigate();
  const gs = useGettingStartedProgress();

  // ✅ Google = una sola conexión
  // soporta: gs.googleConnected o fallback a flags antiguos
  const googleDone = !!(
    (gs as any)?.googleConnected ??
    ((gs as any)?.googleAdsConnected || (gs as any)?.ga4Connected)
  );

  // ✅ Flags “soft” para guía (no forzoso)
  const [firstAuditStarted, setFirstAuditStarted] = useState(false);
  const [auditsVisited, setAuditsVisited] = useState(false);

  useEffect(() => {
    setFirstAuditStarted(safeGetLS("adray_first_audit_started") === "1");
    setAuditsVisited(safeGetLS("adray_audits_seen") === "1");
  }, []);

  // Paso 1 (conectar): basta con Meta o Google
  const connectDone = gs.metaConnected || googleDone;

  // Paso 4: pixel audit
  const pixelDone = gs.pixelAuditDone;

  // ✅ Progreso “real” del flujo que tú definiste (4 pasos)
  const total = 4;
  const completed = useMemo(() => {
    return [connectDone, firstAuditStarted, auditsVisited, pixelDone].filter(Boolean).length;
  }, [connectDone, firstAuditStarted, auditsVisited, pixelDone]);

  const pct = useMemo(() => {
    if (!total) return 0;
    return Math.round((completed / total) * 100);
  }, [completed, total]);

  // Chips “universo Adray” (en orden)
  const chips = useMemo(
    () => [
      { label: "Conectar", done: connectDone },
      { label: "Auditoría IA", done: firstAuditStarted },
      { label: "Auditorías", done: auditsVisited },
      { label: "Pixel Audit", done: pixelDone },
    ],
    [connectDone, firstAuditStarted, auditsVisited, pixelDone]
  );

  const missions: Mission[] = useMemo(() => {
    const m: Mission[] = [];

    // 1) Conectar
    m.push({
      icon: <Link2 className="w-4 h-4 text-[#B55CFF]" />,
      title: "Conecta tus cuentas",
      desc: "Conecta Meta o Google para empezar (OAuth · solo lectura).",
      badge: connectDone ? "Completado" : "Setup",
      done: connectDone,
      to: !googleDone ? ROUTES.google : !gs.metaConnected ? ROUTES.metaAds : ROUTES.google,
    });

    // 2) Generar auditoría IA
    m.push({
      icon: <Bot className="w-4 h-4 text-[#B55CFF]" />,
      title: "Genera tu primera auditoría IA",
      desc: "Se generará únicamente para las cuentas que conectaste (Meta/Google).",
      badge: firstAuditStarted ? "Completado" : "IA",
      done: firstAuditStarted,
      locked: !connectDone,
      to: ROUTES.generateAudit,
    });

    // 3) Ver auditorías
    m.push({
      icon: <BadgeCheck className="w-4 h-4 text-[#B55CFF]" />,
      title: "Ve tus auditorías con IA",
      desc: "Revisa hallazgos, recomendaciones y tu historial.",
      badge: auditsVisited ? "Completado" : "Abrir",
      done: auditsVisited,
      locked: !firstAuditStarted, // recomendado después de generar
      to: ROUTES.audits,
    });

    // 4) Pixel audit (al final)
    m.push({
      icon: <ShieldCheck className="w-4 h-4 text-[#B55CFF]" />,
      title: "Auditor de píxeles",
      desc: "Detecta eventos faltantes y bloqueos de tracking.",
      badge: pixelDone ? "Completado" : "Recomendado",
      done: pixelDone,
      locked: false,
      to: ROUTES.pixelAudit,
    });

    return m;
  }, [connectDone, firstAuditStarted, auditsVisited, pixelDone, googleDone, gs.metaConnected]);

  return (
    <div
      className="
        bg-[#15121A] border border-[#2C2530] rounded-2xl
        hover:shadow-[0_6px_24px_rgba(181,92,255,0.14)] hover:border-[#A664FF]
        transition-all duration-300
        h-full flex flex-col p-6
      "
    >
      {/* ✅ Setup Progress (flujo real de 4 pasos) */}
      <div className="rounded-2xl border border-[#2C2530] bg-[#0B0B0D] p-4">
        <div className="flex items-center justify-between">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-white/90">Ruta recomendada</p>
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

        <div className="mt-3 flex flex-wrap gap-2">
          {chips.map((c) => (
            <Pill key={c.label} label={c.label} done={c.done} />
          ))}
        </div>
      </div>

      {/* ✅ Misiones (en tu orden) */}
      <div className="mt-4 space-y-3 flex-1">
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
                    <p className="text-sm font-semibold text-white/90 truncate">{m.title}</p>

                    <span
                      className={[
                        "text-[10.5px] px-2 py-0.5 rounded-full border bg-white/[0.03] shrink-0",
                        m.done ? "border-[#B55CFF]/40 text-white/90" : "border-white/10 text-white/70",
                      ].join(" ")}
                    >
                      {m.badge}
                    </span>
                  </div>

                  <p className="text-xs text-[#9A8CA8] mt-1">{m.desc}</p>

                  {m.locked ? (
                    <p className="text-[11px] text-white/50 mt-2">
                      Completa el paso anterior para desbloquear.
                    </p>
                  ) : null}
                </div>
              </div>

              <button
                onClick={() => {
                  if (m.locked) return;

                  // ✅ marcamos flags soft cuando corresponda
                  if (m.to === ROUTES.generateAudit) {
                    safeSetLS("adray_first_audit_started", "1");
                    setFirstAuditStarted(true);
                  }
                  if (m.to === ROUTES.audits) {
                    safeSetLS("adray_audits_seen", "1");
                    setAuditsVisited(true);
                  }

                  nav(m.to);
                }}
                disabled={!!m.locked}
                className="
                  shrink-0 inline-flex items-center gap-1.5
                  text-xs px-3 py-2 rounded-xl border
                  border-white/10 bg-white/[0.02] text-white/80
                  hover:bg-white/[0.05] transition-colors
                  disabled:opacity-50 disabled:hover:bg-white/[0.02]
                "
                title="Abrir"
              >
                Abrir <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
