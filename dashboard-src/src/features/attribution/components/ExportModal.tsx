import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Download, FileText } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { formatCurrency, formatNumber, formatPercent } from '../utils/formatters';
import type { AnalyticsResponse, AttributionModel, RangePreset } from '../types';

const schema = z
  .object({
    includeSummary: z.boolean(),
    includePurchases: z.boolean(),
    includeProducts: z.boolean(),
    includeChannels: z.boolean(),
  })
  .refine(
    (d) => d.includeSummary || d.includePurchases || d.includeProducts || d.includeChannels,
    { message: 'Select at least one section', path: ['includeSummary'] },
  );

type FormValues = z.infer<typeof schema>;

interface Props {
  open: boolean;
  onClose: () => void;
  data: AnalyticsResponse | undefined;
  shop: string;
  model: AttributionModel;
  range: RangePreset | 'custom';
  start?: string;
  end?: string;
}

function escapeCell(v: string | number | null | undefined): string {
  if (v == null) return '';
  const s = String(v);
  return s.includes(',') || s.includes('"') || s.includes('\n')
    ? `"${s.replace(/"/g, '""')}"`
    : s;
}

function rows(headers: string[], data: (string | number | null | undefined)[][]): string {
  return [headers, ...data].map((r) => r.map(escapeCell).join(',')).join('\n');
}

function buildCSV(values: FormValues, data: AnalyticsResponse, shop: string, model: string, range: string, start?: string, end?: string): string {
  const s = data.summary;
  const dateLabel = range === 'custom' ? `${start ?? ''} – ${end ?? ''}` : `Last ${range} days`;
  const sections: string[] = [
    `# Adray Attribution Export`,
    `# Shop: ${shop}`,
    `# Range: ${dateLabel}`,
    `# Model: ${model.replace('_', ' ')}`,
    `# Generated: ${new Date().toISOString()}`,
    '',
  ];

  if (values.includeSummary) {
    const currency = data.paidMedia?.blended?.currency ?? undefined;
    sections.push(
      '## KPI SUMMARY',
      rows(
        ['Metric', 'Value'],
        [
          ['Total Revenue', formatCurrency(s.totalRevenue, currency)],
          ['Total Orders', s.totalOrders],
          ['Attributed Orders', s.attributedOrders],
          ['Unattributed Orders', s.unattributedOrders],
          ['Sessions', s.totalSessions],
          ['Conversion Rate', formatPercent(s.conversionRate)],
          ['Page Views', s.pageViews],
          ['View Item', s.viewItem],
          ['Add to Cart', s.addToCart],
          ['Begin Checkout', s.beginCheckout],
          ['Purchase Events', s.purchaseEvents],
        ],
      ),
      '',
    );
  }

  if (values.includeChannels) {
    sections.push(
      '## CHANNEL BREAKDOWN',
      rows(
        ['Channel', 'Revenue', 'Orders'],
        Object.entries(data.channels).map(([ch, stats]) => [ch, stats.revenue, stats.orders]),
      ),
      '',
    );
  }

  if (values.includePurchases && data.recentPurchases?.length) {
    sections.push(
      '## RECENT PURCHASES',
      rows(
        ['Order ID', 'Order #', 'Revenue', 'Currency', 'Channel', 'Confidence', 'Date'],
        data.recentPurchases.map((p) => [
          p.orderId,
          p.orderNumber ?? '',
          p.revenue,
          p.currency ?? '',
          p.attributedChannel ?? 'unattributed',
          p.confidenceScore != null ? `${Math.round(p.confidenceScore * 100)}%` : '',
          p.createdAt,
        ]),
      ),
      '',
    );
  }

  if (values.includeProducts && data.topProducts?.length) {
    sections.push(
      '## TOP PRODUCTS',
      rows(
        ['Product', 'Revenue', 'Quantity'],
        data.topProducts.map((p) => [p.name, p.revenue, p.quantity]),
      ),
      '',
    );
  }

  return sections.join('\n');
}

function triggerDownload(csv: string, filename: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

interface CheckRowProps {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}

function CheckRow({ id, label, description, checked, onChange }: CheckRowProps) {
  return (
    <label
      htmlFor={id}
      className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/[0.04] bg-white/[0.02] px-3 py-2.5 transition-colors hover:border-white/[0.08] hover:bg-white/[0.04]"
    >
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(v) => onChange(!!v)}
        className="mt-0.5 border-white/20 data-[state=checked]:border-[var(--adray-purple)] data-[state=checked]:bg-[var(--adray-purple)]"
      />
      <div>
        <p className="text-xs font-medium text-white/75">{label}</p>
        <p className="text-[10px] text-white/35">{description}</p>
      </div>
    </label>
  );
}

export function ExportModal({ open, onClose, data, shop, model, range, start, end }: Props) {
  const { watch, setValue, handleSubmit, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      includeSummary: true,
      includePurchases: true,
      includeProducts: true,
      includeChannels: true,
    },
  });

  const values = watch();

  const onSubmit = (v: FormValues) => {
    if (!data) return;
    const csv = buildCSV(v, data, shop, model, String(range), start, end);
    const date = new Date().toISOString().slice(0, 10);
    triggerDownload(csv, `adray-attribution-${shop.split('.')[0]}-${date}.csv`);
    onClose();
  };

  const sections: { key: keyof FormValues; label: string; description: string }[] = [
    { key: 'includeSummary', label: 'KPI Summary', description: 'Total revenue, orders, sessions, conversion rate…' },
    { key: 'includeChannels', label: 'Channel Breakdown', description: `${Object.keys(data?.channels ?? {}).length} channels — revenue and orders per channel` },
    { key: 'includePurchases', label: 'Recent Purchases', description: `${formatNumber(data?.recentPurchases?.length ?? 0)} orders with channel attribution` },
    { key: 'includeProducts', label: 'Top Products', description: `${formatNumber(data?.topProducts?.length ?? 0)} products with revenue and quantity` },
  ];

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="border-white/[0.08] bg-[#0a0a0f] sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <FileText size={14} className="text-[var(--adray-purple)]" />
            <DialogTitle className="text-sm font-semibold text-white/80">Export Data</DialogTitle>
          </div>
          {!data && (
            <p className="mt-1 text-[11px] text-yellow-400/70">Load analytics data first before exporting.</p>
          )}
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-2">
          {sections.map(({ key, label, description }) => (
            <CheckRow
              key={key}
              id={key}
              label={label}
              description={description}
              checked={values[key]}
              onChange={(v) => setValue(key, v)}
            />
          ))}

          {errors.includeSummary?.message && (
            <p className="text-[10px] text-red-400">{errors.includeSummary.message}</p>
          )}

          <DialogFooter className="mt-4 flex gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="border border-white/[0.08] text-white/50 hover:text-white"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={!data}
              className="gap-1.5 bg-[var(--adray-purple)] text-white hover:bg-[#9d4de8]"
            >
              <Download size={12} />
              Download CSV
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
