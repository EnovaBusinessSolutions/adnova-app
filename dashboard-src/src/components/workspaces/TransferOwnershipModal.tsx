import { useState } from "react";
import { toast } from "sonner";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useWorkspaceMembers, type Member } from "@/hooks/useWorkspaceMembers";

async function postTransferOwnership(args: { workspaceId: string; targetUserId: string }) {
  const res = await fetch(`/api/workspaces/${args.workspaceId}/transfer-ownership`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ targetUserId: args.targetUserId }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json.error || `HTTP ${res.status}`);
    (err as any).code = json.error;
    throw err;
  }
  return json;
}

function getName(m: Member): string {
  const u = m.userId;
  if (u.firstName && u.lastName) return `${u.firstName} ${u.lastName}`;
  if (u.name) return u.name;
  return u.email;
}

export function TransferOwnershipModal({
  open, onOpenChange,
}: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { activeWorkspace, refresh } = useWorkspace();
  const queryClient = useQueryClient();
  const wsId = activeWorkspace?._id || null;
  const { data: members = [] } = useWorkspaceMembers(wsId);

  const [selected, setSelected] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: postTransferOwnership,
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: ["me", "workspaces"] });
      queryClient.invalidateQueries({ queryKey: ["workspace", wsId, "members"] });
      await refresh();
      toast.success("Ownership transferido");
      onOpenChange(false);
      setSelected(null);
    },
    onError: (err: any) => {
      toast.error(err?.code || "No se pudo transferir");
    },
  });

  const eligibleMembers = members.filter((m) => m.role !== "OWNER" && m.status === "ACTIVE");

  function handleConfirm() {
    if (!wsId || !selected) return;
    mutation.mutate({ workspaceId: wsId, targetUserId: selected });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) setSelected(null); }}>
      <DialogContent className="border-white/10 bg-[#0B0B0D] text-white">
        <DialogHeader>
          <DialogTitle>Transferir ownership</DialogTitle>
          <DialogDescription className="text-white/60">
            El nuevo Owner tendrá control total del workspace. Tú quedarás como Admin
            y perderás privilegios de Owner. Esta acción es irreversible.
          </DialogDescription>
        </DialogHeader>

        {eligibleMembers.length === 0 ? (
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 text-center text-sm text-white/60">
            No hay miembros elegibles. Invita primero a alguien y luego podrás transferir.
          </div>
        ) : (
          <div className="max-h-72 space-y-2 overflow-y-auto">
            {eligibleMembers.map((m) => (
              <label
                key={m._id}
                className={[
                  "flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition",
                  selected === m.userId._id
                    ? "border-[#B55CFF]/50 bg-[#B55CFF]/10"
                    : "border-white/10 bg-white/[0.03] hover:border-white/20",
                ].join(" ")}
              >
                <input
                  type="radio"
                  name="target"
                  checked={selected === m.userId._id}
                  onChange={() => setSelected(m.userId._id)}
                  className="accent-[#B55CFF]"
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-white">{getName(m)}</div>
                  <div className="truncate text-xs text-white/50">{m.userId.email}</div>
                </div>
                <div className="text-xs text-white/40">{m.role}</div>
              </label>
            ))}
          </div>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="border-white/10 bg-white/[0.04] text-white"
          >
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={handleConfirm}
            disabled={!selected || mutation.isPending || eligibleMembers.length === 0}
            className="bg-[#B55CFF] text-white hover:bg-[#A664FF]"
          >
            {mutation.isPending ? "Transfiriendo…" : "Confirmar transferencia"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
