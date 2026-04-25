// dashboard-src/src/lib/apiFetch.ts
//
// Wrapper de fetch que automáticamente agrega el header X-Workspace-Id
// con el workspace activo del usuario.
//
// Uso:
//   1. En el árbol React, llamar `useSyncApiWorkspace()` una vez (lo hace App.tsx).
//   2. En cualquier parte (servicios, hooks, etc.) usar `apiFetch(url, options)`.
//
// Por ahora NO se aplica a hooks legacy. Se queda disponible para migración
// gradual cuando el backend filtre por workspace en cada endpoint.

import { useEffect } from "react";
import { useWorkspace } from "@/contexts/WorkspaceContext";

let cachedWorkspaceId: string | null = null;

/**
 * Setter usado por `useSyncApiWorkspace` para mantener el id en sincronía
 * con el WorkspaceContext.
 */
export function setApiWorkspaceId(id: string | null): void {
  cachedWorkspaceId = id;
}

/**
 * Devuelve el workspace id actualmente cacheado para apiFetch.
 * Útil para debugging.
 */
export function getApiWorkspaceId(): string | null {
  return cachedWorkspaceId;
}

/**
 * Wrapper de fetch que:
 * - Agrega `credentials: "include"` por default.
 * - Agrega header `X-Workspace-Id: <id>` cuando hay workspace activo.
 * - Respeta cualquier header que el caller haya seteado explícitamente.
 *
 * Uso típico:
 *   const res = await apiFetch("/api/me");
 *   const json = await res.json();
 */
export async function apiFetch(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const headers = new Headers(options.headers);

  if (cachedWorkspaceId && !headers.has("X-Workspace-Id")) {
    headers.set("X-Workspace-Id", cachedWorkspaceId);
  }

  return fetch(url, {
    credentials: "include",
    ...options,
    headers,
  });
}

/**
 * Hook que sincroniza el workspace activo del context con el cache global.
 * Debe colocarse UNA VEZ en el árbol, dentro de WorkspaceProvider, idealmente
 * en el root del routing (AppRoutes).
 */
export function useSyncApiWorkspace(): void {
  const { activeWorkspace } = useWorkspace();
  const id = activeWorkspace?._id || null;

  useEffect(() => {
    setApiWorkspaceId(id);
    return () => {
      // Si el provider se desmonta (ej. logout), limpiamos el cache.
      setApiWorkspaceId(null);
    };
  }, [id]);
}
