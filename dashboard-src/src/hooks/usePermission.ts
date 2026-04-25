import { useWorkspace } from "@/contexts/WorkspaceContext";
import { canDo, roleSatisfies, type PermissionAction, type WorkspaceRole } from "@/config/permissions";

export function usePermission(action: PermissionAction): boolean {
  const { role } = useWorkspace();
  return canDo(role as WorkspaceRole | null, action);
}

export function useMinRole(minRole: WorkspaceRole): boolean {
  const { role } = useWorkspace();
  return roleSatisfies(role as WorkspaceRole | null, minRole);
}
