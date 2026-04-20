'use strict';

function safeStr(v) {
  return v == null ? '' : String(v);
}

function nowIso() {
  return new Date().toISOString();
}

function toSerializable(value, fallback = null) {
  if (value == null) return fallback;

  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_) {
    return fallback;
  }
}

function uniqStrings(values, limit = 20) {
  const out = [];
  const seen = new Set();

  for (const value of Array.isArray(values) ? values : []) {
    const normalized = safeStr(value).trim();
    if (!normalized) continue;

    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    out.push(normalized);
    if (out.length >= limit) break;
  }

  return out;
}

function pickFirstText(...candidates) {
  for (const candidate of candidates) {
    const text = safeStr(candidate).trim();
    if (text) return text;
  }

  return '';
}

function buildEncodedContextText({
  workspaceName = '',
  generatedAt = '',
  sourceFingerprint = '',
  connectionFingerprint = '',
  contextWindow = null,
  summary = {},
  performanceDrivers = [],
  conversionBottlenecks = [],
  scalingOpportunities = [],
  riskFlags = [],
  priorityActions = [],
  existingDetailedText = '',
  dailyIndex = [],
  campaignsDailyRows = [],
  adsDailyRows = [],
  landingPagesDailyRows = [],
  anomalies = [],
  benchmarks = null,
  campaigns = [],
  adSets = [],
  ads = [],
}) {
  const lines = [
    '[ADRAY_ENCODED_SIGNAL_V1]',
    `workspace=${workspaceName || 'unknown'}`,
    `generated_at=${generatedAt || nowIso()}`,
    `source_fingerprint=${sourceFingerprint || 'n/a'}`,
    `connection_fingerprint=${connectionFingerprint || 'n/a'}`,
    `context_window=${contextWindow ? JSON.stringify(contextWindow) : 'null'}`,
    '',
    '[EXECUTIVE_SUMMARY]',
    summary?.executive_summary || 'n/a',
    '',
    '[BUSINESS_STATE]',
    summary?.business_state || 'n/a',
    '',
    '[CROSS_CHANNEL_STORY]',
    summary?.cross_channel_story || 'n/a',
  ];

  const addList = (title, list = []) => {
    lines.push('');
    lines.push(`[${title}]`);

    if (!Array.isArray(list) || list.length === 0) {
      lines.push('- n/a');
      return;
    }

    for (const item of list) {
      lines.push(`- ${item}`);
    }
  };

  addList('PERFORMANCE_DRIVERS', performanceDrivers);
  addList('CONVERSION_BOTTLENECKS', conversionBottlenecks);
  addList('SCALING_OPPORTUNITIES', scalingOpportunities);
  addList('RISK_FLAGS', riskFlags);
  addList('PRIORITY_ACTIONS', priorityActions);

  // --- DAILY INDEX (day-by-day granularity across all connected platforms) ---
  //
  // Rows come from mcpContextBuilder.buildMetaDailyRows / buildGoogleDailyRows /
  // buildGa4DailyRows / buildBlendedDailyRows. Each row is per-platform per-date.
  // We group by date and render one sub-line per platform so the LLM and the
  // merchant get the full 30-day granular picture for each connected source.
  //
  // No slice cap: the user asked for day-1 to day-30 visibility, even at 3+
  // sources (which produces ~30 days × 4 platform rows = ~120 sub-lines).
  if (Array.isArray(dailyIndex) && dailyIndex.length > 0) {
    const byDate = new Map();
    for (const row of dailyIndex) {
      const d = row && typeof row === 'object' ? safeStr(row.date).trim() : '';
      if (!d) continue;
      if (!byDate.has(d)) byDate.set(d, []);
      byDate.get(d).push(row);
    }

    const sortedDates = Array.from(byDate.keys()).sort((a, b) => a.localeCompare(b));
    const platformOrder = ['meta', 'google', 'ga4', 'blended'];

    const fmtInt = (v) => (v == null ? null : String(Math.round(Number(v))));
    const fmt2 = (v) => (v == null ? null : Number(v).toFixed(2));
    const fmtPct = (v) => (v == null ? null : `${Number(v).toFixed(2)}%`);
    const fmtShare = (v) => (v == null ? null : `${Math.round(Number(v) * 100)}%`);

    const renderPlatformParts = (row) => {
      const p = safeStr(row?.platform).trim().toLowerCase();
      const parts = [];

      if (p === 'meta' || p === 'google') {
        if (row.spend != null) parts.push(`spend=${fmtInt(row.spend)}`);
        if (row.impressions != null) parts.push(`imp=${fmtInt(row.impressions)}`);
        if (row.clicks != null) parts.push(`clicks=${fmtInt(row.clicks)}`);
        if (row.ctr != null) parts.push(`ctr=${fmtPct(row.ctr)}`);
        if (row.cpc != null) parts.push(`cpc=${fmt2(row.cpc)}`);
        if (row.cpm != null) parts.push(`cpm=${fmt2(row.cpm)}`);
        if (row.conversions != null) parts.push(`conv=${fmtInt(row.conversions)}`);
        if (row.conversion_value != null) parts.push(`cv=${fmtInt(row.conversion_value)}`);
        if (row.roas_platform != null) parts.push(`roas=${fmt2(row.roas_platform)}`);
        if (row.orders != null) parts.push(`orders=${fmtInt(row.orders)}`);
        if (row.revenue != null) parts.push(`revenue=${fmtInt(row.revenue)}`);
        if (row.roas_reconciled != null) parts.push(`roas_reconciled=${fmt2(row.roas_reconciled)}`);
      } else if (p === 'ga4') {
        if (row.sessions != null) parts.push(`sessions=${fmtInt(row.sessions)}`);
        if (row.users != null) parts.push(`users=${fmtInt(row.users)}`);
        if (row.engagement_rate != null) parts.push(`eng_rate=${fmtPct(row.engagement_rate)}`);
        if (row.conversions != null) parts.push(`conv=${fmtInt(row.conversions)}`);
        if (row.ga4_revenue != null) parts.push(`revenue=${fmtInt(row.ga4_revenue)}`);
      } else if (p === 'blended') {
        if (row.blended_spend != null) parts.push(`total_spend=${fmtInt(row.blended_spend)}`);
        if (row.impressions != null) parts.push(`imp=${fmtInt(row.impressions)}`);
        if (row.clicks != null) parts.push(`clicks=${fmtInt(row.clicks)}`);
        if (row.blended_ctr != null) parts.push(`ctr=${fmtPct(row.blended_ctr)}`);
        if (row.blended_cpc != null) parts.push(`cpc=${fmt2(row.blended_cpc)}`);
        if (row.sessions != null) parts.push(`sessions=${fmtInt(row.sessions)}`);
        if (row.users != null) parts.push(`users=${fmtInt(row.users)}`);
        if (row.platform_spend_share && typeof row.platform_spend_share === 'object') {
          const share = Object.entries(row.platform_spend_share)
            .filter(([, v]) => v != null)
            .map(([k, v]) => `${k}=${fmtShare(v)}`)
            .join('/');
          if (share) parts.push(`spend_share[${share}]`);
        }
      } else {
        // Unknown platform fallback: dump generic numeric fields so we never drop data.
        if (row.spend != null) parts.push(`spend=${fmtInt(row.spend)}`);
        if (row.impressions != null) parts.push(`imp=${fmtInt(row.impressions)}`);
        if (row.conversions != null) parts.push(`conv=${fmtInt(row.conversions)}`);
        if (row.conversion_value != null) parts.push(`cv=${fmtInt(row.conversion_value)}`);
      }

      return parts;
    };

    let anyLineRendered = false;
    const dailyLines = [];
    for (const date of sortedDates) {
      const rowsForDate = byDate.get(date) || [];
      rowsForDate.sort((a, b) => {
        const pa = platformOrder.indexOf(safeStr(a?.platform).trim().toLowerCase());
        const pb = platformOrder.indexOf(safeStr(b?.platform).trim().toLowerCase());
        return (pa === -1 ? 99 : pa) - (pb === -1 ? 99 : pb);
      });

      const renderedRows = [];
      for (const row of rowsForDate) {
        const parts = renderPlatformParts(row);
        if (parts.length === 0) continue;
        const platformLabel = safeStr(row?.platform).trim().toLowerCase() || 'unknown';
        renderedRows.push(`  ${platformLabel}: ${parts.join(' | ')}`);
      }

      if (renderedRows.length === 0) continue;
      anyLineRendered = true;
      dailyLines.push(`- ${date}:`);
      for (const line of renderedRows) dailyLines.push(line);
    }

    if (anyLineRendered) {
      lines.push('');
      lines.push('[DAILY_INDEX]');
      for (const line of dailyLines) lines.push(line);
    }
  }

  // --- Shared formatters for aggregate + daily entity sections (CAMPAIGNS/AD_SETS/ADS/*DAILY) ---
  // Declared here once; the [DAILY_INDEX] block above uses its own local shadows
  // (that is intentional, don't touch them — Fase C is stable).
  const fmtAggInt = (v) => (v == null ? null : String(Math.round(Number(v))));
  const fmtAgg2 = (v) => (v == null ? null : Number(v).toFixed(2));
  const fmtAggPct = (v) => (v == null ? null : `${Number(v).toFixed(2)}%`);

  // --- CAMPAIGNS (aggregate per-campaign, all platforms) ---
  //
  // Data comes from mcpContextBuilder.buildCampaignsSchema (structured_signal.campaigns).
  // Rows have: campaign_id, campaign_name, platform, objective, status, budget_*,
  // last_7 | last_30 | all_60 (each with spend/imp/clicks/ctr/cpc/cpm/conv/cv/roas_platform),
  // wow_*/mom_* deltas, efficiency_rank_7d, spend_share_pct, anomaly_flag.
  //
  // Sorted by last_30.spend desc (fallback all_60.spend) so top spenders surface first.
  if (Array.isArray(campaigns) && campaigns.length > 0) {
    const sorted = campaigns.slice().sort((a, b) => {
      const sa = Number(a?.last_30?.spend ?? a?.all_60?.spend ?? 0) || 0;
      const sb = Number(b?.last_30?.spend ?? b?.all_60?.spend ?? 0) || 0;
      return sb - sa;
    });

    const renderHorizon = (label, kpis) => {
      if (!kpis || typeof kpis !== 'object') return null;
      const parts = [];
      if (kpis.spend != null) parts.push(`spend=${fmtAggInt(kpis.spend)}`);
      if (kpis.impressions != null) parts.push(`imp=${fmtAggInt(kpis.impressions)}`);
      if (kpis.clicks != null) parts.push(`clicks=${fmtAggInt(kpis.clicks)}`);
      if (kpis.ctr != null) parts.push(`ctr=${fmtAggPct(kpis.ctr)}`);
      if (kpis.cpc != null) parts.push(`cpc=${fmtAgg2(kpis.cpc)}`);
      if (kpis.cpm != null) parts.push(`cpm=${fmtAgg2(kpis.cpm)}`);
      if (kpis.conversions != null) parts.push(`conv=${fmtAggInt(kpis.conversions)}`);
      if (kpis.conversion_value != null) parts.push(`cv=${fmtAggInt(kpis.conversion_value)}`);
      if (kpis.roas_platform != null) parts.push(`roas=${fmtAgg2(kpis.roas_platform)}`);
      return parts.length > 0 ? `  ${label}: ${parts.join(' | ')}` : null;
    };

    const campaignLines = [];
    for (const c of sorted) {
      if (!c || typeof c !== 'object') continue;
      const platform = safeStr(c.platform).trim().toUpperCase() || 'UNKNOWN';
      const name = safeStr(c.campaign_name).trim() || safeStr(c.campaign_id).trim() || 'unnamed';
      const status = safeStr(c.status).trim().toUpperCase();
      const objective = safeStr(c.objective).trim().toUpperCase();
      const id = safeStr(c.campaign_id).trim();

      const headerParts = [];
      if (id) headerParts.push(`id=${id}`);
      if (status) headerParts.push(`status=${status}`);
      if (objective) headerParts.push(`objective=${objective}`);

      const bodyLines = [];
      const h7 = renderHorizon('last_7', c.last_7);
      const h30 = renderHorizon('last_30', c.last_30);
      const h60 = renderHorizon('all_60', c.all_60);
      if (h7) bodyLines.push(h7);
      if (h30) bodyLines.push(h30);
      if (h60) bodyLines.push(h60);

      const metaParts = [];
      if (c.wow_spend_pct != null) metaParts.push(`wow_spend=${fmtAgg2(c.wow_spend_pct)}%`);
      if (c.wow_roas_pct != null) metaParts.push(`wow_roas=${fmtAgg2(c.wow_roas_pct)}%`);
      if (c.mom_spend_pct != null) metaParts.push(`mom_spend=${fmtAgg2(c.mom_spend_pct)}%`);
      if (c.mom_roas_pct != null) metaParts.push(`mom_roas=${fmtAgg2(c.mom_roas_pct)}%`);
      if (c.efficiency_rank_7d != null) metaParts.push(`eff_rank_7d=${c.efficiency_rank_7d}`);
      if (c.spend_share_pct != null) metaParts.push(`spend_share=${fmtAgg2(c.spend_share_pct)}%`);
      if (c.budget_type) metaParts.push(`budget_type=${safeStr(c.budget_type)}`);
      if (c.budget_amount != null) metaParts.push(`budget=${fmtAggInt(c.budget_amount)}`);
      if (c.anomaly_flag === true) metaParts.push(`anomaly=true`);
      if (metaParts.length > 0) bodyLines.push(`  meta: ${metaParts.join(' | ')}`);

      if (bodyLines.length === 0) continue;
      campaignLines.push(`- [${platform}] "${name}"${headerParts.length > 0 ? ` (${headerParts.join(' | ')})` : ''}`);
      for (const l of bodyLines) campaignLines.push(l);
    }

    if (campaignLines.length > 0) {
      lines.push('');
      lines.push('[CAMPAIGNS]');
      for (const l of campaignLines) lines.push(l);
    }
  }

  // --- AD_SETS (aggregate per ad set / ad group) ---
  //
  // Rendering ready for Fase D2 to populate via metaLlmFormatter / googleAdsLlmFormatter
  // (adSetsDataset). Today this renders empty because structured_signal.ad_sets = [].
  if (Array.isArray(adSets) && adSets.length > 0) {
    const sorted = adSets.slice().sort((a, b) => {
      const sa = Number(a?.last_30?.spend ?? a?.last_7?.spend ?? 0) || 0;
      const sb = Number(b?.last_30?.spend ?? b?.last_7?.spend ?? 0) || 0;
      return sb - sa;
    });

    const renderAdSetHorizon = (label, kpis) => {
      if (!kpis || typeof kpis !== 'object') return null;
      const parts = [];
      if (kpis.spend != null) parts.push(`spend=${fmtAggInt(kpis.spend)}`);
      if (kpis.impressions != null) parts.push(`imp=${fmtAggInt(kpis.impressions)}`);
      if (kpis.clicks != null) parts.push(`clicks=${fmtAggInt(kpis.clicks)}`);
      if (kpis.ctr != null) parts.push(`ctr=${fmtAggPct(kpis.ctr)}`);
      if (kpis.cpc != null) parts.push(`cpc=${fmtAgg2(kpis.cpc)}`);
      if (kpis.conversions != null) parts.push(`conv=${fmtAggInt(kpis.conversions)}`);
      if (kpis.roas_platform != null) parts.push(`roas=${fmtAgg2(kpis.roas_platform)}`);
      return parts.length > 0 ? `  ${label}: ${parts.join(' | ')}` : null;
    };

    const adSetLines = [];
    for (const s of sorted) {
      if (!s || typeof s !== 'object') continue;
      const platform = safeStr(s.platform).trim().toUpperCase() || 'UNKNOWN';
      const name = safeStr(s.ad_set_name).trim() || safeStr(s.ad_set_id).trim() || 'unnamed';
      const campaignName = safeStr(s.campaign_name).trim();
      const status = safeStr(s.status).trim().toUpperCase();
      const audienceType = safeStr(s.audience_type).trim();

      const headerParts = [];
      if (s.ad_set_id) headerParts.push(`id=${safeStr(s.ad_set_id)}`);
      if (status) headerParts.push(`status=${status}`);
      if (audienceType) headerParts.push(`audience=${audienceType}`);
      if (campaignName) headerParts.push(`campaign="${campaignName}"`);

      const bodyLines = [];
      const h7 = renderAdSetHorizon('last_7', s.last_7);
      const h30 = renderAdSetHorizon('last_30', s.last_30);
      if (h7) bodyLines.push(h7);
      if (h30) bodyLines.push(h30);

      const metaParts = [];
      if (s.bid_strategy) metaParts.push(`bid_strategy=${safeStr(s.bid_strategy)}`);
      if (s.bid_amount != null) metaParts.push(`bid=${fmtAgg2(s.bid_amount)}`);
      if (s.daily_budget != null) metaParts.push(`daily_budget=${fmtAggInt(s.daily_budget)}`);
      if (s.cpa_7d != null) metaParts.push(`cpa_7d=${fmtAgg2(s.cpa_7d)}`);
      if (s.cpa_30d != null) metaParts.push(`cpa_30d=${fmtAgg2(s.cpa_30d)}`);
      if (s.frequency_7d != null) metaParts.push(`freq_7d=${fmtAgg2(s.frequency_7d)}`);
      if (s.frequency_30d != null) metaParts.push(`freq_30d=${fmtAgg2(s.frequency_30d)}`);
      if (s.frequency_enriched_7d != null) metaParts.push(`freq_enriched_7d=${fmtAgg2(s.frequency_enriched_7d)}`);
      if (s.frequency_warning === true) metaParts.push(`freq_warning=true`);
      if (s.cpa_reconciled_30d != null) metaParts.push(`cpa_reconciled_30d=${fmtAgg2(s.cpa_reconciled_30d)}`);
      if (s.targeting_summary) metaParts.push(`targeting="${safeStr(s.targeting_summary).trim()}"`);
      if (metaParts.length > 0) bodyLines.push(`  meta: ${metaParts.join(' | ')}`);

      if (bodyLines.length === 0) continue;
      adSetLines.push(`- [${platform}] "${name}"${headerParts.length > 0 ? ` (${headerParts.join(' | ')})` : ''}`);
      for (const l of bodyLines) adSetLines.push(l);
    }

    if (adSetLines.length > 0) {
      lines.push('');
      lines.push('[AD_SETS]');
      for (const l of adSetLines) lines.push(l);
    }
  }

  // --- ADS (aggregate per creative / ad) ---
  //
  // Rendering ready for Fase D2 to populate via metaLlmFormatter / googleAdsLlmFormatter
  // (adsDataset). Today this renders empty because structured_signal.ads = [].
  if (Array.isArray(ads) && ads.length > 0) {
    const sorted = ads.slice().sort((a, b) => {
      const sa = Number(a?.last_7_spend ?? 0) || 0;
      const sb = Number(b?.last_7_spend ?? 0) || 0;
      return sb - sa;
    });

    const adLines = [];
    for (const ad of sorted) {
      if (!ad || typeof ad !== 'object') continue;
      const platform = safeStr(ad.platform).trim().toUpperCase() || 'UNKNOWN';
      const name = safeStr(ad.ad_name).trim() || safeStr(ad.ad_id).trim() || 'unnamed';
      const campaignName = safeStr(ad.campaign_name).trim();
      const status = safeStr(ad.status).trim().toUpperCase();
      const creativeType = safeStr(ad.creative_type).trim();
      const headline = safeStr(ad.headline).trim();

      const headerParts = [];
      if (ad.ad_id) headerParts.push(`id=${safeStr(ad.ad_id)}`);
      if (status) headerParts.push(`status=${status}`);
      if (creativeType) headerParts.push(`creative=${creativeType}`);
      if (campaignName) headerParts.push(`campaign="${campaignName}"`);

      const bodyLines = [];
      if (headline) bodyLines.push(`  headline: "${headline}"`);

      const last7Parts = [];
      if (ad.last_7_spend != null) last7Parts.push(`spend=${fmtAggInt(ad.last_7_spend)}`);
      if (ad.last_7_impressions != null) last7Parts.push(`imp=${fmtAggInt(ad.last_7_impressions)}`);
      if (ad.last_7_ctr != null) last7Parts.push(`ctr=${fmtAggPct(ad.last_7_ctr)}`);
      if (ad.last_7_roas_platform != null) last7Parts.push(`roas=${fmtAgg2(ad.last_7_roas_platform)}`);
      if (ad.last_7_frequency != null) last7Parts.push(`freq=${fmtAgg2(ad.last_7_frequency)}`);
      if (ad.last_7_frequency_enriched != null) last7Parts.push(`freq_enriched=${fmtAgg2(ad.last_7_frequency_enriched)}`);
      if (last7Parts.length > 0) bodyLines.push(`  last_7: ${last7Parts.join(' | ')}`);

      const last30Parts = [];
      if (ad.last_30_ctr != null) last30Parts.push(`ctr=${fmtAggPct(ad.last_30_ctr)}`);
      if (ad.last_30_roas_platform != null) last30Parts.push(`roas=${fmtAgg2(ad.last_30_roas_platform)}`);
      if (last30Parts.length > 0) bodyLines.push(`  last_30: ${last30Parts.join(' | ')}`);

      const flagParts = [];
      if (ad.ctr_vs_account_avg != null) flagParts.push(`ctr_vs_avg=${fmtAgg2(ad.ctr_vs_account_avg)}`);
      if (ad.roas_vs_account_avg != null) flagParts.push(`roas_vs_avg=${fmtAgg2(ad.roas_vs_account_avg)}`);
      if (ad.landing_page_cvr_7d != null) flagParts.push(`lpv_cvr_7d=${fmtAggPct(ad.landing_page_cvr_7d)}`);
      if (ad.add_to_cart_rate_7d != null) flagParts.push(`atc_rate_7d=${fmtAggPct(ad.add_to_cart_rate_7d)}`);
      if (ad.fatigue_flag === true) flagParts.push(`fatigue=true`);
      if (ad.top_performer_flag === true) flagParts.push(`top_performer=true`);
      if (flagParts.length > 0) bodyLines.push(`  flags: ${flagParts.join(' | ')}`);

      if (ad.asset_url) bodyLines.push(`  asset_url: ${safeStr(ad.asset_url).trim()}`);

      if (bodyLines.length === 0) continue;
      adLines.push(`- [${platform}] "${name}"${headerParts.length > 0 ? ` (${headerParts.join(' | ')})` : ''}`);
      for (const l of bodyLines) adLines.push(l);
    }

    if (adLines.length > 0) {
      lines.push('');
      lines.push('[ADS]');
      for (const l of adLines) lines.push(l);
    }
  }

  // --- CAMPAIGNS DAILY (per-campaign day-by-day performance) ---
  //
  // Rows come from mcpContextBuilder.buildCampaignsDailySchema. Each entry is
  // per-campaign with a nested `days` array (one per date). We group visually by
  // campaign and render each day underneath. No cap — user wants full day-by-day
  // visibility when Fase D2 populates this upstream.
  if (Array.isArray(campaignsDailyRows) && campaignsDailyRows.length > 0) {
    const outLines = [];
    for (const entry of campaignsDailyRows) {
      if (!entry || typeof entry !== 'object') continue;
      const platform = safeStr(entry.platform).trim().toUpperCase() || 'UNKNOWN';
      const name = safeStr(entry.campaign_name).trim() || safeStr(entry.campaign_id).trim() || 'unnamed';
      const days = Array.isArray(entry.days) ? entry.days : [];
      if (days.length === 0) continue;

      const dayLines = [];
      const sortedDays = days.slice().sort((a, b) =>
        safeStr(a?.date).localeCompare(safeStr(b?.date))
      );
      for (const d of sortedDays) {
        if (!d || typeof d !== 'object') continue;
        const date = safeStr(d.date).trim();
        if (!date) continue;
        const parts = [];
        if (d.spend != null) parts.push(`spend=${fmtAggInt(d.spend)}`);
        if (d.impressions != null) parts.push(`imp=${fmtAggInt(d.impressions)}`);
        if (d.clicks != null) parts.push(`clicks=${fmtAggInt(d.clicks)}`);
        if (d.ctr != null) parts.push(`ctr=${fmtAggPct(d.ctr)}`);
        if (d.cpc != null) parts.push(`cpc=${fmtAgg2(d.cpc)}`);
        if (d.cpm != null) parts.push(`cpm=${fmtAgg2(d.cpm)}`);
        if (d.conversions != null) parts.push(`conv=${fmtAggInt(d.conversions)}`);
        if (d.conversion_value != null) parts.push(`cv=${fmtAggInt(d.conversion_value)}`);
        if (d.roas != null) parts.push(`roas=${fmtAgg2(d.roas)}`);
        if (parts.length > 0) dayLines.push(`  ${date}: ${parts.join(' | ')}`);
      }

      if (dayLines.length === 0) continue;
      outLines.push(`- [${platform}] "${name}":`);
      for (const l of dayLines) outLines.push(l);
    }

    if (outLines.length > 0) {
      lines.push('');
      lines.push('[CAMPAIGNS_DAILY]');
      for (const l of outLines) lines.push(l);
    }
  }

  // --- ADS DAILY (per-ad day-by-day performance) ---
  //
  // Rows come from mcpContextBuilder.buildAdsDailySchema. Each entry is per-ad
  // with a nested `days` array. Grouped visually by ad. No cap.
  if (Array.isArray(adsDailyRows) && adsDailyRows.length > 0) {
    const outLines = [];
    for (const entry of adsDailyRows) {
      if (!entry || typeof entry !== 'object') continue;
      const platform = safeStr(entry.platform).trim().toUpperCase() || 'UNKNOWN';
      const name = safeStr(entry.ad_name).trim() || safeStr(entry.ad_id).trim() || 'unnamed';
      const campaignName = safeStr(entry.campaign_name).trim();
      const days = Array.isArray(entry.days) ? entry.days : [];
      if (days.length === 0) continue;

      const dayLines = [];
      const sortedDays = days.slice().sort((a, b) =>
        safeStr(a?.date).localeCompare(safeStr(b?.date))
      );
      for (const d of sortedDays) {
        if (!d || typeof d !== 'object') continue;
        const date = safeStr(d.date).trim();
        if (!date) continue;
        const parts = [];
        if (d.spend != null) parts.push(`spend=${fmtAggInt(d.spend)}`);
        if (d.impressions != null) parts.push(`imp=${fmtAggInt(d.impressions)}`);
        if (d.clicks != null) parts.push(`clicks=${fmtAggInt(d.clicks)}`);
        if (d.ctr != null) parts.push(`ctr=${fmtAggPct(d.ctr)}`);
        if (d.cpc != null) parts.push(`cpc=${fmtAgg2(d.cpc)}`);
        if (d.conversions != null) parts.push(`conv=${fmtAggInt(d.conversions)}`);
        if (d.conversion_value != null) parts.push(`cv=${fmtAggInt(d.conversion_value)}`);
        if (d.roas != null) parts.push(`roas=${fmtAgg2(d.roas)}`);
        if (parts.length > 0) dayLines.push(`  ${date}: ${parts.join(' | ')}`);
      }

      if (dayLines.length === 0) continue;
      const header = campaignName
        ? `- [${platform}] "${name}" (campaign="${campaignName}"):`
        : `- [${platform}] "${name}":`;
      outLines.push(header);
      for (const l of dayLines) outLines.push(l);
    }

    if (outLines.length > 0) {
      lines.push('');
      lines.push('[ADS_DAILY]');
      for (const l of outLines) lines.push(l);
    }
  }

  // --- LANDING PAGES DAILY ---
  if (Array.isArray(landingPagesDailyRows) && landingPagesDailyRows.length > 0) {
    lines.push('');
    lines.push('[LANDING_PAGES_DAILY]');
    for (const row of landingPagesDailyRows.slice(0, 30)) {
      const page = row?.page || row?.landing_page || '?';
      const date = row?.date || '?';
      const parts = [];
      if (row?.sessions != null) parts.push(`sessions=${row.sessions}`);
      if (row?.conversions != null) parts.push(`conv=${row.conversions}`);
      if (row?.revenue != null) parts.push(`revenue=${Number(row.revenue).toFixed(0)}`);
      if (row?.engagement_rate != null) parts.push(`eng=${Number(row.engagement_rate).toFixed(1)}%`);
      if (parts.length > 0) lines.push(`- ${page} | ${date} | ${parts.join(' | ')}`);
    }
  }

  // --- ANOMALIES ---
  if (Array.isArray(anomalies) && anomalies.length > 0) {
    lines.push('');
    lines.push('[ANOMALIES]');
    for (const a of anomalies.slice(0, 20)) {
      const type = a?.type ? `[${String(a.type).toUpperCase()}] ` : '';
      const metric = a?.metric || a?.field || '?';
      const desc = a?.description || a?.message || '';
      lines.push(`- ${type}${metric}: ${desc}`);
    }
  }

  // --- BENCHMARKS ---
  if (benchmarks && typeof benchmarks === 'object') {
    lines.push('');
    lines.push('[BENCHMARKS]');
    for (const [key, val] of Object.entries(benchmarks)) {
      if (!val || typeof val !== 'object') continue;
      const curr = val?.current_value != null ? Number(val.current_value).toFixed(2) : 'n/a';
      const prior = val?.prior_value != null ? Number(val.prior_value).toFixed(2) : 'n/a';
      const pct = val?.pct_change != null ? `${Number(val.pct_change).toFixed(1)}%` : 'n/a';
      const trend = val?.trend ? String(val.trend).toUpperCase() : 'n/a';
      lines.push(`- ${key}: current=${curr} | prior=${prior} | chg=${pct} | trend=${trend}`);
    }
  }

  if (existingDetailedText) {
    lines.push('');
    lines.push('[LEGACY_CONTEXT_APPENDIX]');
    lines.push(existingDetailedText);
  }

  return lines.join('\n').trim();
}

function buildEncodedContextMini({ summary = {}, priorityActions = [], existingMiniText = '' }) {
  const blocks = [
    safeStr(summary?.executive_summary).trim(),
    safeStr(summary?.business_state).trim(),
    ...uniqStrings(priorityActions, 3).map((action) => `Action: ${action}`),
    safeStr(existingMiniText).trim(),
  ].filter(Boolean);

  return blocks.join('\n').trim();
}

function encodeSignalPayload({ signalPayload, unifiedBase, root, user }) {
  const payload = signalPayload && typeof signalPayload === 'object' ? signalPayload : {};
  const structuredSignal = payload?.structured_signal && typeof payload.structured_signal === 'object'
    ? payload.structured_signal
    : null;
  const ai = root?.aiContext && typeof root.aiContext === 'object' ? root.aiContext : {};

  const generatedAt =
    safeStr(payload?.generatedAt).trim() ||
    safeStr(ai?.finishedAt).trim() ||
    nowIso();

  const sourceFingerprint =
    safeStr(payload?.sourceFingerprint).trim() ||
    safeStr(ai?.sourceFingerprint).trim() ||
    safeStr(unifiedBase?.sourceFingerprint).trim() ||
    null;

  const connectionFingerprint =
    safeStr(payload?.connectionFingerprint).trim() ||
    safeStr(ai?.connectionFingerprint).trim() ||
    safeStr(unifiedBase?.connectionFingerprint).trim() ||
    null;

  const contextWindow =
    payload?.contextWindow ||
    ai?.contextWindow ||
    unifiedBase?.contextWindow ||
    null;

  const summary = payload?.summary && typeof payload.summary === 'object'
    ? payload.summary
    : {};

  const positives = uniqStrings(summary?.positives || payload?.positives || [], 12);
  const negatives = uniqStrings(summary?.negatives || payload?.negatives || [], 12);
  const priorityActions = uniqStrings(summary?.priority_actions || payload?.priority_actions || [], 14);

  const existingDetailedText = pickFirstText(
    payload?.encoded_context,
    payload?.llm_context_block,
    payload?.signal
  );

  const existingMiniText = pickFirstText(
    payload?.encoded_context_mini,
    payload?.llm_context_block_mini
  );

  const workspaceName = pickFirstText(
    payload?.workspaceName,
    structuredSignal?.meta?.workspace_name,
    root?.workspaceName,
    root?.sources?.metaAds?.name,
    root?.sources?.googleAds?.name,
    root?.sources?.ga4?.name,
    user?.companyName,
    user?.workspaceName,
    user?.businessName,
    user?.name
  );

  const encodedContext = buildEncodedContextText({
    workspaceName,
    generatedAt,
    sourceFingerprint,
    connectionFingerprint,
    contextWindow,
    summary,
    performanceDrivers: uniqStrings(payload?.performance_drivers || [], 12),
    conversionBottlenecks: uniqStrings(payload?.conversion_bottlenecks || [], 12),
    scalingOpportunities: uniqStrings(payload?.scaling_opportunities || [], 12),
    riskFlags: uniqStrings(payload?.risk_flags || negatives || [], 12),
    priorityActions,
    existingDetailedText,
    dailyIndex: Array.isArray(structuredSignal?.daily_index) ? structuredSignal.daily_index : [],
    campaignsDailyRows: Array.isArray(structuredSignal?.campaigns_daily) ? structuredSignal.campaigns_daily : [],
    adsDailyRows: Array.isArray(structuredSignal?.ads_daily) ? structuredSignal.ads_daily : [],
    landingPagesDailyRows: Array.isArray(structuredSignal?.landing_pages_daily) ? structuredSignal.landing_pages_daily : [],
    anomalies: Array.isArray(structuredSignal?.anomalies) ? structuredSignal.anomalies : [],
    benchmarks: structuredSignal?.benchmarks && typeof structuredSignal.benchmarks === 'object'
      ? structuredSignal.benchmarks
      : null,
    campaigns: Array.isArray(structuredSignal?.campaigns) ? structuredSignal.campaigns : [],
    adSets: Array.isArray(structuredSignal?.ad_sets) ? structuredSignal.ad_sets : [],
    ads: Array.isArray(structuredSignal?.ads) ? structuredSignal.ads : [],
  });

  const encodedContextMini = buildEncodedContextMini({
    summary,
    priorityActions,
    existingMiniText,
  });

  return {
    format: 'adray.signal.encoded_payload',
    version: '1.0',
    generatedAt,
    providerAgnostic: true,
    sourceFingerprint,
    connectionFingerprint,
    contextWindow: toSerializable(contextWindow, null),

    meta: {
      rootId: safeStr(root?._id).trim() || null,
      userId: safeStr(user?._id).trim() || null,
      workspaceName: workspaceName || null,
      snapshotId: safeStr(unifiedBase?.snapshotId).trim() || null,
      schema: safeStr(unifiedBase?.schema).trim() || null,
    },

    lineage: {
      signalGeneratedAt: safeStr(payload?.generatedAt).trim() || null,
      sourceSnapshots: toSerializable(
        payload?.sourceSnapshots || ai?.sourceSnapshots || unifiedBase?.sourceSnapshots || null,
        null
      ),
      contextPolicy: toSerializable(payload?.contextPolicy || ai?.contextPolicy || unifiedBase?.contextPolicy || null, null),
    },

    signal: {
      summary: toSerializable(summary, {}),
      performance_drivers: uniqStrings(payload?.performance_drivers || [], 12),
      conversion_bottlenecks: uniqStrings(payload?.conversion_bottlenecks || [], 12),
      scaling_opportunities: uniqStrings(payload?.scaling_opportunities || [], 12),
      risk_flags: uniqStrings(payload?.risk_flags || negatives || [], 12),
      prompt_hints: uniqStrings(payload?.prompt_hints || [], 20),
      channel_story: toSerializable(payload?.channel_story || null, null),
      structured_signal: toSerializable(
        structuredSignal || {
          schema: payload?.schema || null,
          meta: payload?.meta || null,
          daily_index: payload?.daily_index || [],
          campaigns: payload?.campaigns || [],
          anomalies: payload?.anomalies || [],
          benchmarks: payload?.benchmarks || null,
        },
        null
      ),
    },

    blocks: {
      encoded_context: encodedContext,
      encoded_context_mini: encodedContextMini || encodedContext,
    },

    encoded_context: encodedContext,
    encoded_context_mini: encodedContextMini || encodedContext,
  };
}

function extractEncodedSignalText(encodedPayload) {
  if (!encodedPayload || typeof encodedPayload !== 'object') return '';

  return pickFirstText(
    encodedPayload?.blocks?.encoded_context,
    encodedPayload?.encoded_context,
    encodedPayload?.blocks?.encoded_context_mini,
    encodedPayload?.encoded_context_mini,
    encodedPayload?.llm_context_block,
    encodedPayload?.llm_context_block_mini
  );
}

function isEncodedSignalPayloadBuildableForPdf(encodedPayload) {
  if (!encodedPayload || typeof encodedPayload !== 'object') return false;

  const text = extractEncodedSignalText(encodedPayload);
  if (!text) return false;

  const format = safeStr(encodedPayload?.format).trim();
  const version = safeStr(encodedPayload?.version).trim();
  const hasExpectedMetadata = Boolean(format && version);

  return text.length >= 80 && hasExpectedMetadata;
}

module.exports = {
  encodeSignalPayload,
  isEncodedSignalPayloadBuildableForPdf,
  extractEncodedSignalText,
};
