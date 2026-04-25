import { useState } from "react";
import { toast } from "sonner";

import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { useCreateInvitation } from "@/hooks/useWorkspaceInvitations";
import { INVITABLE_ROLES, isValidEmail } from "@/config/workspaceCatalogs";

const ERR_MESSAGES: Record<string, string> = {
  EMAIL_INVALID: "El email no es válido.",
  EMAIL_REQUIRED: "El email es requerido.",
  INVALID_ROLE: "El rol no es válido.",
  ALREADY_A_MEMBER: "Esta persona ya es miembro del workspace.",
  INVITATION_ALREADY_PENDING: "Ya hay una invitación pendiente para este email.",
};

export function InviteMemberModal({
  open,
  onOpenChange,
  workspaceId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  workspaceId: string | null;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"ADMIN" | "MEMBER">("MEMBER");
  const [error, setError] = useState<string | null>(null);
  const create = useCreateInvitation();

  function reset() {
    setEmail("");
    setRole("MEMBER");
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!workspaceId) return;
    if (!isValidEmail(email)) {
      setError("El email no es válido.");
      return;
    }
    try {
      const res = await create.mutateAsync({ workspaceId, email: email.trim().toLowerCase(), role });
      const delivered = res?.emailDelivered;
      toast.success(
        delivered
          ? `Invitación enviada a ${email}`
          : `Invitación creada (no se pudo enviar el email automáticamente)`
      );
      reset();
      onOpenChange(false);
    } catch (err: any) {
      const code = err?.code;
      setError(ERR_MESSAGES[code] || "No se pudo crear la invitación. Intenta de nuevo.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) reset(); }}>
      <DialogContent className="border-white/10 bg-[#0B0B0D] text-white">
        <DialogHeader>
          <DialogTitle>Invitar miembro</DialogTitle>
          <DialogDescription className="text-white/60">
            Recibirá un email con un link para aceptar la invitación.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="invite-email" className="text-white/70">Email</Label>
            <Input
              id="invite-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="teammate@brand.com"
              className="border-white/10 bg-white/[0.04] text-white"
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label className="text-white/70">Rol</Label>
            <div className="grid grid-cols-2 gap-2">
              {INVITABLE_ROLES.map((r) => (
                <button
                  type="button"
                  key={r.key}
                  onClick={() => setRole(r.key)}
                  className={[
                    "rounded-xl border p-3 text-left transition",
                    role === r.key
                      ? "border-[#B55CFF]/50 bg-[#B55CFF]/10"
                      : "border-white/10 bg-white/[0.03] hover:border-white/20",
                  ].join(" ")}
                >
                  <div className="text-sm font-medium text-white">{r.label}</div>
                  <div className="text-xs text-white/50">{r.description}</div>
                </button>
              ))}
            </div>
          </div>

          {error && (
            <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
              {error}
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="border-white/10 bg-white/[0.04] text-white hover:bg-white/[0.07]"
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={create.isPending || !email}
              className="bg-[#B55CFF] text-white hover:bg-[#A664FF]"
            >
              {create.isPending ? "Enviando…" : "Enviar invitación"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
