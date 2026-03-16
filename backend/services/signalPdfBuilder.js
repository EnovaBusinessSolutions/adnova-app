'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let PDFDocument = null;
try {
  PDFDocument = require('pdfkit');
} catch (_) {
  PDFDocument = null;
}

let puppeteer = null;
try {
  puppeteer = require('puppeteer');
} catch (_) {
  puppeteer = null;
}

const APP_URL = String(process.env.APP_URL || 'https://adray.ai').replace(/\/$/, '');
const SIGNAL_PDF_PUBLIC_BASE =
  String(process.env.SIGNAL_PDF_PUBLIC_BASE || `${APP_URL}/api/mcp/context/pdf/download`).replace(/\/$/, '');
const SIGNAL_PDF_STORAGE_DIR = process.env.SIGNAL_PDF_STORAGE_DIR
  ? path.resolve(process.env.SIGNAL_PDF_STORAGE_DIR)
  : path.resolve(process.cwd(), 'uploads', 'signals');

const SIGNAL_PDF_ALLOW_PDFKIT_FALLBACK =
  String(process.env.SIGNAL_PDF_ALLOW_PDFKIT_FALLBACK || 'false').trim().toLowerCase() === 'true';

const PUPPETEER_HEADLESS_MODE =
  String(process.env.PUPPETEER_HEADLESS_MODE || 'true').trim().toLowerCase() === 'false'
    ? false
    : true;

const PUPPETEER_LAUNCH_TIMEOUT_MS = Number(process.env.PUPPETEER_LAUNCH_TIMEOUT_MS || 90000);
const PUPPETEER_RENDER_TIMEOUT_MS = Number(process.env.PUPPETEER_RENDER_TIMEOUT_MS || 90000);

function safeStr(v) {
  return v == null ? '' : String(v);
}

function toNum(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function clampInt(n, min, max) {
  const x = Number(n || 0);
  if (!Number.isFinite(x)) return min;
  return Math.max(min, Math.min(max, Math.trunc(x)));
}

function nowIso() {
  return new Date().toISOString();
}

function compactArray(arr, max = 999) {
  return Array.isArray(arr) ? arr.filter(Boolean).slice(0, Math.max(0, max)) : [];
}

function uniqStrings(arr, max = 999) {
  const out = [];
  const seen = new Set();
  for (const item of Array.isArray(arr) ? arr : []) {
    const s = safeStr(item).trim();
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

function escapeHtml(input) {
  return safeStr(input)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function slugify(input, fallback = 'signal') {
  const base = safeStr(input)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();

  return base || fallback;
}

function formatDateLong(iso) {
  const d = iso ? new Date(iso) : new Date();
  if (Number.isNaN(d.getTime())) return safeStr(iso) || nowIso().slice(0, 10);
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(d);
}

function formatDateTimeLong(iso) {
  const d = iso ? new Date(iso) : new Date();
  if (Number.isNaN(d.getTime())) return safeStr(iso) || nowIso();
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(d);
}

function ensureDirSync(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function fileExistsSync(p) {
  try {
    return !!p && fs.existsSync(p);
  } catch (_) {
    return false;
  }
}

function isExecutableFileSync(p) {
  try {
    if (!p) return false;
    fs.accessSync(p, fs.constants.F_OK | fs.constants.X_OK);
    return true;
  } catch (_) {
    return false;
  }
}

function readMaybeBase64Image(imagePath) {
  if (!imagePath || !fileExistsSync(imagePath)) return null;
  const ext = path.extname(imagePath).toLowerCase();
  const mime =
    ext === '.png' ? 'image/png' :
    ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' :
    ext === '.webp' ? 'image/webp' :
    null;

  if (!mime) return null;

  try {
    const b64 = fs.readFileSync(imagePath).toString('base64');
    return `data:${mime};base64,${b64}`;
  } catch (_) {
    return null;
  }
}

function resolveBrandCoverImage() {
  const candidates = [
    process.env.SIGNAL_PDF_COVER_IMAGE,
    path.resolve('/mnt/data/43c994ee-1c37-4a64-b44e-311daafe653f.png'),
    path.resolve('/mnt/data/4f5bc5b7-bd0b-4a95-a249-eeca2ce26114.png'),
  ].filter(Boolean);

  for (const c of candidates) {
    if (fileExistsSync(c)) return c;
  }
  return null;
}

function getWorkspaceName({ root, signalPayload, user }) {
  const explicit =
    root?.sources?.metaAds?.name ||
    root?.sources?.googleAds?.name ||
    root?.sources?.ga4?.name ||
    user?.companyName ||
    user?.workspaceName ||
    user?.businessName ||
    user?.name ||
    signalPayload?.workspaceName ||
    signalPayload?.accountName ||
    'Adray Workspace';

  return safeStr(explicit).trim() || 'Adray Workspace';
}

function getConnectedSources(root) {
  const out = [];

  if (root?.sources?.metaAds?.connected || root?.sources?.metaAds?.ready) {
    out.push('Meta Ads');
  }
  if (root?.sources?.googleAds?.connected || root?.sources?.googleAds?.ready) {
    out.push('Google Ads');
  }
  if (root?.sources?.ga4?.connected || root?.sources?.ga4?.ready) {
    out.push('GA4');
  }

  return out;
}

function buildPromptHints(signalPayload) {
  const hints = uniqStrings(signalPayload?.prompt_hints || [], 8);
  if (hints.length > 0) return hints;

  const summary = signalPayload?.summary || {};
  return uniqStrings([
    'Summarize the current business state using this Signal as the source of truth.',
    'Identify the top 3 growth opportunities and explain why they matter now.',
    'Find the main risks reducing ROAS, conversion efficiency, or revenue quality.',
    'Build a 30-day action plan using the priority actions from this Signal.',
    ...(summary?.priority_actions || []).slice(0, 3).map((x) => `Turn this action into an execution checklist: ${x}`),
  ], 6);
}

function resolveSignalSections(signalPayload) {
  const summary = signalPayload?.summary || {};
  const performanceDrivers = uniqStrings(signalPayload?.performance_drivers || [], 8);
  const bottlenecks = uniqStrings(signalPayload?.conversion_bottlenecks || [], 8);
  const scaling = uniqStrings(signalPayload?.scaling_opportunities || [], 8);
  const risks = uniqStrings(signalPayload?.risk_flags || summary?.negatives || [], 8);
  const actions = uniqStrings(summary?.priority_actions || [], 10);
  const positives = uniqStrings(summary?.positives || [], 8);
  const prompts = buildPromptHints(signalPayload);

  return {
    executiveSummary: safeStr(summary?.executive_summary).trim(),
    businessState: safeStr(summary?.business_state).trim(),
    crossChannelStory: safeStr(summary?.cross_channel_story).trim(),
    positives,
    risks,
    actions,
    performanceDrivers,
    bottlenecks,
    scaling,
    prompts,
    llmContextBlock: safeStr(signalPayload?.llm_context_block).trim(),
    llmContextBlockMini: safeStr(signalPayload?.llm_context_block_mini).trim(),
    channelStory: signalPayload?.channel_story || {},
  };
}

function extractKpiChips(signalPayload) {
  const out = [];
  const channelStory = signalPayload?.channel_story || {};

  const metaHeadline = channelStory?.meta_ads?.mini?.headline_kpis || null;
  const googleHeadline = channelStory?.google_ads?.mini?.headline_kpis || null;
  const ga4Headline =
    channelStory?.ga4?.mini?.data?.headline_kpis ||
    channelStory?.ga4?.mini?.headline_kpis ||
    null;

  if (metaHeadline) {
    out.push(`Meta ROAS ${safeStr(metaHeadline.roas || 'n/a')}`);
    out.push(`Meta Spend ${safeStr(metaHeadline.spend || 'n/a')}`);
  }

  if (googleHeadline) {
    out.push(`Google ROAS ${safeStr(googleHeadline.roas || 'n/a')}`);
    out.push(`Google Spend ${safeStr(googleHeadline.spend || 'n/a')}`);
  }

  if (ga4Headline) {
    out.push(`GA4 Sessions ${safeStr(ga4Headline.sessions || 'n/a')}`);
    out.push(`GA4 Revenue ${safeStr(ga4Headline.revenue || 'n/a')}`);
  }

  return uniqStrings(out, 8);
}

function buildLineage(root, signalPayload) {
  const ai = root?.aiContext || {};
  const contextWindow =
    signalPayload?.contextWindow ||
    ai?.signalPayload?.contextWindow ||
    ai?.encodedPayload?.contextWindow ||
    null;

  const sourceSnapshots = ai?.sourceSnapshots || signalPayload?.sourceSnapshots || null;

  return {
    generatedAt: ai?.finishedAt || signalPayload?.generatedAt || nowIso(),
    contextRangeDays: toNum(ai?.contextRangeDays) || toNum(contextWindow?.rangeDays) || null,
    storageRangeDays: toNum(ai?.storageRangeDays) || toNum(contextWindow?.storageRangeDays) || null,
    snapshotId: safeStr(ai?.snapshotId || root?.latestSnapshotId || '').trim() || null,
    sourceSnapshots,
  };
}

function buildSignalPdfModel({ userId, root, signalPayload, user = null }) {
  if (!signalPayload || typeof signalPayload !== 'object') {
    const err = new Error('SIGNAL_PDF_MISSING_SIGNAL_PAYLOAD');
    err.code = 'SIGNAL_PDF_MISSING_SIGNAL_PAYLOAD';
    throw err;
  }

  const workspaceName = getWorkspaceName({ root, signalPayload, user });
  const connectedSources = getConnectedSources(root);
  const sections = resolveSignalSections(signalPayload);
  const lineage = buildLineage(root, signalPayload);
  const kpiChips = extractKpiChips(signalPayload);
  const promptHints = sections.prompts;
  const signalVersion = safeStr(signalPayload?.schema || 'adray.encoded.context.v2');
  const providerTag = root?.aiContext?.usedOpenAI ? (root?.aiContext?.model || 'OpenAI') : 'Adray Engine';

  return {
    userId: safeStr(userId),
    workspaceName,
    connectedSources,
    sourceCount: connectedSources.length,
    generatedAt: lineage.generatedAt,
    generatedAtLong: formatDateTimeLong(lineage.generatedAt),
    generatedDateLong: formatDateLong(lineage.generatedAt),
    contextRangeDays: lineage.contextRangeDays,
    storageRangeDays: lineage.storageRangeDays,
    snapshotId: lineage.snapshotId,
    sourceSnapshots: lineage.sourceSnapshots || {},
    signalVersion,
    providerTag,
    sections,
    kpiChips,
    promptHints,
  };
}

function renderListItems(items, opts = {}) {
  const max = opts.max || 8;
  const emptyLabel = opts.emptyLabel || 'No items available.';
  const icon = opts.icon || '•';
  const list = compactArray(items, max);

  if (list.length === 0) {
    return `<li class="empty">${escapeHtml(emptyLabel)}</li>`;
  }

  return list
    .map((item) => `<li><span class="bullet">${escapeHtml(icon)}</span><span>${escapeHtml(item)}</span></li>`)
    .join('');
}

function renderChannelBlock(title, payload, emptyMessage) {
  if (!payload) {
    return `
      <div class="channel-card">
        <div class="channel-header">
          <h3>${escapeHtml(title)}</h3>
        </div>
        <p class="muted">${escapeHtml(emptyMessage)}</p>
      </div>
    `;
  }

  const mini = payload?.mini?.data || payload?.mini || {};
  const full = payload?.full?.data || payload?.full || {};
  const headline = mini?.headline_kpis || {};
  const priority = mini?.priority_summary || full?.priority_summary || {};

  const chips = uniqStrings([
    headline?.spend ? `Spend ${headline.spend}` : '',
    headline?.roas ? `ROAS ${headline.roas}` : '',
    headline?.purchases ? `Purchases ${headline.purchases}` : '',
    headline?.conversions ? `Conversions ${headline.conversions}` : '',
    headline?.conversion_value ? `Conv. Value ${headline.conversion_value}` : '',
    headline?.sessions ? `Sessions ${headline.sessions}` : '',
    headline?.revenue ? `Revenue ${headline.revenue}` : '',
    headline?.engagementRate ? `Engagement ${headline.engagementRate}` : '',
  ], 4);

  return `
    <div class="channel-card">
      <div class="channel-header">
        <h3>${escapeHtml(title)}</h3>
      </div>

      ${chips.length > 0 ? `
        <div class="chip-row">
          ${chips.map((x) => `<span class="soft-chip">${escapeHtml(x)}</span>`).join('')}
        </div>
      ` : ''}

      <div class="grid-2 inner-grid">
        <div class="sub-card">
          <div class="sub-title">Top Positives</div>
          <ul class="mini-list">
            ${renderListItems(priority?.positives || [], { max: 4, emptyLabel: 'No positives captured.' })}
          </ul>
        </div>
        <div class="sub-card">
          <div class="sub-title">Priority Actions</div>
          <ul class="mini-list">
            ${renderListItems(priority?.actions || [], { max: 4, emptyLabel: 'No actions captured.' })}
          </ul>
        </div>
      </div>
    </div>
  `;
}

function buildSignalPdfHtml(model) {
  const coverImagePath = resolveBrandCoverImage();
  const coverImageDataUri = readMaybeBase64Image(coverImagePath);

  const historyLabel =
    model.storageRangeDays && model.contextRangeDays
      ? `${model.contextRangeDays} days active reasoning · ${model.storageRangeDays} days stored`
      : model.contextRangeDays
        ? `${model.contextRangeDays} day active reasoning window`
        : model.storageRangeDays
          ? `${model.storageRangeDays} days historical storage`
          : 'Cross-channel historical signal ready';

  const snapshotMeta = uniqStrings([
    model.snapshotId ? `Snapshot ${model.snapshotId}` : '',
    model.signalVersion ? `Schema ${model.signalVersion}` : '',
    model.providerTag ? `Built with ${model.providerTag}` : '',
  ], 3);

  const section = model.sections;
  const channelStory = section.channelStory || {};

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${escapeHtml(model.workspaceName)} Signal PDF</title>
<style>
  :root{
    --bg:#0b0b10;
    --panel:#11131a;
    --panel-2:#151823;
    --line:rgba(255,255,255,.10);
    --line-soft:rgba(255,255,255,.06);
    --text:#f5f7ff;
    --muted:rgba(235,240,255,.66);
    --muted-2:rgba(235,240,255,.48);
    --purple:#b55cff;
    --purple-2:#df9aff;
    --mint:#4fe3c1;
    --mint-2:#8ff6df;
    --danger:#ff7f9d;
    --gold:#ffd47a;
  }
  *{ box-sizing:border-box; }
  html,body{ margin:0; padding:0; background:var(--bg); color:var(--text); font-family:Inter,Arial,Helvetica,sans-serif; }
  body{ -webkit-print-color-adjust:exact; print-color-adjust:exact; }

  .page{
    width:100%;
    min-height:100vh;
    padding:28px;
  }
  .cover{
    position:relative;
    overflow:hidden;
    background:
      radial-gradient(920px 420px at 8% 8%, rgba(181,92,255,.20), transparent 60%),
      radial-gradient(820px 380px at 100% 0%, rgba(79,227,193,.16), transparent 55%),
      radial-gradient(980px 420px at 50% 100%, rgba(255,255,255,.06), transparent 60%),
      linear-gradient(180deg, #0d1017 0%, #090a10 100%);
    border:1px solid rgba(255,255,255,.10);
    border-radius:28px;
    padding:28px;
  }
  .cover::after{
    content:"";
    position:absolute;
    inset:0;
    background:
      linear-gradient(135deg, rgba(255,255,255,.03), transparent 24%),
      radial-gradient(circle at 18% 10%, rgba(181,92,255,.10), transparent 22%),
      radial-gradient(circle at 82% 16%, rgba(79,227,193,.08), transparent 18%);
    pointer-events:none;
  }
  .brand-row{
    position:relative;
    z-index:1;
    display:flex;
    align-items:center;
    justify-content:space-between;
    gap:18px;
  }
  .brand-left{
    display:flex;
    align-items:center;
    gap:12px;
  }
  .logo-box{
    width:42px;
    height:42px;
    border-radius:14px;
    border:1px solid rgba(181,92,255,.18);
    background:rgba(181,92,255,.12);
    display:flex;
    align-items:center;
    justify-content:center;
    font-weight:800;
    letter-spacing:.08em;
    font-size:13px;
  }
  .eyebrow{
    display:inline-flex;
    align-items:center;
    gap:8px;
    padding:8px 12px;
    border:1px solid rgba(181,92,255,.20);
    background:rgba(181,92,255,.10);
    color:#eddcff;
    border-radius:999px;
    font-size:10px;
    font-weight:700;
    letter-spacing:.18em;
    text-transform:uppercase;
  }
  .eyebrow .dot{
    width:7px;
    height:7px;
    border-radius:999px;
    background:var(--mint);
    box-shadow:0 0 12px rgba(79,227,193,.55);
  }
  .cover-grid{
    position:relative;
    z-index:1;
    display:grid;
    grid-template-columns:1.35fr .95fr;
    gap:22px;
    margin-top:22px;
  }
  .headline{
    font-size:42px;
    line-height:1.02;
    letter-spacing:-.04em;
    margin:16px 0 0;
    font-weight:900;
  }
  .headline .grad{
    background:linear-gradient(90deg,var(--purple) 0%, #fff 48%, var(--mint) 100%);
    -webkit-background-clip:text;
    background-clip:text;
    color:transparent;
  }
  .sub{
    margin-top:16px;
    max-width:720px;
    font-size:14px;
    line-height:1.75;
    color:var(--muted);
  }
  .cover-art{
    border:1px solid rgba(255,255,255,.10);
    background:rgba(255,255,255,.03);
    border-radius:24px;
    overflow:hidden;
    min-height:280px;
    display:flex;
    align-items:center;
    justify-content:center;
    position:relative;
  }
  .cover-art img{
    width:100%;
    height:100%;
    object-fit:cover;
    display:block;
  }
  .cover-art .fallback{
    width:100%;
    height:100%;
    min-height:280px;
    background:
      radial-gradient(circle at 20% 20%, rgba(181,92,255,.20), transparent 24%),
      radial-gradient(circle at 82% 18%, rgba(79,227,193,.18), transparent 20%),
      radial-gradient(circle at 50% 100%, rgba(255,255,255,.08), transparent 30%),
      linear-gradient(180deg, #141825 0%, #0d1018 100%);
  }
  .stats-grid{
    position:relative;
    z-index:1;
    display:grid;
    grid-template-columns:repeat(4,minmax(0,1fr));
    gap:12px;
    margin-top:22px;
  }
  .stat{
    border:1px solid var(--line);
    border-radius:20px;
    background:rgba(255,255,255,.03);
    padding:16px 16px 14px;
  }
  .stat-label{
    font-size:10px;
    letter-spacing:.16em;
    text-transform:uppercase;
    color:var(--muted-2);
  }
  .stat-value{
    margin-top:10px;
    font-size:22px;
    line-height:1.1;
    font-weight:800;
    letter-spacing:-.03em;
  }
  .stat-note{
    margin-top:8px;
    font-size:12px;
    color:var(--muted);
    line-height:1.5;
  }
  .chip-row{
    display:flex;
    flex-wrap:wrap;
    gap:8px;
    margin-top:14px;
  }
  .soft-chip{
    display:inline-flex;
    align-items:center;
    gap:6px;
    border-radius:999px;
    border:1px solid rgba(255,255,255,.09);
    padding:8px 11px;
    background:rgba(255,255,255,.03);
    font-size:11px;
    color:var(--text);
  }
  .section{
    margin-top:18px;
    border:1px solid rgba(255,255,255,.10);
    border-radius:24px;
    background:linear-gradient(180deg, rgba(255,255,255,.035), rgba(255,255,255,.02));
    overflow:hidden;
  }
  .section-inner{ padding:22px; }
  .section-kicker{
    display:inline-flex;
    align-items:center;
    gap:8px;
    font-size:10px;
    letter-spacing:.17em;
    text-transform:uppercase;
    color:#ead8ff;
    border:1px solid rgba(181,92,255,.18);
    background:rgba(181,92,255,.10);
    border-radius:999px;
    padding:8px 12px;
  }
  .section-title{
    margin:16px 0 0;
    font-size:28px;
    line-height:1.05;
    letter-spacing:-.04em;
    font-weight:850;
  }
  .section-body{
    margin-top:14px;
    color:var(--muted);
    font-size:14px;
    line-height:1.8;
  }
  .grid-2{
    display:grid;
    grid-template-columns:repeat(2,minmax(0,1fr));
    gap:14px;
  }
  .grid-3{
    display:grid;
    grid-template-columns:repeat(3,minmax(0,1fr));
    gap:14px;
  }
  .card{
    border:1px solid var(--line);
    border-radius:20px;
    background:rgba(255,255,255,.03);
    padding:16px;
  }
  .card-title{
    font-size:12px;
    letter-spacing:.16em;
    text-transform:uppercase;
    color:var(--muted-2);
    margin:0 0 10px;
  }
  .card p{
    margin:0;
    color:var(--muted);
    font-size:13px;
    line-height:1.8;
  }
  ul.list, ul.mini-list{
    list-style:none;
    padding:0;
    margin:0;
  }
  ul.list li, ul.mini-list li{
    display:flex;
    gap:10px;
    margin:0;
    padding:0;
    color:var(--text);
    line-height:1.7;
  }
  ul.list li + li{ margin-top:10px; }
  ul.mini-list li + li{ margin-top:8px; }
  .bullet{
    color:var(--mint);
    flex:0 0 auto;
    font-weight:700;
  }
  .empty{
    color:var(--muted);
  }
  .quote{
    border-left:3px solid rgba(79,227,193,.55);
    padding-left:14px;
    color:#eefcf8;
    white-space:pre-wrap;
    font-size:13px;
    line-height:1.8;
  }
  .channel-card{
    border:1px solid var(--line);
    border-radius:20px;
    background:rgba(255,255,255,.03);
    padding:16px;
  }
  .channel-header{
    display:flex;
    align-items:center;
    justify-content:space-between;
    gap:10px;
    margin-bottom:10px;
  }
  .channel-header h3{
    margin:0;
    font-size:18px;
    letter-spacing:-.02em;
  }
  .inner-grid{ margin-top:12px; }
  .sub-card{
    border:1px solid var(--line-soft);
    border-radius:16px;
    background:rgba(255,255,255,.02);
    padding:12px;
  }
  .sub-title{
    font-size:11px;
    text-transform:uppercase;
    letter-spacing:.15em;
    color:var(--muted-2);
    margin-bottom:10px;
  }
  .muted{
    color:var(--muted);
    font-size:13px;
    line-height:1.7;
  }
  .footer-note{
    margin-top:16px;
    color:var(--muted-2);
    font-size:11px;
    line-height:1.7;
  }
  .page-break{
    page-break-before:always;
    break-before:page;
  }
</style>
</head>
<body>
  <div class="page">
    <div class="cover">
      <div class="brand-row">
        <div class="brand-left">
          <div class="logo-box">AI</div>
          <div>
            <div class="eyebrow"><span class="dot"></span> Adray Signal Export</div>
          </div>
        </div>
        <div class="muted">${escapeHtml(model.generatedDateLong)}</div>
      </div>

      <div class="cover-grid">
        <div>
          <div class="eyebrow" style="margin-top:6px;">Signal Ready</div>
          <h1 class="headline">
            ${escapeHtml(model.workspaceName)}<br />
            <span class="grad">Signal PDF</span>
          </h1>
          <p class="sub">
            This export captures the final Signal generated by Adray from the user’s connected sources.
            It is ready to be used as structured context inside AI tools for strategy, diagnostics,
            prioritization, and decision support.
          </p>

          ${model.kpiChips.length > 0 ? `
            <div class="chip-row">
              ${model.kpiChips.map((x) => `<span class="soft-chip">${escapeHtml(x)}</span>`).join('')}
            </div>
          ` : ''}

          ${snapshotMeta.length > 0 ? `
            <div class="chip-row">
              ${snapshotMeta.map((x) => `<span class="soft-chip">${escapeHtml(x)}</span>`).join('')}
            </div>
          ` : ''}
        </div>

        <div class="cover-art">
          ${coverImageDataUri
            ? `<img src="${coverImageDataUri}" alt="Adray Signal cover" />`
            : `<div class="fallback"></div>`}
        </div>
      </div>

      <div class="stats-grid">
        <div class="stat">
          <div class="stat-label">Workspace</div>
          <div class="stat-value">${escapeHtml(model.workspaceName)}</div>
          <div class="stat-note">Signal owner / account context</div>
        </div>

        <div class="stat">
          <div class="stat-label">Connected Sources</div>
          <div class="stat-value">${escapeHtml(String(model.sourceCount))}</div>
          <div class="stat-note">${escapeHtml(model.connectedSources.join(' · ') || 'No sources listed')}</div>
        </div>

        <div class="stat">
          <div class="stat-label">Historical Window</div>
          <div class="stat-value">${escapeHtml(historyLabel)}</div>
          <div class="stat-note">Reasoning and storage coverage</div>
        </div>

        <div class="stat">
          <div class="stat-label">Generated</div>
          <div class="stat-value">${escapeHtml(model.generatedAtLong)}</div>
          <div class="stat-note">Final Signal + PDF output timestamp</div>
        </div>
      </div>
    </div>

    <section class="section">
      <div class="section-inner">
        <div class="section-kicker">Executive Overview</div>
        <h2 class="section-title">What this Signal says right now</h2>
        <div class="section-body">
          ${section.executiveSummary ? `<p>${escapeHtml(section.executiveSummary)}</p>` : ''}
          ${section.businessState ? `<p>${escapeHtml(section.businessState)}</p>` : ''}
          ${section.crossChannelStory ? `<p>${escapeHtml(section.crossChannelStory)}</p>` : ''}
        </div>

        <div class="grid-3" style="margin-top:16px;">
          <div class="card">
            <div class="card-title">Positives</div>
            <ul class="mini-list">
              ${renderListItems(section.positives, { max: 6, emptyLabel: 'No positives captured.' })}
            </ul>
          </div>
          <div class="card">
            <div class="card-title">Risks</div>
            <ul class="mini-list">
              ${renderListItems(section.risks, { max: 6, emptyLabel: 'No risks captured.' })}
            </ul>
          </div>
          <div class="card">
            <div class="card-title">Priority Actions</div>
            <ul class="mini-list">
              ${renderListItems(section.actions, { max: 6, emptyLabel: 'No actions captured.' })}
            </ul>
          </div>
        </div>
      </div>
    </section>

    <section class="section">
      <div class="section-inner">
        <div class="section-kicker">Strategy Layer</div>
        <h2 class="section-title">Where growth and friction are happening</h2>

        <div class="grid-2" style="margin-top:16px;">
          <div class="card">
            <div class="card-title">Performance Drivers</div>
            <ul class="list">
              ${renderListItems(section.performanceDrivers, { max: 8, emptyLabel: 'No performance drivers captured yet.' })}
            </ul>
          </div>
          <div class="card">
            <div class="card-title">Conversion Bottlenecks</div>
            <ul class="list">
              ${renderListItems(section.bottlenecks, { max: 8, emptyLabel: 'No bottlenecks captured yet.' })}
            </ul>
          </div>
          <div class="card">
            <div class="card-title">Scaling Opportunities</div>
            <ul class="list">
              ${renderListItems(section.scaling, { max: 8, emptyLabel: 'No scaling opportunities captured yet.' })}
            </ul>
          </div>
          <div class="card">
            <div class="card-title">Suggested Prompts</div>
            <ul class="list">
              ${renderListItems(model.promptHints, { max: 8, emptyLabel: 'No prompts captured.' })}
            </ul>
          </div>
        </div>
      </div>
    </section>

    <div class="page-break"></div>

    <section class="section">
      <div class="section-inner">
        <div class="section-kicker">Channel Story</div>
        <h2 class="section-title">Per-source Signal summary</h2>

        <div class="grid-2" style="margin-top:16px;">
          ${renderChannelBlock('Meta Ads', channelStory?.meta_ads, 'Meta Ads data was not available in this Signal.')}
          ${renderChannelBlock('Google Ads', channelStory?.google_ads, 'Google Ads data was not available in this Signal.')}
          ${renderChannelBlock('GA4', channelStory?.ga4, 'GA4 data was not available in this Signal.')}
          <div class="channel-card">
            <div class="channel-header">
              <h3>Signal Mini Context</h3>
            </div>
            <div class="quote">${escapeHtml(section.llmContextBlockMini || 'Mini Signal context not available.')}</div>
          </div>
        </div>
      </div>
    </section>

    <section class="section">
      <div class="section-inner">
        <div class="section-kicker">Full Signal Block</div>
        <h2 class="section-title">AI-ready source of truth</h2>
        <div class="card" style="margin-top:16px;">
          <div class="quote">${escapeHtml(section.llmContextBlock || 'Full Signal block not available.')}</div>
        </div>

        <div class="footer-note">
          This PDF was generated automatically by Adray after the Signal finished building.
          Use it as a portable reference inside AI workflows, strategy sessions, analysis threads,
          and execution planning.
        </div>
      </div>
    </section>
  </div>
</body>
</html>`;
}

function findChromeUnderDir(rootDir) {
  if (!rootDir || !fileExistsSync(rootDir)) return null;

  try {
    const firstLevel = fs.readdirSync(rootDir, { withFileTypes: true });

    for (const entry of firstLevel) {
      if (!entry.isDirectory()) continue;

      const candidate = path.join(rootDir, entry.name, 'chrome-linux64', 'chrome');
      if (isExecutableFileSync(candidate)) {
        return candidate;
      }
    }
  } catch (_) {
    return null;
  }

  return null;
}

function resolvePuppeteerExecutablePath() {
  const envCandidates = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    process.env.CHROME_PATH,
    process.env.GOOGLE_CHROME_BIN,
  ]
    .map((x) => safeStr(x).trim())
    .filter(Boolean);

  for (const candidate of envCandidates) {
    if (isExecutableFileSync(candidate)) {
      return path.resolve(candidate);
    }
  }

  const discoveredDirs = [
    '/opt/render/.cache/puppeteer/chrome',
    '/opt/render/project/.cache/puppeteer/chrome',
    path.resolve(process.cwd(), '.cache', 'puppeteer', 'chrome'),
    path.resolve(process.cwd(), 'node_modules', '.cache', 'puppeteer', 'chrome'),
  ];

  for (const rootDir of discoveredDirs) {
    const found = findChromeUnderDir(rootDir);
    if (found) return found;
  }

  const fixedCandidates = [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
  ];

  for (const candidate of fixedCandidates) {
    if (isExecutableFileSync(candidate)) {
      return candidate;
    }
  }

  if (puppeteer && typeof puppeteer.executablePath === 'function') {
    try {
      const p = puppeteer.executablePath();
      if (isExecutableFileSync(p)) return p;
    } catch (_) {
      // noop
    }
  }

  return null;
}

function buildPuppeteerLaunchOptions() {
  const executablePath = resolvePuppeteerExecutablePath();

  if (!executablePath) {
    const err = new Error(
      'SIGNAL_PDF_PUPPETEER_CHROME_NOT_FOUND: Chrome/Chromium is not installed or not discoverable. Set PUPPETEER_EXECUTABLE_PATH and PUPPETEER_CACHE_DIR, or install Chrome with "npx puppeteer browsers install chrome".'
    );
    err.code = 'SIGNAL_PDF_PUPPETEER_CHROME_NOT_FOUND';
    throw err;
  }

  console.log('[signalPdfBuilder] Using Chrome executable:', executablePath);

  return {
    headless: PUPPETEER_HEADLESS_MODE ? true : false,
    executablePath,
    timeout: PUPPETEER_LAUNCH_TIMEOUT_MS,
    protocolTimeout: PUPPETEER_RENDER_TIMEOUT_MS,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-software-rasterizer',
      '--disable-background-networking',
      '--disable-background-timer-throttling',
      '--disable-breakpad',
      '--disable-component-update',
      '--disable-default-apps',
      '--disable-extensions',
      '--disable-features=Translate,BackForwardCache,AcceptCHFrame,MediaRouter,OptimizationHints',
      '--disable-hang-monitor',
      '--disable-ipc-flooding-protection',
      '--disable-popup-blocking',
      '--disable-prompt-on-repost',
      '--disable-renderer-backgrounding',
      '--disable-sync',
      '--force-color-profile=srgb',
      '--metrics-recording-only',
      '--mute-audio',
      '--no-first-run',
      '--no-zygote',
      '--password-store=basic',
      '--use-mock-keychain',
    ],
    defaultViewport: {
      width: 1440,
      height: 2200,
      deviceScaleFactor: 1.5,
    },
  };
}

async function renderWithPuppeteer(html, outputPath) {
  if (!puppeteer) {
    const err = new Error('SIGNAL_PDF_PUPPETEER_NOT_INSTALLED');
    err.code = 'SIGNAL_PDF_PUPPETEER_NOT_INSTALLED';
    throw err;
  }

  const launchOptions = buildPuppeteerLaunchOptions();
  const browser = await puppeteer.launch(launchOptions);

  try {
    const page = await browser.newPage();

    page.setDefaultNavigationTimeout(PUPPETEER_RENDER_TIMEOUT_MS);
    page.setDefaultTimeout(PUPPETEER_RENDER_TIMEOUT_MS);

    await page.setContent(html, {
      waitUntil: ['domcontentloaded', 'load', 'networkidle0'],
      timeout: PUPPETEER_RENDER_TIMEOUT_MS,
    });

    await page.emulateMediaType('screen');

    await page.pdf({
      path: outputPath,
      format: 'A4',
      printBackground: true,
      margin: {
        top: '16mm',
        right: '12mm',
        bottom: '16mm',
        left: '12mm',
      },
      preferCSSPageSize: false,
      timeout: PUPPETEER_RENDER_TIMEOUT_MS,
    });
  } finally {
    await browser.close().catch(() => {});
  }
}

function renderTextBlock(doc, text, opts = {}) {
  const clean = safeStr(text).trim();
  if (!clean) return;

  const width = opts.width || 500;
  const fontSize = opts.fontSize || 11;
  const color = opts.color || '#DDE3F2';
  const lineGap = opts.lineGap == null ? 3 : opts.lineGap;
  const paragraphGap = opts.paragraphGap == null ? 8 : opts.paragraphGap;

  doc
    .fontSize(fontSize)
    .fillColor(color)
    .text(clean, { width, lineGap, paragraphGap });
}

function addSectionTitle(doc, title, subtitle = '') {
  doc.moveDown(0.5);
  doc
    .font('Helvetica-Bold')
    .fontSize(18)
    .fillColor('#FFFFFF')
    .text(title, { lineGap: 2 });

  if (subtitle) {
    doc.moveDown(0.25);
    doc
      .font('Helvetica')
      .fontSize(10)
      .fillColor('#9AA3B7')
      .text(subtitle, { lineGap: 2 });
  }

  doc.moveDown(0.75);
}

function renderSimpleList(doc, items, opts = {}) {
  const list = compactArray(items, opts.max || 8);
  if (list.length === 0) {
    renderTextBlock(doc, opts.emptyLabel || 'No items available.', {
      width: opts.width || 500,
      fontSize: 10.5,
      color: '#9AA3B7',
    });
    return;
  }

  for (const item of list) {
    doc
      .font('Helvetica-Bold')
      .fontSize(11)
      .fillColor('#4FE3C1')
      .text('• ', { continued: true });

    doc
      .font('Helvetica')
      .fontSize(11)
      .fillColor('#E8ECF8')
      .text(safeStr(item), {
        width: opts.width || 500,
        lineGap: 2,
      });

    doc.moveDown(0.35);
  }
}

async function renderWithPdfKit(model, outputPath) {
  if (!PDFDocument) {
    const err = new Error('SIGNAL_PDF_PDFKIT_NOT_INSTALLED');
    err.code = 'SIGNAL_PDF_PDFKIT_NOT_INSTALLED';
    throw err;
  }

  await new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 44,
      bufferPages: true,
      autoFirstPage: true,
      info: {
        Title: `${model.workspaceName} Signal PDF`,
        Author: 'Adray AI',
        Subject: 'Signal Export',
        Keywords: 'adray, signal, pdf, ai',
        Creator: 'Adray AI',
        Producer: 'Adray AI',
      },
    });

    const stream = fs.createWriteStream(outputPath);
    doc.pipe(stream);

    try {
      doc.rect(0, 0, doc.page.width, doc.page.height).fill('#0B0B10');
      doc.fillColor('#FFFFFF');

      doc
        .roundedRect(28, 28, doc.page.width - 56, 245, 18)
        .fillOpacity(1)
        .fill('#11131A');

      doc
        .font('Helvetica-Bold')
        .fontSize(10)
        .fillColor('#D9C7FF')
        .text('ADRAY SIGNAL EXPORT', 50, 52);

      doc
        .font('Helvetica-Bold')
        .fontSize(28)
        .fillColor('#FFFFFF')
        .text(model.workspaceName, 50, 80, { width: 330 });

      doc
        .font('Helvetica-Bold')
        .fontSize(30)
        .fillColor('#B55CFF')
        .text('Signal PDF', 50, 118, { width: 330 });

      doc
        .font('Helvetica')
        .fontSize(11.5)
        .fillColor('#C5CCDD')
        .text(
          'This export contains the final Signal generated by Adray and is ready to be used as structured AI context.',
          50,
          166,
          { width: 360, lineGap: 3 }
        );

      doc
        .font('Helvetica')
        .fontSize(10)
        .fillColor('#9AA3B7')
        .text(`Generated: ${model.generatedAtLong}`, 50, 222);

      doc
        .font('Helvetica')
        .fontSize(10)
        .fillColor('#9AA3B7')
        .text(`Sources: ${model.connectedSources.join(' · ') || 'No sources listed'}`, 50, 238);

      const coverImage = resolveBrandCoverImage();
      if (coverImage && fileExistsSync(coverImage)) {
        try {
          doc.image(coverImage, doc.page.width - 210, 52, {
            fit: [150, 160],
            align: 'center',
            valign: 'center',
          });
        } catch (_) {}
      }

      doc.y = 300;
      addSectionTitle(doc, 'Executive Overview', 'What this Signal says right now');

      if (model.sections.executiveSummary) renderTextBlock(doc, model.sections.executiveSummary);
      if (model.sections.businessState) renderTextBlock(doc, model.sections.businessState);
      if (model.sections.crossChannelStory) renderTextBlock(doc, model.sections.crossChannelStory);

      addSectionTitle(doc, 'Positives');
      renderSimpleList(doc, model.sections.positives, { emptyLabel: 'No positives captured.' });

      addSectionTitle(doc, 'Risks');
      renderSimpleList(doc, model.sections.risks, { emptyLabel: 'No risks captured.' });

      addSectionTitle(doc, 'Priority Actions');
      renderSimpleList(doc, model.sections.actions, { emptyLabel: 'No actions captured.' });

      doc.addPage();
      doc.rect(0, 0, doc.page.width, doc.page.height).fill('#0B0B10');

      addSectionTitle(doc, 'Performance Drivers');
      renderSimpleList(doc, model.sections.performanceDrivers, { emptyLabel: 'No performance drivers captured.' });

      addSectionTitle(doc, 'Conversion Bottlenecks');
      renderSimpleList(doc, model.sections.bottlenecks, { emptyLabel: 'No bottlenecks captured.' });

      addSectionTitle(doc, 'Scaling Opportunities');
      renderSimpleList(doc, model.sections.scaling, { emptyLabel: 'No scaling opportunities captured.' });

      addSectionTitle(doc, 'Suggested Prompts');
      renderSimpleList(doc, model.promptHints, { emptyLabel: 'No prompts captured.' });

      doc.addPage();
      doc.rect(0, 0, doc.page.width, doc.page.height).fill('#0B0B10');

      addSectionTitle(doc, 'Signal Mini Context');
      renderTextBlock(doc, model.sections.llmContextBlockMini || 'Mini Signal context not available.', {
        fontSize: 10.5,
      });

      addSectionTitle(doc, 'Full Signal Block');
      renderTextBlock(doc, model.sections.llmContextBlock || 'Full Signal block not available.', {
        fontSize: 10.25,
      });

      const rangeLabel =
        model.storageRangeDays && model.contextRangeDays
          ? `${model.contextRangeDays} active reasoning days · ${model.storageRangeDays} stored days`
          : model.contextRangeDays
            ? `${model.contextRangeDays} active reasoning days`
            : model.storageRangeDays
              ? `${model.storageRangeDays} stored days`
              : 'Historical signal ready';

      doc.moveDown(1);
      renderTextBlock(
        doc,
        `Generated by Adray. Historical coverage: ${rangeLabel}. Snapshot: ${model.snapshotId || 'n/a'}.`,
        { fontSize: 9.5, color: '#9AA3B7' }
      );

      doc.end();
    } catch (err) {
      reject(err);
      try {
        doc.end();
      } catch (_) {}
      return;
    }

    stream.on('finish', resolve);
    stream.on('error', reject);
  });
}

function inferPublicDownloadUrl() {
  return SIGNAL_PDF_PUBLIC_BASE;
}

async function getPageCountFast(outputPath) {
  try {
    const buf = await fs.promises.readFile(outputPath);
    const matches = buf.toString('latin1').match(/\/Type\s*\/Page\b/g);
    return Array.isArray(matches) ? matches.length : null;
  } catch (_) {
    return null;
  }
}

async function generateSignalPdfForUser({
  userId,
  root,
  signalPayload,
  user = null,
} = {}) {
  if (!userId) {
    const err = new Error('SIGNAL_PDF_MISSING_USER_ID');
    err.code = 'SIGNAL_PDF_MISSING_USER_ID';
    throw err;
  }

  if (!root || typeof root !== 'object') {
    const err = new Error('SIGNAL_PDF_MISSING_ROOT');
    err.code = 'SIGNAL_PDF_MISSING_ROOT';
    throw err;
  }

  const model = buildSignalPdfModel({ userId, root, signalPayload, user });

  ensureDirSync(SIGNAL_PDF_STORAGE_DIR);

  const snapshotSeed =
    safeStr(root?.aiContext?.snapshotId || root?.latestSnapshotId || '').trim() ||
    crypto.randomBytes(6).toString('hex');

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const workspaceSlug = slugify(model.workspaceName, 'workspace');
  const fileName = `${workspaceSlug}-signal-${snapshotSeed}-${stamp}.pdf`;
  const outputPath = path.join(SIGNAL_PDF_STORAGE_DIR, fileName);

  let renderer = null;

  try {
    const html = buildSignalPdfHtml(model);

    if (puppeteer) {
      await renderWithPuppeteer(html, outputPath);
      renderer = 'puppeteer';
    } else if (SIGNAL_PDF_ALLOW_PDFKIT_FALLBACK && PDFDocument) {
      await renderWithPdfKit(model, outputPath);
      renderer = 'pdfkit';
    } else {
      const err = new Error(
        'SIGNAL_PDF_NO_RENDERER_AVAILABLE: Puppeteer is required. Install Chrome with "npx puppeteer browsers install chrome" and ensure PUPPETEER_EXECUTABLE_PATH is resolvable if needed.'
      );
      err.code = 'SIGNAL_PDF_NO_RENDERER_AVAILABLE';
      throw err;
    }

    const stat = await fs.promises.stat(outputPath);
    const pageCount = await getPageCountFast(outputPath);

    return {
      ok: true,
      renderer,
      mimeType: 'application/pdf',
      fileName,
      storageKey: fileName,
      localPath: outputPath,
      downloadUrl: inferPublicDownloadUrl(),
      generatedAt: nowIso(),
      sizeBytes: toNum(stat?.size, 0),
      pageCount: toNum(pageCount, 0) || null,
      model,
    };
  } catch (err) {
    try {
      if (fileExistsSync(outputPath)) {
        await fs.promises.unlink(outputPath).catch(() => {});
      }
    } catch (_) {}

    if (!err.code) {
      err.code = 'SIGNAL_PDF_BUILD_FAILED';
    }
    throw err;
  }
}

module.exports = {
  SIGNAL_PDF_STORAGE_DIR,
  buildSignalPdfModel,
  buildSignalPdfHtml,
  generateSignalPdfForUser,
};