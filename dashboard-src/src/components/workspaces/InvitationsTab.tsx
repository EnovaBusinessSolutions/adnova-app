import { useState } from "react";
import { Mail, X, Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useWorkspaceInvitations, useRevokeInvitation, type Invitation } from "@/hooks/useWorkspaceInvitations";
import { usePermission } from "@/hooks/usePermission";
import { ROLE_LABELS } from "@/config/workspaceCatalogs";
import { InviteMemberModal } from "./InviteMemberModal";

function formatDate(s: string): string {
  try {
    const d = new Date(s);
    return d.toLocaleDateString("es-MX", { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return s;
  }
}

export function InvitationsTab() {
  const { activeWorkspace } = useWorkspace();
  const wsId = activeWorkspace?._id || null;
  const canInvite = usePermission("invitations.create");
  const canRevoke = usePermission("invitations.revoke");

  const { data: invitations = [], isLoading } = useWorkspaceInvitations(wsId);
  const revoke = useRevokeInvitation();

  const [inviteOpen, setInviteOpen] = useState(false);

  async function handleRevoke(inv: Invitation) {
    if (!wsId) return;
    try {
      await revoke.mutateAsync({ workspaceId: wsId, invitationId: inv._id });
      toast.success(`Invitación a ${inv.email} revocada`);
    } catch (err: any) {
      toast.error(err?.code || "No se pudo revocar la invitación");
    }
  }

  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <div className="text-sm text-white/60">
          {invitations.length === 0
            ? "No hay invitaciones pendientes."
            : `${invitations.length} invitaciones pendientes`}
        </div>
        {canInvite && (
          <Button
            onClick={() => setInviteOpen(true)}
            className="bg-[#B55CFF] text-white hover:bg-[#A664FF]"
          >
            <Plus className="mr-2 h-4 w-4" />
            Invitar miembro
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[...Array(2)].map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-2xl" />
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {invitations.map((inv) => (
            <div
              key={inv._id}
              className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3"
            >
              <div className="grid h-9 w-9 place-items-center rounded-full border border-white/10 bg-white/[0.04]">
                <Mail className="h-4 w-4 text-white/60" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-white">{inv.email}</div>
                <div className="text-xs text-white/50">
                  {ROLE_LABELS[inv.role]} · expira {formatDate(inv.expiresAt)}
                </div>
              </div>
              {canRevoke && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleRevoke(inv)}
                  className="text-white/50 hover:bg-white/[0.06] hover:text-rose-400"
                >
                  <X className="mr-1 h-4 w-4" />
                  Revocar
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      <InviteMemberModal open={inviteOpen} onOpenChange={setInviteOpen} workspaceId={wsId} />
    </>
  );
}
