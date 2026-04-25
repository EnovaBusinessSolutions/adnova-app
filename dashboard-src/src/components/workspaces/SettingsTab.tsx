import { useState, useEffect } from "react";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { useWorkspace } from "@/contexts/WorkspaceContext";
import { usePermission } from "@/hooks/usePermission";
import {
  ICON_OPTIONS_FULL, getWorkspaceIcon,
  INDUSTRY_VERTICALS, type IndustryVertical,
  isValidSlugFormat,
} from "@/config/workspaceCatalogs";
import { TransferOwnershipModal } from "./TransferOwnershipModal";
import { DeleteWorkspaceModal } from "./DeleteWorkspaceModal";

async function patchWorkspace(args: { workspaceId: string; updates: any }) {
  const res = await fetch(`/api/workspaces/${args.workspaceId}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args.updates),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json.error || `HTTP ${res.status}`);
    (err as any).code = json.error;
    throw err;
  }
  return json;
}

export function SettingsTab() {
  const { activeWorkspace } = useWorkspace();
  const queryClient = useQueryClient();
  const canEditName = usePermission("workspace.update.name");
  const canEditIcon = usePermission("workspace.update.icon");
  const canEditSlug = usePermission("workspace.update.slug");
  const canEditIndustry = usePermission("workspace.update.industry");
  const canTransfer = usePermission("workspace.transfer.ownership");
  const canDelete = usePermission("workspace.delete");

  const [name, setName] = useState(activeWorkspace?.name || "");
  const [slug, setSlug] = useState(activeWorkspace?.slug || "");
  const [icon, setIcon] = useState(activeWorkspace?.icon || "SHOPPING_BAG");
  const [industry, setIndustry] = useState<IndustryVertical | "">(
    (activeWorkspace?.industryVertical as IndustryVertical) || ""
  );

  const [transferOpen, setTransferOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  useEffect(() => {
    if (activeWorkspace) {
      setName(activeWorkspace.name);
      setSlug(activeWorkspace.slug);
      setIcon(activeWorkspace.icon);
      setIndustry((activeWorkspace.industryVertical as IndustryVertical) || "");
    }
  }, [activeWorkspace]);

  const mutation = useMutation({
    mutationFn: patchWorkspace,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["me", "workspaces"] });
      toast.success("Workspace actualizado");
    },
    onError: (err: any) => {
      toast.error(err?.code || "No se pudo actualizar");
    },
  });

  if (!activeWorkspace) return null;

  const dirty =
    name !== activeWorkspace.name ||
    slug !== activeWorkspace.slug ||
    icon !== activeWorkspace.icon ||
    industry !== (activeWorkspace.industryVertical || "");

  const slugValid = isValidSlugFormat(slug);

  function handleSave() {
    const updates: any = {};
    if (canEditName && name !== activeWorkspace?.name) updates.name = name.trim();
    if (canEditSlug && slug !== activeWorkspace?.slug) {
      if (!slugValid) {
        toast.error("Slug inválido");
        return;
      }
      updates.slug = slug;
    }
    if (canEditIcon && icon !== activeWorkspace?.icon) updates.icon = icon;
    if (canEditIndustry && industry !== (activeWorkspace?.industryVertical || "")) {
      updates.industryVertical = industry || null;
    }
    if (Object.keys(updates).length === 0) return;
    mutation.mutate({ workspaceId: activeWorkspace._id, updates });
  }

  return (
    <div className="space-y-8">
      {/* General settings */}
      <div className="space-y-4">
        <div>
          <h3 className="text-base font-semibold text-white">General</h3>
          <p className="text-sm text-white/50">Información básica de tu workspace.</p>
        </div>

        <div className="space-y-2">
          <Label className="text-white/70">Nombre del workspace</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={!canEditName}
            maxLength={64}
            className="border-white/10 bg-white/[0.04] text-white"
          />
        </div>

        <div className="space-y-2">
          <Label className="text-white/70">Slug (URL)</Label>
          <Input
            value={slug}
            onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/\s/g, "-"))}
            disabled={!canEditSlug}
            maxLength={48}
            className="border-white/10 bg-white/[0.04] font-mono text-sm text-white"
          />
          {!canEditSlug && (
            <p className="text-xs text-white/40">Solo el Owner puede cambiar el slug.</p>
          )}
          {canEditSlug && slug && !slugValid && (
            <p className="text-xs text-amber-400">Solo minúsculas, números y guiones.</p>
          )}
        </div>

        <div className="space-y-2">
          <Label className="text-white/70">Ícono</Label>
          <div className="grid grid-cols-8 gap-2">
            {ICON_OPTIONS_FULL.map((opt) => {
              const Icon = getWorkspaceIcon(opt.key);
              const selected = icon === opt.key;
              return (
                <button
                  key={opt.key}
                  type="button"
                  disabled={!canEditIcon}
                  onClick={() => setIcon(opt.key)}
                  className={[
                    "flex aspect-square items-center justify-center rounded-xl border transition",
                    selected
                      ? "border-[#B55CFF] bg-[#B55CFF]/15 text-[#B55CFF]"
                      : "border-white/10 bg-white/[0.03] text-white/60",
                    !canEditIcon && "cursor-not-allowed opacity-50",
                  ].join(" ")}
                >
                  <Icon className="h-5 w-5" />
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-2">
          <Label className="text-white/70">Vertical de industria</Label>
          <select
            value={industry}
            onChange={(e) => setIndustry(e.target.value as IndustryVertical)}
            disabled={!canEditIndustry}
            className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white"
          >
            <option value="">Sin especificar</option>
            {INDUSTRY_VERTICALS.map((v) => (
              <option key={v.key} value={v.key}>{v.label}</option>
            ))}
          </select>
        </div>

        <div className="flex justify-end">
          <Button
            onClick={handleSave}
            disabled={!dirty || mutation.isPending || (canEditSlug && !slugValid)}
            className="bg-[#B55CFF] text-white hover:bg-[#A664FF]"
          >
            {mutation.isPending ? "Guardando…" : "Guardar cambios"}
          </Button>
        </div>
      </div>

      {(canTransfer || canDelete) && (
        <>
          <Separator className="bg-white/10" />

          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-rose-400" />
              <h3 className="text-base font-semibold text-rose-400">Danger zone</h3>
            </div>

            {canTransfer && (
              <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.02] p-4">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-white">Transferir ownership</div>
                  <div className="text-xs text-white/50">
                    Pasa el control total a otro miembro. Tú quedarás como Admin.
                  </div>
                </div>
                <Button
                  variant="outline"
                  onClick={() => setTransferOpen(true)}
                  className="border-white/10 bg-white/[0.04] text-white hover:bg-white/[0.07]"
                >
                  Transferir
                </Button>
              </div>
            )}

            {canDelete && (
              <div className="flex items-center justify-between rounded-2xl border border-rose-500/30 bg-rose-500/5 p-4">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-rose-300">Eliminar workspace</div>
                  <div className="text-xs text-rose-300/70">
                    Esta acción es irreversible. El workspace y sus datos quedarán inaccesibles.
                  </div>
                </div>
                <Button
                  onClick={() => setDeleteOpen(true)}
                  className="bg-rose-500 text-white hover:bg-rose-600"
                >
                  Eliminar
                </Button>
              </div>
            )}
          </div>
        </>
      )}

      <TransferOwnershipModal open={transferOpen} onOpenChange={setTransferOpen} />
      <DeleteWorkspaceModal open={deleteOpen} onOpenChange={setDeleteOpen} />
    </div>
  );
}
