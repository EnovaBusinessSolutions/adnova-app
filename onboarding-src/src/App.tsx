import { Routes, Route, Navigate } from "react-router-dom";
import { useCurrentUser } from "@/hooks/useCurrentUser";

import Step1Workspace from "@/pages/Step1Workspace";
import Success from "@/pages/Success";

function NotAuthScreen() {
  return (
    <div className="min-h-screen bg-bg text-white flex items-center justify-center px-6">
      <div className="max-w-md text-center space-y-3">
        <h1 className="text-2xl font-semibold">Sesión requerida</h1>
        <p className="text-sm text-white/60">
          Necesitas iniciar sesión para continuar con el onboarding.
        </p>
        <a
          href="/login"
          className="inline-block rounded-xl bg-accent px-6 py-3 text-sm font-semibold text-white hover:bg-accent-hover"
        >
          Iniciar sesión
        </a>
      </div>
    </div>
  );
}

function LoadingScreen() {
  return (
    <div className="min-h-screen bg-bg text-white flex items-center justify-center">
      <div className="text-sm text-white/40">Cargando…</div>
    </div>
  );
}

function Router() {
  const { data: user, isLoading } = useCurrentUser();

  if (isLoading) return <LoadingScreen />;
  if (!user) return <NotAuthScreen />;

  // Guard: si el user ya tiene workspace, lo mandamos al dashboard.
  // Esto evita que un user existente se quede atrapado en el onboarding.
  if (user.defaultWorkspaceId) {
    window.location.href = "/dashboard";
    return <LoadingScreen />;
  }

  return (
    <Routes>
      <Route path="/" element={<Step1Workspace />} />
      <Route path="/success" element={<Success />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return <Router />;
}
