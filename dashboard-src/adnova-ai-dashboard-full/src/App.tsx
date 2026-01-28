import { useEffect, useRef } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Link, useLocation } from "react-router-dom";

import { usePixelsPageViews } from "./hooks/usePixelsPageViews";

import Index from "./pages/Index";
import SiteAudit from "./pages/SiteAudit";
import PixelChecker from "./pages/PixelChecker";
import GoogleAds from "./pages/GoogleAds";
import GoogleAnalytics from "./pages/GoogleAnalytics";
import MetaAds from "./pages/MetaAds";
import CreativeIntelligence from "./pages/CreativeIntelligence";
import Settings from "./pages/Settings";
import GenerateAudit from "./pages/GenerateAudit";
import NotFound from "./pages/NotFound";
import Studio from "./pages/Studio";

const queryClient = new QueryClient();

/** Basename robusto (Vite) */
const BASENAME = (() => {
  // En desarrollo (npm run dev), BASE_URL es "/" 
  // En producción (build), BASE_URL es "/dashboard/"
  const raw = import.meta.env.BASE_URL || "/";
  // BrowserRouter espera sin trailing slash, excepto "/"
  if (raw === "/") return "";
  return String(raw).replace(/\/$/, "");
})();

/** Página simple para rutas que aún no existen (evita 404 feo) */
function ComingSoon({ title }: { title: string }) {
  return (
    <div className="min-h-[70vh] flex items-center justify-center px-6">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/[0.04] p-6 text-center">
        <div className="text-lg font-semibold text-white">{title}</div>
        <div className="mt-2 text-sm text-white/60">
          Este módulo está en proceso de activación. Muy pronto estará disponible aquí.
        </div>
        <Link
          to="/"
          className="mt-5 inline-flex items-center justify-center rounded-xl border border-white/10 bg-white/[0.06] px-4 py-2 text-sm text-white/85 hover:bg-white/[0.09]"
        >
          Volver al panel
        </Link>
      </div>
    </div>
  );
}

/* ================================
   ✅ INTERCOM (SPA) — E2E
================================== */

declare global {
  interface Window {
    Intercom?: (...args: any[]) => void;
    intercomSettings?: any;
  }
}

const INTERCOM_APP_ID = "sqexnuzh";

function intercomCall(...args: any[]) {
  try {
    if (typeof window.Intercom === "function") window.Intercom(...args);
  } catch {}
}

function ensureIntercomLoaded(appId: string) {
  // Si ya existe el script o el stub, no duplicamos
  if (typeof window.Intercom === "function" && (window.Intercom as any).__initialized) return;
  if (document.getElementById("intercom-script")) return;

  // Stub recomendado (permite llamar Intercom() antes de que cargue)
  const w = window as any;
  const ic = w.Intercom;
  if (typeof ic !== "function") {
    const intercomStub = function (...args: any[]) {
      (intercomStub as any).q.push(args);
    } as any;
    intercomStub.q = [];
    w.Intercom = intercomStub;
  }

  // Marca para no re-inicializar
  (w.Intercom as any).__initialized = true;

  // Inyectar script
  const s = document.createElement("script");
  s.id = "intercom-script";
  s.type = "text/javascript";
  s.async = true;
  s.src = `https://widget.intercom.io/widget/${appId}`;
  document.head.appendChild(s);
}

function bootAnonymous() {
  window.intercomSettings = { app_id: INTERCOM_APP_ID };
  intercomCall("boot", { app_id: INTERCOM_APP_ID });
}

function shutdownIntercom() {
  intercomCall("shutdown");
}

function bootIdentified(user: any) {
  // created_at: UNIX seconds (Intercom)
  const createdAtMs = user?.createdAt ? Date.parse(user.createdAt) : null;
  const created_at = createdAtMs ? Math.floor(createdAtMs / 1000) : undefined;

  const name =
    user?.name ||
    user?.fullName ||
    user?.nombre ||
    user?.displayName ||
    (user?.firstName && user?.lastName ? `${user.firstName} ${user.lastName}` : undefined);

  const payload: Record<string, any> = {
    app_id: INTERCOM_APP_ID,
    user_id: user?._id ? String(user._id) : undefined,
    email: user?.email || undefined,
    name: name || undefined,
    created_at,

    // atributos útiles (opcionales)
    user_plan: user?.plan || user?.subscriptionPlan || undefined,
    app_area: "dashboard",
  };

  Object.keys(payload).forEach((k) => payload[k] === undefined && delete payload[k]);

  // Reset fuerte para evitar mezclar usuario anterior
  shutdownIntercom();
  window.intercomSettings = payload;
  intercomCall("boot", payload);
}

async function fetchSessionSafe() {
  try {
    const r = await fetch("/api/session", { credentials: "include" });
    if (!r.ok) return { authenticated: false, user: null };
    const json = await r.json();
    const authenticated = !!json?.authenticated;
    const user = json?.user || null;
    return { authenticated, user };
  } catch {
    return { authenticated: false, user: null };
  }
}

function useIntercomE2E() {
  const location = useLocation();
  const bootedModeRef = useRef<"none" | "anon" | "identified">("none");
  const lastUserIdRef = useRef<string | null>(null);

  // 1) Cargar script + boot anónimo temprano
  useEffect(() => {
    ensureIntercomLoaded(INTERCOM_APP_ID);

    // Boot anónimo si aún no se hizo
    if (bootedModeRef.current === "none") {
      bootAnonymous();
      bootedModeRef.current = "anon";
      lastUserIdRef.current = null;
    }
  }, []);

  // 2) Identificar cuando haya sesión
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const sess = await fetchSessionSafe();
      if (cancelled) return;

      if (sess.authenticated && sess.user?._id) {
        const uid = String(sess.user._id);

        // Si cambió el usuario o no estaba identificado, re-boot identificado
        if (bootedModeRef.current !== "identified" || lastUserIdRef.current !== uid) {
          bootIdentified(sess.user);
          bootedModeRef.current = "identified";
          lastUserIdRef.current = uid;
        } else {
          // mismo usuario → update suave
          intercomCall("update");
        }
      } else {
        // Sin sesión → asegurar modo anónimo
        if (bootedModeRef.current !== "anon") {
          shutdownIntercom();
          bootAnonymous();
          bootedModeRef.current = "anon";
          lastUserIdRef.current = null;
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // 3) Update en cada cambio de ruta (pageview virtual SPA)
  useEffect(() => {
    try {
      // Intercom detecta window.location; con update basta.
      intercomCall("update");

      // (Opcional) metadata de página
      intercomCall("update", {
        last_seen_page: `${location.pathname}${location.search || ""}`,
      });
    } catch {}
  }, [location.pathname, location.search]);
}

/** Redirect real a backend (logout NO debe ser SPA) */
function LogoutRedirect() {
  useEffect(() => {
    // ✅ Evita que el chat quede “pegado” al usuario al salir
    try {
      shutdownIntercom();
    } catch {}
    window.location.href = "/logout";
  }, []);
  return null;
}

/**
 * Este componente vive DENTRO de <BrowserRouter>,
 * por eso aquí sí podemos usar hooks de router (tu hook de pixel lo hace).
 */
function AppRoutes() {
  usePixelsPageViews();

  // ✅ Intercom E2E en el dashboard SPA
  useIntercomE2E();

  return (
    <Routes>
      {/* Página principal */}
      <Route index element={<Index />} />

      {/* Rutas internas reales */}
      <Route path="site-audit" element={<SiteAudit />} />
      <Route path="pixel-checker" element={<PixelChecker />} />
      <Route path="google-ads" element={<GoogleAds />} />
      <Route path="google-analytics" element={<GoogleAnalytics />} />
      <Route path="meta-ads" element={<MetaAds />} />
      <Route path="creative-intelligence" element={<CreativeIntelligence />} />
      <Route path="generate-audit" element={<GenerateAudit />} />
      <Route path="settings" element={<Settings />} />
      <Route path="studio" element={<Studio />} />

      {/* ✅ ALIAS / COMPAT */}
      <Route path="audits" element={<SiteAudit />} />
      <Route path="plans" element={<ComingSoon title="Planes" />} />

      {/* ✅ Logout real (full reload) */}
      <Route path="logout" element={<LogoutRedirect />} />

      {/* 404 local del SPA */}
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

const App = () => {
  useEffect(() => {
    const qs = new URLSearchParams(window.location.search);
    const sessionToken = qs.get("sessionToken");
    if (sessionToken) {
      sessionStorage.setItem("sessionToken", sessionToken);
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />

        <BrowserRouter basename={BASENAME}>
          <AppRoutes />
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
};

export default App;
