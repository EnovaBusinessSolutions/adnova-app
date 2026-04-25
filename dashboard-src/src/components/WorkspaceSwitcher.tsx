// dashboard-src/src/components/WorkspaceSwitcher.tsx
import { useNavigate } from "react-router-dom";
import {
  Check,
  ChevronUp,
  Plus,
  Settings as SettingsIcon,
  LogOut,
  ChevronRight,
} from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";

import { useWorkspace, type Workspace } from "@/contexts/WorkspaceContext";
import { getWorkspaceIcon } from "@/config/workspaceCatalogs";

const MAX_VISIBLE_WORKSPACES = 3;

export interface WorkspaceSwitcherProps {
  isOpen: boolean;
  displayName: string | null;
  email: string | null;
  onLogout: () => void;
}

export function WorkspaceSwitcher({
  isOpen,
  displayName,
  email,
  onLogout,
}: WorkspaceSwitcherProps) {
  const navigate = useNavigate();
  const { workspaces, activeWorkspace, switchWorkspace } = useWorkspace();

  const visible = workspaces.slice(0, MAX_VISIBLE_WORKSPACES);
  const hasMore = workspaces.length > MAX_VISIBLE_WORKSPACES;

  const ActiveIcon = getWorkspaceIcon(activeWorkspace?.icon);

  async function handleSwitch(ws: Workspace) {
    if (ws._id === activeWorkspace?._id) return;
    try {
      await switchWorkspace(ws._id);
    } catch (err) {
      console.error("[WorkspaceSwitcher] switch failed", err);
    }
  }

  function handleCreateNew() {
    navigate("/workspaces/new");
  }

  function handleSeeMore() {
    navigate("/workspaces");
  }

  function handleSettings() {
    navigate("/settings");
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="adray-sidebar-footer-card group flex w-full items-center gap-3 overflow-hidden rounded-2xl px-3 py-3 text-left transition hover:bg-white/[0.04]"
          aria-label="Abrir menú de cuenta"
        >
          <span className="adray-sidebar-ambient-dot relative inline-flex h-2.5 w-2.5 flex-none rounded-full bg-[#EB2CFF] shadow-[0_0_12px_rgba(235,44,255,0.7)]">
            <span className="absolute inset-0 animate-ping rounded-full bg-[#EB2CFF]/30" />
          </span>

          {isOpen && (
            <>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-white">
                  {displayName || "Tu cuenta"}
                </div>
                {activeWorkspace && (
                  <div className="flex items-center gap-1 truncate text-xs text-white/50">
                    <ActiveIcon className="h-3 w-3" />
                    <span className="truncate">{activeWorkspace.name}</span>
                  </div>
                )}
              </div>
              <ChevronUp className="h-4 w-4 flex-none text-white/40 transition group-data-[state=open]:rotate-180" />
            </>
          )}
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        side="top"
        align="start"
        sideOffset={8}
        className="w-72 border border-white/10 bg-[#0B0B0D] text-white shadow-[0_20px_50px_-20px_rgba(0,0,0,0.8)]"
      >
        {/* Header con info del usuario */}
        <div className="px-3 py-2">
          <div className="text-sm font-medium text-white">{displayName || "Tu cuenta"}</div>
          {email && <div className="truncate text-xs text-white/50">{email}</div>}
        </div>

        <DropdownMenuSeparator className="bg-white/10" />

        {/* Workspaces list */}
        <DropdownMenuLabel className="text-[10px] uppercase tracking-widest text-white/40">
          Workspaces
        </DropdownMenuLabel>

        {visible.length === 0 && (
          <div className="px-3 py-2 text-xs text-white/40">No tienes workspaces todavía.</div>
        )}

        {visible.map((ws) => {
          const Icon = getWorkspaceIcon(ws.icon);
          const isActive = ws._id === activeWorkspace?._id;
          return (
            <DropdownMenuItem
              key={ws._id}
              onSelect={() => handleSwitch(ws)}
              className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm focus:bg-white/[0.06] focus:text-white"
            >
              <span className="grid h-7 w-7 place-items-center rounded-lg border border-white/10 bg-white/[0.04]">
                <Icon className="h-3.5 w-3.5 text-white/80" />
              </span>
              <span className="flex-1 truncate">{ws.name}</span>
              {isActive && <Check className="h-4 w-4 text-[#B55CFF]" />}
            </DropdownMenuItem>
          );
        })}

        <DropdownMenuItem
          onSelect={handleCreateNew}
          className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm text-white/80 focus:bg-white/[0.06] focus:text-white"
        >
          <span className="grid h-7 w-7 place-items-center rounded-lg border border-dashed border-white/15">
            <Plus className="h-3.5 w-3.5" />
          </span>
          <span>Crear nuevo workspace</span>
        </DropdownMenuItem>

        {hasMore && (
          <DropdownMenuItem
            onSelect={handleSeeMore}
            className="flex cursor-pointer items-center gap-2 px-3 py-2 text-xs text-white/60 focus:bg-white/[0.06] focus:text-white"
          >
            <span className="flex-1">Ver todos ({workspaces.length})</span>
            <ChevronRight className="h-3.5 w-3.5" />
          </DropdownMenuItem>
        )}

        <DropdownMenuSeparator className="bg-white/10" />

        <DropdownMenuItem
          onSelect={handleSettings}
          className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm focus:bg-white/[0.06] focus:text-white"
        >
          <SettingsIcon className="h-4 w-4 text-white/60" />
          <span>Settings</span>
        </DropdownMenuItem>

        <DropdownMenuItem
          onSelect={onLogout}
          className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm focus:bg-white/[0.06] focus:text-white"
        >
          <LogOut className="h-4 w-4 text-white/60" />
          <span>Sign out</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
