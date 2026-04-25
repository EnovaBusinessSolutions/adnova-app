import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { useWorkspace } from "@/contexts/WorkspaceContext";

async function deleteWorkspace(workspaceId: string) {
  const res = await fetch(`/api/workspaces/${workspaceId}`, {
    method: "DELETE",
    credentials: "include",
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json.error || `HTTP ${res.status}`);
    (err as any).code = json.error;
    throw err;
  }
  return json;
}

export function DeleteWorkspaceModal({
  open, onOpenChange,
}: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { activeWorkspace, workspaces, switchWorkspace } = useWorkspace();
  const [confirm, setConfirm] = useState("");

  const wsName = activeWorkspace?.name || "";
  const matches = confirm.trim() === wsName;

  const mutation = useMutation({
    mutationFn: deleteWorkspace,
    onSuccess: async () => {
      toast.success("Workspace eliminado");
      const remaining = workspaces.filter((w) => w._id !== activeWorkspace?._id);
      queryClient.invalidateQueries({ queryKey: ["me", "workspaces"] });
      if (remaining.length > 0) {
        await switchWorkspace(remaining[0]._id);
        navigate("/");
      } else {
        window.location.href = "/onboarding";
      }
      onOpenChange(false);
      setConfirm("");
    },
    onError: (err: any) => {
      toast.error(err?.code || "No se pudo eliminar");
    },
  });

  function handleConfirm() {
    if (!matches || !activeWorkspace) return;
    mutation.mutate(activeWorkspace._id);
  }

  if (!activeWorkspace) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) setConfirm(""); }}>
      <DialogContent className="border-rose-500/30 bg-[#0B0B0D] text-white">
        <DialogHeader>
          <DialogTitle className="text-rose-400">Eliminar este workspace</DialogTitle>
          <DialogDescription className="text-white/60">
            Esta acción es irreversible. Todos los datos del workspace quedarán
            inaccesibles para ti y tus compañeros. Las invitaciones pendientes
            serán canceladas.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label className="text-white/70">
            Para confirmar, escribe el nombre del workspace: <span className="font-mono text-white">{wsName}</span>
          </Label>
          <Input
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder={wsName}
            className="border-white/10 bg-white/[0.04] text-white"
          />
        </div>

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
            disabled={!matches || mutation.isPending}
            className="bg-rose-500 text-white hover:bg-rose-600"
          >
            {mutation.isPending ? "Eliminando…" : "Eliminar workspace"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
