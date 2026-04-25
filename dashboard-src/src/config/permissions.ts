// MIRROR de backend/config/permissions.js
// Mantener sincronizado manualmente.

export type WorkspaceRole = "OWNER" | "ADMIN" | "MEMBER";

export const ROLE_HIERARCHY: Record<WorkspaceRole, number> = {
  OWNER: 3,
  ADMIN: 2,
  MEMBER: 1,
};

export const PERMISSIONS = {
  "workspace.view":              ["OWNER", "ADMIN", "MEMBER"],
  "workspace.update.name":       ["OWNER", "ADMIN"],
  "workspace.update.icon":       ["OWNER", "ADMIN"],
  "workspace.update.slug":       ["OWNER"],
  "workspace.update.industry":   ["OWNER", "ADMIN"],
  "workspace.delete":            ["OWNER"],
  "workspace.transfer.ownership":["OWNER"],

  "members.view":                ["OWNER", "ADMIN", "MEMBER"],
  "members.invite":              ["OWNER", "ADMIN"],
  "members.remove":              ["OWNER", "ADMIN"],
  "members.changeRole":          ["OWNER", "ADMIN"],
  "members.suspend":             ["OWNER", "ADMIN"],

  "invitations.view":            ["OWNER", "ADMIN"],
  "invitations.create":          ["OWNER", "ADMIN"],
  "invitations.revoke":          ["OWNER", "ADMIN"],

  "billing.view":                ["OWNER", "ADMIN"],
  "billing.manage":              ["OWNER"],
  "billing.changePlan":          ["OWNER"],

  "platforms.view":              ["OWNER", "ADMIN", "MEMBER"],
  "platforms.connect":           ["OWNER", "ADMIN"],
  "platforms.disconnect":        ["OWNER", "ADMIN"],
  "platforms.changeSelection":   ["OWNER", "ADMIN"],

  "mcp.view":                    ["OWNER", "ADMIN", "MEMBER"],
  "mcp.generate":                ["OWNER", "ADMIN", "MEMBER"],
  "mcp.revoke":                  ["OWNER", "ADMIN"],

  "dashboard.connect":           ["OWNER", "ADMIN"],
  "attribution.view":            ["OWNER", "ADMIN", "MEMBER"],
  "audits.view":                 ["OWNER", "ADMIN", "MEMBER"],
  "audits.create":               ["OWNER", "ADMIN"],
  "audits.delete":               ["OWNER", "ADMIN"],
  "dailysignal.configure":       ["OWNER", "ADMIN", "MEMBER"],
  "signalpdf.generate":          ["OWNER", "ADMIN", "MEMBER"],
  "export.csv":                  ["OWNER", "ADMIN", "MEMBER"],
} as const;

export type PermissionAction = keyof typeof PERMISSIONS;

export function canDo(role: WorkspaceRole | null | undefined, action: PermissionAction): boolean {
  if (!role) return false;
  const allowed = PERMISSIONS[action] as readonly string[] | undefined;
  if (!allowed) return false;
  return allowed.includes(role);
}

export function roleSatisfies(role: WorkspaceRole | null | undefined, minRole: WorkspaceRole): boolean {
  if (!role) return false;
  return ROLE_HIERARCHY[role] >= ROLE_HIERARCHY[minRole];
}
