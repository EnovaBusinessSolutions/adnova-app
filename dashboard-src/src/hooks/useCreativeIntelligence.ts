// dashboard-src/src/hooks/useCreativeIntelligence.ts
import { useEffect, useMemo, useState, useCallback } from "react";

export type CreativeObjective = "ventas" | "alcance" | "leads";
export type CreativeTier = "star" | "good" | "average" | "poor" | "critical";

export type CreativeMetrics = {
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  ctr: number;
  cpc: number | null;
  cpm: number | null;
  frequency: number | null;
  purchases: number;
  revenue: number;
  roas: number | null;
  cpa: number | null;
  cvr: number;
  leads: number;
  cpl: number | null;
};

export type CreativeScores = {
  value: number;
  risk: number;
  alignment: number;
  total: number;
};

export type CreativeRecommendation = {
  id: string;
  category: "scale" | "optimize" | "alert" | "info";
  priority: number;
  message: string;
  action?: string;
  checked: boolean;
  checkedAt: string | null;
};

export type CreativeSnapshot = {
  adId: string;
  adName: string;
  adsetId: string;
  adsetName: string;
  campaignId: string;
  campaignName: string;
  creativeType: "image" | "video" | "carousel" | "collection" | "unknown";
  thumbnailUrl: string | null;
  effectiveStatus: string;
  campaignObjective: string | null;
  campaignObjectiveNorm: string;
  userObjective: CreativeObjective;
  metrics: CreativeMetrics;
  metricsPrev: CreativeMetrics;
  deltas: Record<string, number>;
  scores: CreativeScores;
  tier: CreativeTier;
  recommendations: CreativeRecommendation[];
};

export type CreativeSummary = {
  total: number;
  star: number;
  good: number;
  average: number;
  poor: number;
  critical: number;
};

type CreativeIntelligenceResponse = {
  ok: boolean;
  accountId: string;
  objective: CreativeObjective;
  dateRange: { since: string; until: string };
  creatives: CreativeSnapshot[];
  summary: CreativeSummary;
  error?: string;
};

type AccountsResponse = {
  ok: boolean;
  accounts: Array<{ id: string; name: string; currency: string | null }>;
  defaultAccountId: string | null;
  objective: CreativeObjective | null;
};

type UseCreativeIntelligenceParams = {
  accountId?: string;
  objective?: CreativeObjective;
  days?: number;
};

export function useCreativeIntelligence(params: UseCreativeIntelligenceParams = {}) {
  const [data, setData] = useState<CreativeIntelligenceResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const qs = useMemo(() => {
    const u = new URLSearchParams();
    if (params.accountId) u.set("account_id", params.accountId);
    if (params.objective) u.set("objective", params.objective);
    if (params.days) u.set("days", String(params.days));
    return u.toString();
  }, [params.accountId, params.objective, params.days]);

  const refetch = useCallback(() => {
    if (!params.accountId) return;
    
    setLoading(true);
    setError(null);
    
    fetch(`/api/creative-intelligence/creatives?${qs}`, { credentials: "include" })
      .then(async (r) => {
        const json = await r.json();
        if (!r.ok || !json.ok) {
          throw new Error(json.error || json.detail || "CREATIVE_INTELLIGENCE_ERROR");
        }
        return json as CreativeIntelligenceResponse;
      })
      .then((j) => {
        setData(j);
        setError(null);
      })
      .catch((e) => setError(String(e?.message || e)))
      .finally(() => setLoading(false));
  }, [qs, params.accountId]);

  return { data, loading, error, refetch };
}

export function useCreativeAccounts() {
  const [data, setData] = useState<AccountsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/creative-intelligence/accounts", { credentials: "include" })
      .then(async (r) => {
        if (!r.ok) throw new Error(await r.text());
        return r.json() as Promise<AccountsResponse>;
      })
      .then((j) => {
        if (!j.ok) throw new Error("ACCOUNTS_ERROR");
        setData(j);
        setError(null);
      })
      .catch((e) => setError(String(e?.message || e)))
      .finally(() => setLoading(false));
  }, []);

  return { data, loading, error };
}

export async function toggleRecommendationCheck(
  adId: string,
  recommendationId: string,
  checked: boolean,
  accountId?: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const body = { recommendationId, checked, account_id: accountId };
    const r = await fetch(`/api/creative-intelligence/recommendation/${adId}/check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    });
    const json = await r.json();
    return json;
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function resyncMetaAccounts(): Promise<{
  ok: boolean;
  accounts?: Array<{ id: string; account_id: string; name: string; business_name?: string }>;
  stats?: { total: number; personal: number; fromBusinesses: number };
  error?: string;
}> {
  try {
    const r = await fetch("/auth/meta/accounts/resync", {
      method: "POST",
      credentials: "include",
    });
    const json = await r.json();
    return json;
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}
