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
