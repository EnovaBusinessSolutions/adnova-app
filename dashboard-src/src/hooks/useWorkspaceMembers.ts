import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export type Member = {
  _id: string;
  workspaceId: string;
  userId: {
    _id: string;
    email: string;
    firstName?: string;
    lastName?: string;
    name?: string;
    profilePhotoUrl?: string;
  };
  role: "OWNER" | "ADMIN" | "MEMBER";
  status: "ACTIVE" | "SUSPENDED" | "REMOVED";
  joinedAt: string;
};

async function fetchMembers(workspaceId: string): Promise<Member[]> {
  const res = await fetch(`/api/workspaces/${workspaceId}/members`, { credentials: "include" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  return json.members || [];
}

export function useWorkspaceMembers(workspaceId: string | null | undefined) {
  return useQuery({
    queryKey: ["workspace", workspaceId, "members"],
    queryFn: () => fetchMembers(workspaceId as string),
    enabled: !!workspaceId,
    staleTime: 15_000,
  });
}

async function patchMemberRole(args: { workspaceId: string; userId: string; role: "ADMIN" | "MEMBER" }) {
  const res = await fetch(`/api/workspaces/${args.workspaceId}/members/${args.userId}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role: args.role }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json.error || `HTTP ${res.status}`);
    (err as any).code = json.error;
    throw err;
  }
  return json;
}

export function useChangeMemberRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: patchMemberRole,
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["workspace", vars.workspaceId, "members"] });
    },
  });
}

async function deleteMember(args: { workspaceId: string; userId: string }) {
  const res = await fetch(`/api/workspaces/${args.workspaceId}/members/${args.userId}`, {
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

export function useRemoveMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteMember,
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["workspace", vars.workspaceId, "members"] });
    },
  });
}
