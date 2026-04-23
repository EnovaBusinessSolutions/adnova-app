import {
  ShoppingCart,
  DollarSign,
  TrendingUp,
  Users,
  Eye,
  Package,
  CreditCard,
  CheckCircle,
  AlertCircle,
  Activity,
  BarChart2,
  Zap,
  Percent,
} from 'lucide-react';
import { KpiCard } from './KpiCard';
import { formatCurrency, formatNumber, formatPercent } from '../utils/formatters';
import type { AnalyticsResponse } from '../types';

type KpiAccent = 'default' | 'meta' | 'google' | 'tiktok' | 'warn';

interface KpiDef {
  label: string;
  value: string;
  sub?: string;
  icon: React.ReactNode;
  accent?: KpiAccent;
}

interface KpiGridProps {
  data?: AnalyticsResponse;
  loading: boolean;
}

export function KpiGrid({ data, loading }: KpiGridProps) {
  const s = data?.summary;
  const pm = data?.paidMedia;
  const currency = pm?.blended?.currency ?? null;

  const attributedPct =
    s && s.totalOrders > 0
      ? `${Math.round((s.attributedOrders / s.totalOrders) * 100)}% of orders`
      : undefined;

  const metaRoas =
    pm?.meta?.spend != null && pm.meta.spend > 0 && pm.meta.revenue != null
      ? `ROAS ${(pm.meta.revenue / pm.meta.spend).toFixed(2)}x`
      : undefined;

  const googleRoas =
    pm?.google?.spend != null && pm.google.spend > 0 && pm.google.revenue != null
      ? `ROAS ${(pm.google.revenue / pm.google.spend).toFixed(2)}x`
      : undefined;

  const kpis: KpiDef[] = [
    {
      label: 'Total Revenue',
      value: formatCurrency(s?.totalRevenue, currency),
      icon: <DollarSign size={13} />,
    },
    {
      label: 'Total Orders',
      value: formatNumber(s?.totalOrders),
      icon: <ShoppingCart size={13} />,
    },
    {
      label: 'Attributed Orders',
      value: formatNumber(s?.attributedOrders),
      sub: attributedPct,
      icon: <CheckCircle size={13} />,
    },
    {
      label: 'Sessions',
      value: formatNumber(s?.totalSessions),
      icon: <Users size={13} />,
    },
    {
      label: 'Conversion Rate',
      value: formatPercent(s?.conversionRate),
      icon: <Percent size={13} />,
    },
    {
      label: 'Page Views',
      value: formatNumber(s?.pageViews),
      icon: <Eye size={13} />,
    },
    {
      label: 'View Item',
      value: formatNumber(s?.viewItem),
      icon: <Package size={13} />,
    },
    {
      label: 'Add to Cart',
      value: formatNumber(s?.addToCart),
      icon: <ShoppingCart size={13} />,
    },
    {
      label: 'Begin Checkout',
      value: formatNumber(s?.beginCheckout),
      icon: <CreditCard size={13} />,
    },
    {
      label: 'Purchase Events',
      value: formatNumber(s?.purchaseEvents),
      icon: <Activity size={13} />,
    },
    {
      label: 'Unattributed Orders',
      value: formatNumber(s?.unattributedOrders),
      accent: s?.unattributedOrders ? 'warn' : 'default',
      icon: <AlertCircle size={13} />,
    },
    {
      label: 'Unattributed Revenue',
      value: formatCurrency(s?.unattributedRevenue, currency),
      accent: s?.unattributedRevenue ? 'warn' : 'default',
      icon: <AlertCircle size={13} />,
    },
    {
      label: 'Meta Ads Spend',
      value: pm?.meta?.spend != null ? formatCurrency(pm.meta.spend, currency) : '—',
      sub: metaRoas,
      accent: 'meta',
      icon: <BarChart2 size={13} />,
    },
    {
      label: 'Google Ads Spend',
      value: pm?.google?.spend != null ? formatCurrency(pm.google.spend, currency) : '—',
      sub: googleRoas,
      accent: 'google',
      icon: <TrendingUp size={13} />,
    },
    {
      label: 'TikTok Ads Spend',
      value: '—',
      accent: 'tiktok',
      icon: <Zap size={13} />,
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 lg:grid-cols-5">
      {kpis.map((kpi) => (
        <KpiCard key={kpi.label} loading={loading} {...kpi} />
      ))}
    </div>
  );
}
