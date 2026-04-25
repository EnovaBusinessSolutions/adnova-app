import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { useWorkspace } from "@/contexts/WorkspaceContext";
import { usePermission } from "@/hooks/usePermission";
import { getWorkspaceIcon } from "@/config/workspaceCatalogs";

import { MembersTab } from "@/components/workspaces/MembersTab";
import { InvitationsTab } from "@/components/workspaces/InvitationsTab";
import { SettingsTab } from "@/components/workspaces/SettingsTab";
import { CreateWorkspaceModal } from "@/components/workspaces/CreateWorkspaceModal";

export default function Workspaces() {
  const location = useLocation();
  const navigate = useNavigate();
  const { activeWorkspace, isLoading } = useWorkspace();

  const canSeeInvitations = usePermission("invitations.view");
  const canSeeSettings = usePermission("workspace.update.name");

  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    if (location.pathname === "/workspaces/new") {
      setCreateOpen(true);
    }
  }, [location.pathname]);

  function handleCloseCreate(open: boolean) {
    setCreateOpen(open);
    if (!open && location.pathname === "/workspaces/new") {
      navigate("/workspaces", { replace: true });
    }
  }

  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-white/40">
        Cargando workspace…
      </div>
    );
  }

  if (!activeWorkspace) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center px-6">
        <div className="max-w-md space-y-3 text-center">
          <h2 className="text-xl font-semibold text-white">No hay workspace activo</h2>
          <p className="text-sm text-white/60">
            Crea uno nuevo para empezar a colaborar.
          </p>
          <button
            onClick={() => setCreateOpen(true)}
            className="rounded-xl bg-[#B55CFF] px-6 py-3 text-sm font-semibold text-white hover:bg-[#A664FF]"
          >
            Crear workspace
          </button>
        </div>
        <CreateWorkspaceModal open={createOpen} onOpenChange={handleCloseCreate} />
      </div>
    );
  }

  const ActiveIcon = getWorkspaceIcon(activeWorkspace.icon);

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      {/* Header */}
      <div className="mb-8 flex items-center gap-4">
        <div className="grid h-14 w-14 place-items-center rounded-2xl border border-white/10 bg-white/[0.04]">
          <ActiveIcon className="h-7 w-7 text-white/80" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-semibold text-white">{activeWorkspace.name}</h1>
          <div className="text-sm text-white/50">adray.ai/{activeWorkspace.slug}</div>
        </div>
      </div>

      <Tabs defaultValue="members" className="w-full">
        <TabsList className="border-white/10 bg-white/[0.04]">
          <TabsTrigger value="members">Miembros</TabsTrigger>
          {canSeeInvitations && <TabsTrigger value="invitations">Invitaciones</TabsTrigger>}
          {canSeeSettings && <TabsTrigger value="settings">Configuración</TabsTrigger>}
        </TabsList>

        <TabsContent value="members" className="mt-6">
          <MembersTab />
        </TabsContent>

        {canSeeInvitations && (
          <TabsContent value="invitations" className="mt-6">
            <InvitationsTab />
          </TabsContent>
        )}

        {canSeeSettings && (
          <TabsContent value="settings" className="mt-6">
            <SettingsTab />
          </TabsContent>
        )}
      </Tabs>

      <CreateWorkspaceModal open={createOpen} onOpenChange={handleCloseCreate} />
    </div>
  );
}

// La ruta /workspaces/new la maneja Workspaces directamente vía useEffect.
export const WorkspacesNew = Workspaces;
