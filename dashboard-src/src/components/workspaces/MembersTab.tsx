import { useState } from "react";
import { MoreHorizontal, Crown } from "lucide-react";
import { toast } from "sonner";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";

import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useWorkspaceMembers, useChangeMemberRole, useRemoveMember, type Member } from "@/hooks/useWorkspaceMembers";
import { usePermission } from "@/hooks/usePermission";
import { ROLE_LABELS } from "@/config/workspaceCatalogs";

function getInitials(m: Member): string {
  const u = m.userId;
  if (u.firstName && u.lastName) return `${u.firstName[0]}${u.lastName[0]}`.toUpperCase();
  if (u.name) return u.name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();
  return (u.email[0] || "?").toUpperCase();
}

function getDisplayName(m: Member): string {
  const u = m.userId;
  if (u.firstName && u.lastName) return `${u.firstName} ${u.lastName}`;
  if (u.name) return u.name;
  return u.email;
}

export function MembersTab() {
  const { activeWorkspace } = useWorkspace();
  const wsId = activeWorkspace?._id || null;
  const { data: members = [], isLoading } = useWorkspaceMembers(wsId);
  const canChangeRole = usePermission("members.changeRole");
  const canRemove = usePermission("members.remove");

  const changeRole = useChangeMemberRole();
  const removeMember = useRemoveMember();

  const [confirmRemove, setConfirmRemove] = useState<Member | null>(null);

  async function handleChangeRole(m: Member, role: "ADMIN" | "MEMBER") {
    if (!wsId) return;
    try {
      await changeRole.mutateAsync({ workspaceId: wsId, userId: m.userId._id, role });
      toast.success(`${getDisplayName(m)} ahora es ${ROLE_LABELS[role]}`);
    } catch (err: any) {
      toast.error(err?.code || "No se pudo cambiar el rol");
    }
  }

  async function handleConfirmRemove() {
    if (!confirmRemove || !wsId) return;
    try {
      await removeMember.mutateAsync({ workspaceId: wsId, userId: confirmRemove.userId._id });
      toast.success(`${getDisplayName(confirmRemove)} fue removido del workspace`);
      setConfirmRemove(null);
    } catch (err: any) {
      toast.error(err?.code || "No se pudo remover el miembro");
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[...Array(3)].map((_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded-2xl" />
        ))}
      </div>
    );
  }

  return (
    <>
      <div className="space-y-2">
        {members.map((m) => {
          const isOwner = m.role === "OWNER";
          const showActions = (canChangeRole || canRemove) && !isOwner;
          return (
            <div
              key={m._id}
              className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3"
            >
              <Avatar className="h-9 w-9">
                <AvatarFallback className="bg-gradient-to-br from-[#B55CFF] to-[#7c6df0] text-xs font-semibold text-white">
                  {getInitials(m)}
                </AvatarFallback>
              </Avatar>

              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-white">
                  {getDisplayName(m)}
                </div>
                <div className="truncate text-xs text-white/50">{m.userId.email}</div>
              </div>

              <div className="flex items-center gap-2">
                {isOwner ? (
                  <Badge className="gap-1 border-[#B55CFF]/30 bg-[#B55CFF]/15 text-[#B55CFF]">
                    <Crown className="h-3 w-3" />
                    Owner
                  </Badge>
                ) : (
                  <Badge className="border-white/10 bg-white/[0.06] text-white/70">
                    {ROLE_LABELS[m.role]}
                  </Badge>
                )}

                {showActions && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-white/50 hover:bg-white/[0.06]">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="border-white/10 bg-[#0B0B0D] text-white">
                      {canChangeRole && m.role !== "ADMIN" && (
                        <DropdownMenuItem onSelect={() => handleChangeRole(m, "ADMIN")}>
                          Cambiar a Admin
                        </DropdownMenuItem>
                      )}
                      {canChangeRole && m.role !== "MEMBER" && (
                        <DropdownMenuItem onSelect={() => handleChangeRole(m, "MEMBER")}>
                          Cambiar a Member
                        </DropdownMenuItem>
                      )}
                      {canRemove && (
                        <DropdownMenuItem
                          onSelect={() => setConfirmRemove(m)}
                          className="text-rose-400 focus:text-rose-400"
                        >
                          Remover del workspace
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <AlertDialog open={!!confirmRemove} onOpenChange={(open) => !open && setConfirmRemove(null)}>
        <AlertDialogContent className="border-white/10 bg-[#0B0B0D] text-white">
          <AlertDialogHeader>
            <AlertDialogTitle>¿Remover a {confirmRemove ? getDisplayName(confirmRemove) : ""}?</AlertDialogTitle>
            <AlertDialogDescription className="text-white/60">
              Esta persona perderá acceso a este workspace inmediatamente. Puedes volver a invitarla después.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-white/10 bg-white/[0.04] text-white hover:bg-white/[0.07]">
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmRemove}
              className="bg-rose-500 text-white hover:bg-rose-600"
            >
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
