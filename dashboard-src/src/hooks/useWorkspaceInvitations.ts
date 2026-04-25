import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export type Invitation = {
  _id: string;
  workspaceId: string;
  email: string;
  role: "ADMIN" | "MEMBER";
  expiresAt: string;
  createdAt: string;
};

async function fetchInvitations(workspaceId: string): Promise<Invitation[]> {
  const res = await fetch(`/api/workspaces/${workspaceId}/invitations`, { credentials: "include" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  return json.invitations || [];
}

export function useWorkspaceInvitations(workspaceId: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: ["workspace", workspaceId, "invitations"],
    queryFn: () => fetchInvitations(workspaceId as string),
    enabled: !!workspaceId && enabled,
    staleTime: 15_000,
  });
}

async function postInvitation(args: { workspaceId: string; email: string; role: "ADMIN" | "MEMBER" }) {
  const res = await fetch(`/api/workspaces/${args.workspaceId}/invitations`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: args.email, role: args.role }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json.error || `HTTP ${res.status}`);
    (err as any).code = json.error;
    throw err;
  }
  return json;
}

export function useCreateInvitation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: postInvitation,
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["workspace", vars.workspaceId, "invitations"] });
    },
  });
}

async function deleteInvitation(args: { workspaceId: string; invitationId: string }) {
  const res = await fetch(
    `/api/workspaces/${args.workspaceId}/invitations/${args.invitationId}`,
    { method: "DELETE", credentials: "include" }
  );
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json.error || `HTTP ${res.status}`);
    (err as any).code = json.error;
    throw err;
  }
  return json;
}

export function useRevokeInvitation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteInvitation,
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["workspace", vars.workspaceId, "invitations"] });
    },
  });
}
