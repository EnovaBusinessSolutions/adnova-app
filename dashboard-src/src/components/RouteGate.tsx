// dashboard-src/src/components/RouteGate.tsx
//
// Componente que envuelve un children y permite verlos solo si el rol del
// workspace activo tiene el permission requerido. En caso contrario, redirige
// al fallback.
//
// Uso:
//   <RouteGate permission="dashboard.connect" redirectTo="/laststep">
//     <Index />
//   </RouteGate>
//
// Si el contexto está cargando, muestra null (el WorkspaceContext maneja
// el loading inicial). Si no hay workspace activo (caso edge), tampoco
// renderiza children y redirige.

import { type ReactNode } from "react";
import { Navigate } from "react-router-dom";

import { useWorkspace } from "@/contexts/WorkspaceContext";
import { canDo, type PermissionAction, type WorkspaceRole } from "@/config/permissions";

export interface RouteGateProps {
  permission: PermissionAction;
  redirectTo: string;
  children: ReactNode;
}

export function RouteGate({ permission, redirectTo, children }: RouteGateProps) {
  const { role, isLoading, hasError, workspaces } = useWorkspace();

  // Mientras el contexto carga, no decidimos nada todavía.
  if (isLoading) return null;

  // Si hubo error cargando workspaces o no hay ninguno, no podemos validar
  // el rol. Dejamos pasar (el WorkspaceContext / endpoint reportará el error
  // por su cuenta).
  if (hasError || workspaces.length === 0) {
    return <>{children}</>;
  }

  if (canDo(role as WorkspaceRole | null, permission)) {
    return <>{children}</>;
  }

  return <Navigate to={redirectTo} replace />;
}
