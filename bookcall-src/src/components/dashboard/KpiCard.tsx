
import { cn } from "@/lib/utils";

export interface KpiCardProps {
  title: string;
  value: string;
  change?: {
    value: string;
    positive: boolean;
  };
  icon?: React.ReactNode;
}

export function KpiCard({ title, value, change, icon }: KpiCardProps) {
  return (
    <div className="kpi-card">
      <div className="flex items-start justify-between">
        <h3 className="text-sm font-medium text-muted-foreground">{title}</h3>
        {icon && <div className="text-muted-foreground">{icon}</div>}
      </div>
      <div className="space-y-1">
        <p className="text-2xl font-semibold">{value}</p>
        {change && (
          <div
            className={cn(
              "text-xs font-medium inline-flex items-center",
              change.positive ? "text-shopify-600" : "text-error-600"
            )}
          >
            <span
              className={cn(
                "mr-1",
                change.positive ? "text-shopify-600" : "text-error-600"
              )}
            >
              {change.positive ? "↑" : "↓"}
            </span>
            {change.value} vs período anterior
          </div>
        )}
      </div>
    </div>
  );
}
