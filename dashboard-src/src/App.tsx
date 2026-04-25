// dashboard-src/src/App.tsx
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
import LastStep from "./pages/LastStep";
import Signal from "./pages/Signal";
import ChatGptMcp from "./pages/ChatGptMcp";
import ClaudeMcp from "./pages/ClaudeMcp";
import GeminiMcp from "./pages/GeminiMcp";

// ✅ NUEVO: Panel interno (equipo)
import InternalAdmin from "./pages/InternalAdmin";
import { RouteGate } from "./components/RouteGate";
import { useSyncApiWorkspace } from "./lib/apiFetch";
import Attribution from "./pages/Attribution";
import BriPipeline from "./pages/BriPipeline";
import Workspaces, { WorkspacesNew } from "./pages/Workspaces";
import { WorkspaceProvider } from "./contexts/WorkspaceContext";

const queryClient = new QueryClient();

/** ✅ Basename FIX E2E (PROD SIEMPRE /dashboard) */
const BASENAME = (() => {
  // DEV (vite) corre en "/"
  if (import.meta.env.DEV) return "";

  // PROD: el dashboard vive bajo /dashboard (forzado)
  return "/dashboard";
})();

/**
 * ✅ Carga del motor externo (public/js/onboardingInlineSelect.js)
 * - DEV:  /js/onboardingInlineSelect.js
 * - PROD: /dashboard/js/onboardingInlineSelect.js
 *
 * Nota: Si el archivo no existe en /public/js, esto dará 404.
 * Debes crear/ubicar: dashboard-src/public/js/onboardingInlineSelect.js
 */
function ensureAsmLoaded() {
  const id = "adnova-asm-script";
  if (document.getElementById(id)) return;

  const base = import.meta.env.DEV ? "" : "/dashboard";
  const src = `${base}/js/onboardingInlineSelect.js`;

  const s = document.createElement("script");
  s.id = id;
  s.src = src;
  s.async = true;
  s.defer = true;

  s.onload = () => {
    // eslint-disable-next-line no-console
    console.log("[ASM] loaded", { src, hasASM: !!(window as any).ADNOVA_ASM });
  };

  s.onerror = () => {
    // eslint-disable-next-line no-console
    console.warn("[ASM] failed to load", { src });
  };

  document.body.appendChild(s);
}

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
    if (!r.ok) return { authenticated: false, user: null, intercom: null };
    const json = await r.json();
    return {
      authenticated: !!json?.authenticated,
      user: json?.user || null,
      intercom: json?.intercom || null,
    };
  } catch {
    return { authenticated: false, user: null, intercom: null };
  }
}

function bootIdentifiedFromServer(intercomPayload: Record<string, any>) {
  const payload: Record<string, any> = {
    ...intercomPayload,
    app_area: "dashboard",
  };
  Object.keys(payload).forEach((k) => {
    if (payload[k] === null || payload[k] === undefined) delete payload[k];
  });

  shutdownIntercom();
  window.intercomSettings = payload;
  intercomCall("boot", payload);
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

      // Use app_id from server if available (A.2)
      const appIdFromServer = sess?.intercom?.app_id;
      const appId = appIdFromServer || INTERCOM_APP_ID;
      ensureIntercomLoaded(appId);

      if (sess.authenticated && sess.user?._id) {
        const uid = String(sess.user._id);

        // Si cambió el usuario o no estaba identificado, re-boot identificado
        if (bootedModeRef.current !== "identified" || lastUserIdRef.current !== uid) {
          // Use server payload (includes HMAC user_hash) when available
          if (sess.intercom && sess.intercom.user_id) {
            bootIdentifiedFromServer(sess.intercom);
          } else {
            bootIdentified(sess.user);
          }
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
      intercomCall("update");
      intercomCall("update", {
        last_seen_page: `${location.pathname}${location.search || ""}`,
      });
    } catch {}
  }, [location.pathname, location.search]);
}

/** Redirect real a backend (logout NO debe ser SPA) */
function LogoutRedirect() {
  useEffect(() => {
    try {
      shutdownIntercom();
    } catch {}
    window.location.href = "/logout";
  }, []);
  return null;
}

function AppRoutes() {
  usePixelsPageViews();
  useIntercomE2E();
  useSyncApiWorkspace();

  return (
    <Routes>
      {/* Página principal */}
      <Route
        index
        element={
          <RouteGate permission="dashboard.connect" redirectTo="/laststep">
            <Index />
          </RouteGate>
        }
      />

      <Route path="laststep" element={<LastStep />} />
      <Route path="signal" element={<Signal />} />
      <Route path="chatgptmcp" element={<ChatGptMcp />} />
      <Route path="claudemcp" element={<ClaudeMcp />} />
      <Route path="geminimcp" element={<GeminiMcp />} />

      {/* ✅ Panel interno (equipo) */}
      <Route path="internal" element={<InternalAdmin />} />
      <Route path="bri" element={<BriPipeline />} />

      {/* ✅ Rutas /start */}
      <Route path="meta-ads/start" element={<MetaAds />} />
      <Route path="google-ads/start" element={<GoogleAds />} />

      {/* ⚠️ Canonical en este repo: google-analytics/start */}
      <Route path="google-analytics/start" element={<GoogleAnalytics />} />

      {/* ✅ Alias por compat: /google-ga4/start */}
      <Route path="google-ga4/start" element={<GoogleAnalytics />} />

      {/* Rutas internas reales */}
      <Route path="site-audit" element={<SiteAudit />} />
      <Route path="pixel-checker" element={<PixelChecker />} />
      <Route path="google-ads" element={<GoogleAds />} />
      <Route path="google-analytics" element={<GoogleAnalytics />} />
      <Route path="meta-ads" element={<MetaAds />} />
      <Route path="creative-intelligence" element={<CreativeIntelligence />} />
      <Route path="generate-audit" element={<GenerateAudit />} />
      <Route path="attribution" element={<Attribution />} />
      <Route path="settings" element={<Settings />} />
      <Route path="studio" element={<Studio />} />

      {/* ✅ ALIAS / COMPAT */}
      <Route path="audits" element={<SiteAudit />} />
      <Route path="plans" element={<ComingSoon title="Planes" />} />

      {/* ✅ Logout real (full reload) */}
      <Route path="logout" element={<LogoutRedirect />} />

      {/* Workspaces (placeholder, Fase 5B implementará el panel real) */}
      <Route path="workspaces" element={<Workspaces />} />
      <Route path="workspaces/new" element={<WorkspacesNew />} />

      {/* 404 local del SPA */}
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

const App = () => {
  // ✅ Cargar ASM globalmente para que Settings.tsx pueda abrir el selector
  useEffect(() => {
    ensureAsmLoaded();
  }, []);

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
          <WorkspaceProvider>
            <AppRoutes />
          </WorkspaceProvider>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
};

export default App;