// dashboard-src/src/contexts/WorkspaceContext.tsx
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export type WorkspaceRole = "OWNER" | "ADMIN" | "MEMBER";

export type Workspace = {
  _id: string;
  slug: string;
  name: string;
  icon: string;
  industryVertical: string | null;
  ownerUserId: string;
  plan: string;
  onboardingComplete: boolean;
  createdAt: string;
  updatedAt: string;
  role: WorkspaceRole;
};

type WorkspaceContextValue = {
  workspaces: Workspace[];
  activeWorkspace: Workspace | null;
  role: WorkspaceRole | null;
  isLoading: boolean;
  hasError: boolean;
  refresh: () => Promise<void>;
  switchWorkspace: (workspaceId: string) => Promise<void>;
};

const Ctx = createContext<WorkspaceContextValue | null>(null);

async function fetchMeWorkspaces(): Promise<{
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
}> {
  const res = await fetch("/api/me/workspaces", { credentials: "include" });
  if (!res.ok) {
    if (res.status === 401) {
      // No autenticado: el dashboard ya tiene su propio guard via ensureAuthenticated.
      // Devolvemos vacío para no romper el árbol.
      return { workspaces: [], activeWorkspaceId: null };
    }
    throw new Error(`HTTP ${res.status}`);
  }
  return res.json();
}

async function putActiveWorkspace(workspaceId: string): Promise<void> {
  const res = await fetch("/api/me/active-workspace", {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspaceId }),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["me", "workspaces"],
    queryFn: fetchMeWorkspaces,
    retry: 1,
    staleTime: 30_000,
  });

  const switchMutation = useMutation({
    mutationFn: putActiveWorkspace,
    onSuccess: () => {
      // Invalida workspaces; otras queries del dashboard se refrescarán solas
      // cuando el usuario navegue (Fase 5C agregará el workspaceId header).
      queryClient.invalidateQueries({ queryKey: ["me", "workspaces"] });
    },
  });

  const value = useMemo<WorkspaceContextValue>(() => {
    const workspaces = data?.workspaces || [];
    const activeId = data?.activeWorkspaceId || null;
    const activeWorkspace =
      workspaces.find((w) => w._id === activeId) || workspaces[0] || null;

    return {
      workspaces,
      activeWorkspace,
      role: activeWorkspace?.role || null,
      isLoading,
      hasError: !!isError,
      refresh: async () => {
        await refetch();
      },
      switchWorkspace: async (workspaceId: string) => {
        await switchMutation.mutateAsync(workspaceId);
      },
    };
  }, [data, isLoading, isError, refetch, switchMutation]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) {
    throw new Error("useWorkspace debe usarse dentro de <WorkspaceProvider>");
  }
  return ctx;
}
