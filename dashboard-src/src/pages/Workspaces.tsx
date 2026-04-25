// dashboard-src/src/pages/Workspaces.tsx
//
// Placeholder. La implementación real (panel de members, settings,
// invitations, etc.) viene en Fase 5B.

import { Link } from "react-router-dom";

export default function Workspaces() {
  return (
    <div className="min-h-[70vh] flex items-center justify-center px-6">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/[0.04] p-6 text-center">
        <div className="text-xs uppercase tracking-widest text-[#B55CFF]">Próximamente</div>
        <div className="mt-2 text-lg font-semibold text-white">Gestión de workspaces</div>
        <div className="mt-2 text-sm text-white/60">
          Aquí podrás administrar miembros, invitaciones y la configuración de tus workspaces.
          Estamos terminando esta sección.
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

export function WorkspacesNew() {
  return (
    <div className="min-h-[70vh] flex items-center justify-center px-6">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/[0.04] p-6 text-center">
        <div className="text-xs uppercase tracking-widest text-[#B55CFF]">Próximamente</div>
        <div className="mt-2 text-lg font-semibold text-white">Crear nuevo workspace</div>
        <div className="mt-2 text-sm text-white/60">
          Para crear un segundo workspace, esta acción te llevará al onboarding pre-cargado.
          Estamos terminando esta integración.
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
