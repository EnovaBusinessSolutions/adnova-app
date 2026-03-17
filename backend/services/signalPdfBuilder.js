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

function formatTimeShort(iso) {
  const d = iso ? new Date(iso) : new Date();
  if (Number.isNaN(d.getTime())) return '--:--';
  return new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
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
    out.push('Meta');
  }
  if (root?.sources?.googleAds?.connected || root?.sources?.googleAds?.ready) {
    out.push('Google');
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
    'Which campaigns have the strongest ROAS and what is limiting the weaker ones?',
    'Based on the last 60 days, where should we shift budget to improve efficiency?',
    'Write a concise performance summary I can share with my team this week.',
    ...(summary?.priority_actions || []).slice(0, 3).map((x) => `Turn this into an action plan: ${x}`),
  ], 6);
}

function resolveSignalSections(signalPayload) {
  const summary = signalPayload?.summary || {};
  const prompts = buildPromptHints(signalPayload);

  return {
    executiveSummary: safeStr(summary?.executive_summary).trim(),
    businessState: safeStr(summary?.business_state).trim(),
    crossChannelStory: safeStr(summary?.cross_channel_story).trim(),
    prompts,
    llmContextBlock: safeStr(signalPayload?.llm_context_block).trim(),
    llmContextBlockMini: safeStr(signalPayload?.llm_context_block_mini).trim(),
    channelStory: signalPayload?.channel_story || {},
  };
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

  const signalText =
    safeStr(signalPayload?.llm_context_block).trim() ||
    safeStr(signalPayload?.llm_context_block_mini).trim() ||
    safeStr(signalPayload?.encoded_context).trim() ||
    safeStr(signalPayload?.signal).trim() ||
    '';

  const promptHints = compactArray(sections.prompts, 3);

  const rollingWindowLabel =
    lineage.contextRangeDays
      ? `${lineage.contextRangeDays}d`
      : lineage.storageRangeDays
        ? `${lineage.storageRangeDays}d`
        : 'n/a';

  const generatedClock = formatTimeShort(lineage.generatedAt);

  return {
    userId: safeStr(userId),
    workspaceName,
    connectedSources,
    sourceCount: connectedSources.length,
    generatedAt: lineage.generatedAt,
    generatedAtLong: formatDateTimeLong(lineage.generatedAt),
    generatedDateLong: formatDateLong(lineage.generatedAt),
    generatedClock,
    contextRangeDays: lineage.contextRangeDays,
    storageRangeDays: lineage.storageRangeDays,
    snapshotId: lineage.snapshotId,
    sourceSnapshots: lineage.sourceSnapshots || {},
    sections,
    promptHints,
    rollingWindowLabel,
    signalText,
  };
}

function buildSignalPdfHtml(model) {
  const coverImagePath = resolveBrandCoverImage();
  const coverImageDataUri = readMaybeBase64Image(coverImagePath);

  const historyLabel =
    model.contextRangeDays
      ? `${model.contextRangeDays}d`
      : model.storageRangeDays
        ? `${model.storageRangeDays}d`
        : 'n/a';

  const sourcesLabel = model.connectedSources.length > 0
    ? model.connectedSources.join(' · ')
    : 'No sources';

  const prompts = compactArray(model.promptHints, 3);
  const signalText = model.signalText || 'Signal not available.';
  const snapshotLabel = safeStr(model.snapshotId || 'n/a');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${escapeHtml(model.workspaceName)} Signal PDF</title>
<style>
  :root{
    --bg:#06070b;
    --panel:#0a0c12;
    --panel-2:#0f1220;
    --panel-3:#0b0d16;
    --line:#2b2f4a;
    --line-soft:rgba(141,126,255,.18);
    --text:#eef2ff;
    --muted:#9aa3c7;
    --muted-2:#717aa8;
    --purple:#a96cff;
    --purple-2:#d7a4ff;
    --mint:#64f0cb;
    --mint-2:#8af8de;
    --blue:#8cb7ff;
    --grid:rgba(120,130,255,.14);
  }

  *{ box-sizing:border-box; }

  html,body{
    margin:0;
    padding:0;
    background:var(--bg);
    color:var(--text);
    -webkit-print-color-adjust:exact;
    print-color-adjust:exact;
    font-family:Inter,Arial,Helvetica,sans-serif;
  }

  body{
    background:
      radial-gradient(circle at top left, rgba(169,108,255,.10), transparent 28%),
      radial-gradient(circle at top right, rgba(100,240,203,.08), transparent 22%),
      linear-gradient(180deg, #05060a 0%, #070810 100%);
  }

  .cover-page{
    min-height:100vh;
    padding:22mm 18mm 16mm;
    position:relative;
    overflow:hidden;
    background:
      radial-gradient(circle at 15% 12%, rgba(169,108,255,.10), transparent 18%),
      radial-gradient(circle at 84% 9%, rgba(100,240,203,.08), transparent 16%),
      linear-gradient(180deg, #05060a 0%, #070810 100%);
  }

  .cover-page::before{
    content:"";
    position:absolute;
    inset:0;
    background-image:
      radial-gradient(var(--grid) 0.85px, transparent 0.85px);
    background-size:16px 16px;
    opacity:.65;
    pointer-events:none;
  }

  .cover-shell{
    position:relative;
    z-index:1;
    border:1px solid rgba(123,110,255,.35);
    background:linear-gradient(180deg, rgba(10,12,18,.88), rgba(7,9,15,.96));
    box-shadow:
      0 0 0 1px rgba(120,120,255,.06) inset,
      0 0 60px rgba(97,76,255,.10);
    padding:14mm 12mm 10mm;
    min-height:250mm;
  }

  .cover-top{
    display:flex;
    justify-content:space-between;
    align-items:flex-start;
    gap:18px;
  }

  .logo-col{
    display:flex;
    flex-direction:column;
    gap:6px;
  }

  .brand-main{
    font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
    font-size:26px;
    letter-spacing:.10em;
    text-transform:uppercase;
    color:#d7dfff;
    font-weight:700;
  }

  .brand-sub{
    font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
    font-size:9px;
    letter-spacing:.25em;
    color:var(--muted);
    text-transform:uppercase;
  }

  .status-chip{
    display:inline-flex;
    align-items:center;
    gap:8px;
    padding:7px 12px;
    border:1px solid rgba(100,240,203,.25);
    color:var(--mint-2);
    font-size:10px;
    letter-spacing:.18em;
    text-transform:uppercase;
    font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
    background:rgba(100,240,203,.05);
  }

  .status-dot{
    width:7px;
    height:7px;
    border-radius:50%;
    background:var(--mint);
    box-shadow:0 0 12px rgba(100,240,203,.55);
  }

  .cover-title{
    margin:18mm 0 10mm;
  }

  .cover-kicker{
    font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
    font-size:10px;
    color:#8f98c5;
    text-transform:uppercase;
    letter-spacing:.20em;
    margin-bottom:10px;
  }

  .workspace{
    border:1px solid rgba(123,110,255,.28);
    padding:10px 12px;
    margin-bottom:12px;
    background:rgba(12,14,24,.55);
  }

  .workspace-label{
    font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
    font-size:9px;
    color:#7380b8;
    text-transform:uppercase;
    letter-spacing:.16em;
    margin-bottom:7px;
  }

  .workspace-value{
    font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
    font-size:21px;
    color:#f1f4ff;
    font-weight:700;
    letter-spacing:.02em;
  }

  .cover-stats{
    display:grid;
    grid-template-columns:repeat(4,minmax(0,1fr));
    gap:10px;
    margin:12px 0 18px;
  }

  .stat{
    border:1px solid rgba(123,110,255,.20);
    background:rgba(11,13,22,.7);
    padding:10px 11px 9px;
    min-height:72px;
  }

  .stat-label{
    font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
    font-size:9px;
    color:#6f7ab0;
    text-transform:uppercase;
    letter-spacing:.16em;
    margin-bottom:8px;
  }

  .stat-value{
    font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
    font-size:16px;
    font-weight:700;
    color:#f3f6ff;
    line-height:1.15;
    word-break:break-word;
  }

  .stat-note{
    margin-top:5px;
    font-size:9px;
    color:#7d88ba;
    text-transform:uppercase;
    letter-spacing:.10em;
    font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  }

  .section-label{
    margin:18px 0 10px;
    font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
    font-size:10px;
    color:#8a95ca;
    text-transform:uppercase;
    letter-spacing:.18em;
  }

  .prompt-list{
    display:flex;
    flex-direction:column;
    gap:10px;
  }

  .prompt-card{
    border:1px solid rgba(123,110,255,.24);
    background:rgba(10,12,20,.72);
    padding:10px 12px;
  }

  .prompt-head{
    font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
    font-size:9px;
    text-transform:uppercase;
    letter-spacing:.15em;
    color:#7985bb;
    margin-bottom:8px;
  }

  .prompt-body{
    font-size:15px;
    line-height:1.45;
    color:#edf2ff;
  }

  .prompt-foot{
    margin-top:8px;
    font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
    font-size:8px;
    color:#6773a8;
    letter-spacing:.14em;
    text-transform:uppercase;
  }

  .how-to{
    display:grid;
    grid-template-columns:1fr;
    gap:7px;
    margin-top:6px;
  }

  .how-step{
    display:flex;
    gap:10px;
    align-items:flex-start;
    color:#dfe5ff;
    font-size:12px;
    line-height:1.45;
  }

  .how-step .num{
    width:22px;
    flex:0 0 22px;
    font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
    color:#7a87bd;
  }

  .cover-footer{
    margin-top:20px;
    padding-top:12px;
    border-top:1px solid rgba(123,110,255,.22);
    display:flex;
    justify-content:space-between;
    gap:12px;
    font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
    font-size:8px;
    color:#6975aa;
    text-transform:uppercase;
    letter-spacing:.14em;
  }

  .page-break{
    page-break-before:always;
    break-before:page;
  }

  .signal-page{
    min-height:100vh;
    padding:18mm 16mm 18mm;
    background:
      radial-gradient(circle at top left, rgba(169,108,255,.05), transparent 22%),
      linear-gradient(180deg, #06070b 0%, #090b12 100%);
  }

  .signal-shell{
    border:1px solid rgba(123,110,255,.18);
    background:rgba(8,10,17,.94);
    padding:14mm 12mm 12mm;
  }

  .signal-head{
    margin-bottom:16px;
  }

  .signal-kicker{
    font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
    font-size:10px;
    color:#8692ca;
    text-transform:uppercase;
    letter-spacing:.18em;
    margin-bottom:8px;
  }

  .signal-title{
    font-size:28px;
    line-height:1.05;
    font-weight:800;
    color:#f3f5ff;
    margin:0;
    letter-spacing:-.03em;
  }

  .signal-sub{
    margin-top:8px;
    color:#8f99c8;
    font-size:12px;
    line-height:1.6;
  }

  .signal-box{
    border:1px solid rgba(123,110,255,.18);
    background:
      linear-gradient(180deg, rgba(11,13,22,.95), rgba(8,10,16,.95));
    padding:14px;
  }

  .signal-pre{
    margin:0;
    white-space:pre-wrap;
    word-break:break-word;
    overflow-wrap:anywhere;
    font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
    font-size:10.5px;
    line-height:1.65;
    color:#e8ecff;
  }

  .signal-meta{
    display:flex;
    flex-wrap:wrap;
    gap:8px;
    margin:0 0 14px;
  }

  .meta-chip{
    display:inline-flex;
    align-items:center;
    padding:6px 10px;
    border:1px solid rgba(123,110,255,.18);
    background:rgba(255,255,255,.02);
    color:#91a0d6;
    font-size:9px;
    letter-spacing:.12em;
    text-transform:uppercase;
    font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  }

  img.cover-art-img{
    display:block;
    width:110px;
    max-width:110px;
    opacity:.98;
    border:1px solid rgba(123,110,255,.20);
    background:rgba(255,255,255,.02);
  }

  .cover-art-wrap{
    display:flex;
    align-items:flex-start;
    justify-content:flex-end;
  }

  @page{
    size:A4;
    margin:0;
  }
</style>
</head>
<body>
  <section class="cover-page">
    <div class="cover-shell">
      <div class="cover-top">
        <div class="logo-col">
          <div class="brand-main">ADRAY</div>
          <div class="brand-sub">Daily Signal Report</div>
        </div>

        <div class="status-chip">
          <span class="status-dot"></span>
          Signal Ready
        </div>
      </div>

      <div class="cover-title">
        <div class="cover-kicker">Workspace</div>
        <div class="workspace">
          <div class="workspace-label">Active workspace</div>
          <div class="workspace-value">${escapeHtml(model.workspaceName)}</div>
        </div>
      </div>

      <div class="cover-stats">
        <div class="stat">
          <div class="stat-label">Sources</div>
          <div class="stat-value">${escapeHtml(String(model.sourceCount))}</div>
          <div class="stat-note">${escapeHtml(sourcesLabel)}</div>
        </div>

        <div class="stat">
          <div class="stat-label">History</div>
          <div class="stat-value">${escapeHtml(historyLabel)}</div>
          <div class="stat-note">Rolling window</div>
        </div>

        <div class="stat">
          <div class="stat-label">Reconciled</div>
          <div class="stat-value">✓</div>
          <div class="stat-note">Signal verified</div>
        </div>

        <div class="stat">
          <div class="stat-label">Generated</div>
          <div class="stat-value">${escapeHtml(model.generatedClock)}</div>
          <div class="stat-note">Auto export</div>
        </div>
      </div>

      <div class="section-label">// Here are 3 recommended prompts for your data</div>

      <div class="prompt-list">
        ${prompts.map((prompt, idx) => `
          <div class="prompt-card">
            <div class="prompt-head">${idx === 0 ? 'Optimization' : idx === 1 ? 'Budget' : 'Report'}</div>
            <div class="prompt-body">"${escapeHtml(prompt)}"</div>
            <div class="prompt-foot">attach this pdf · paste · send</div>
          </div>
        `).join('')}
      </div>

      <div class="section-label" style="margin-top:18px;">// How to use</div>

      <div class="how-to">
        <div class="how-step"><span class="num">01</span><span>Open Claude, ChatGPT, Gemini, Grok or DeepSeek.</span></div>
        <div class="how-step"><span class="num">02</span><span>Attach this PDF to your conversation.</span></div>
        <div class="how-step"><span class="num">03</span><span>Copy a prompt above and send it.</span></div>
        <div class="how-step"><span class="num">04</span><span>Ask follow-up questions in plain language.</span></div>
      </div>

      <div class="cover-footer">
        <div>Adray · adray.ai · signal export</div>
        <div>Snapshot · ${escapeHtml(snapshotLabel)}</div>
      </div>
    </div>
  </section>

  <div class="page-break"></div>

  <section class="signal-page">
    <div class="signal-shell">
      <div class="signal-head">
        <div class="signal-kicker">Full Signal</div>
        <h1 class="signal-title">Plain text source for LLMs</h1>
        <div class="signal-sub">
          This section contains the raw Signal in plain text so AI models can read it more easily.
        </div>
      </div>

      <div class="signal-meta">
        <span class="meta-chip">Workspace · ${escapeHtml(model.workspaceName)}</span>
        <span class="meta-chip">Sources · ${escapeHtml(sourcesLabel)}</span>
        <span class="meta-chip">Generated · ${escapeHtml(model.generatedAtLong)}</span>
      </div>

      <div class="signal-box">
        <pre class="signal-pre">${escapeHtml(signalText)}</pre>
      </div>
    </div>
  </section>
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
        top: '0mm',
        right: '0mm',
        bottom: '0mm',
        left: '0mm',
      },
      preferCSSPageSize: true,
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
        .font('Helvetica-Bold')
        .fontSize(20)
        .text('ADRAY SIGNAL EXPORT', 50, 60);

      doc
        .font('Helvetica')
        .fontSize(12)
        .fillColor('#C5CCDD')
        .text(`Workspace: ${model.workspaceName}`, 50, 100);

      doc
        .font('Helvetica')
        .fontSize(10)
        .fillColor('#9AA3B7')
        .text(`Generated: ${model.generatedAtLong}`, 50, 122);

      doc
        .font('Helvetica')
        .fontSize(10)
        .fillColor('#9AA3B7')
        .text(`Sources: ${model.connectedSources.join(' · ') || 'No sources listed'}`, 50, 138);

      doc
        .font('Helvetica-Bold')
        .fontSize(14)
        .fillColor('#FFFFFF')
        .text('FULL SIGNAL', 50, 190);

      doc
        .font('Courier')
        .fontSize(9)
        .fillColor('#E8ECF8')
        .text(model.signalText || 'Signal not available.', 50, 220, {
          width: 500,
          lineGap: 3,
        });

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