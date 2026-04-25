import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useCurrentUser } from '@/hooks/useCurrentUser';

import Step1Workspace from '@/pages/Step1Workspace';
import Step2Profile from '@/pages/Step2Profile';
import Step3Team from '@/pages/Step3Team';
import Success from '@/pages/Success';
import AcceptInvitation from '@/pages/AcceptInvitation';

function NotAuthScreen() {
  const location = useLocation();
  const returnTo = encodeURIComponent(`/onboarding${location.pathname}${location.search}`);
  return (
    <div className="min-h-screen bg-bg text-white flex items-center justify-center px-6">
      <div className="max-w-md text-center space-y-3">
        <h1 className="text-2xl font-semibold">Sesión requerida</h1>
        <p className="text-sm text-white/60">
          Necesitas iniciar sesión para continuar con el onboarding.
        </p>
        <a
          href={`/login?return=${returnTo}`}
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

/**
 * ResumeOnboarding: lee onboardingStep del user y redirige al step correcto
 * SOLO si está en la raíz "/" del onboarding. Si el user navega manualmente
 * a /profile o /team, respetamos su navegación (no lo obligamos a un step).
 */
function ResumeOnboarding() {
  const { data: user, isLoading } = useCurrentUser();
  const location = useLocation();

  if (isLoading) return <LoadingScreen />;
  if (!user) return <NotAuthScreen />;

  const isInvitationFlow = location.pathname.startsWith('/invitations/');
  if (isInvitationFlow) {
    return (
      <Routes>
        <Route path="/invitations/:token" element={<AcceptInvitation />} />
      </Routes>
    );
  }

  // Si ya completó el onboarding, redirect al dashboard.
  // Excepción: si está en /success, dejamos que se vea la pantalla de
  // confirmación final antes de mandar al user al dashboard. El usuario
  // hace click en "Continuar al dashboard" desde Success cuando termine.
  if (
    user.onboardingStep === 'COMPLETE' &&
    !location.pathname.startsWith('/success')
  ) {
    window.location.href = '/dashboard';
    return <LoadingScreen />;
  }

  if (location.pathname === '/' || location.pathname === '') {
    if (user.onboardingStep === 'WORKSPACE_CREATED') {
      return <Navigate to="/profile" replace />;
    }
    if (user.onboardingStep === 'PROFILE_COMPLETE') {
      return <Navigate to="/team" replace />;
    }
  }

  return (
    <Routes>
      <Route path="/" element={<Step1Workspace />} />
      <Route path="/profile" element={<Step2Profile />} />
      <Route path="/team" element={<Step3Team />} />
      <Route path="/success" element={<Success />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return <ResumeOnboarding />;
}
