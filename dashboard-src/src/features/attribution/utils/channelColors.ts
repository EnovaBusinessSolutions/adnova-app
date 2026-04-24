export const CHANNEL_COLORS: Record<string, string> = {
  meta:          '#1877F2',
  google:        '#4285F4',
  tiktok:        '#69C9D0',
  organic:       '#10B981',
  other:         '#6B7280',
  unattributed:  '#F59E0B',
};

export const CHANNEL_LABELS: Record<string, string> = {
  meta:          'Meta',
  google:        'Google',
  tiktok:        'TikTok',
  organic:       'Organic',
  other:         'Other',
  unattributed:  'Unattributed',
};

export function channelColor(channel: string | null | undefined): string {
  const key = (channel ?? '').toLowerCase();
  return CHANNEL_COLORS[key] ?? CHANNEL_COLORS.other;
}

export function channelLabel(channel: string | null | undefined): string {
  const key = (channel ?? '').toLowerCase();
  return CHANNEL_LABELS[key] ?? (channel ?? 'Unknown');
}

// ─── Platform sub-label (used to break down "Other") ──────────
// Takes a raw platform string — can be a domain (hostinger.com),
// a UTM source (bing), or a label (direct) — and returns a human
// friendly name. Returns null if input is missing.
export function friendlyPlatformLabel(platform: string | null | undefined): string | null {
  if (!platform) return null;
  const raw = String(platform).trim();
  if (!raw) return null;
  const lc = raw.toLowerCase();

  // Search engines
  if (lc.includes('bing'))        return 'Bing Search';
  if (lc.includes('yahoo'))       return 'Yahoo Search';
  if (lc.includes('duckduckgo'))  return 'DuckDuckGo';
  if (lc.includes('yandex'))      return 'Yandex';
  if (lc.includes('ecosia'))      return 'Ecosia';
  if (lc.includes('baidu'))       return 'Baidu';

  // Hosting / back-office referrers (common false-positive "other")
  if (lc.includes('hostinger'))   return 'Hostinger Referral';
  if (lc.includes('godaddy'))     return 'GoDaddy Referral';
  if (lc.includes('cpanel'))      return 'cPanel Referral';

  // Social (non-paid)
  if (lc.includes('pinterest'))   return 'Pinterest';
  if (lc.includes('linkedin'))    return 'LinkedIn';
  if (lc.includes('reddit'))      return 'Reddit';
  if (lc.includes('youtube'))     return 'YouTube';
  if (lc.includes('whatsapp'))    return 'WhatsApp';
  if (lc.includes('t.me') || lc.includes('telegram')) return 'Telegram';

  // Email / productivity
  if (lc.includes('mail.google') || lc.includes('gmail'))     return 'Gmail';
  if (lc.includes('outlook') || lc.includes('hotmail'))       return 'Outlook';

  // Direct
  if (lc === 'direct')            return 'Direct';

  // Domain → strip www. and TLD parts to a title-cased host
  try {
    const host = raw.replace(/^https?:\/\//, '').split('/')[0].replace(/^www\./, '');
    if (host && host.includes('.')) {
      // Title-case the second-to-last label (e.g. "mx.search.yahoo.com" already handled above)
      const parts = host.split('.');
      const brand = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
      return brand.charAt(0).toUpperCase() + brand.slice(1);
    }
  } catch {
    /* fall through */
  }

  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

// Full display name: "{Channel}" or "{Channel} · {Platform}" when
// the channel is generic and a platform adds useful detail.
export function channelDisplayLabel(
  channel: string | null | undefined,
  platform: string | null | undefined,
): string {
  const ch = (channel ?? '').toLowerCase();
  const base = channelLabel(channel);
  const generic = ch === 'other' || ch === 'unattributed' || ch === '';
  if (!generic) return base;
  const sub = friendlyPlatformLabel(platform);
  return sub ? `${base} · ${sub}` : base;
}
