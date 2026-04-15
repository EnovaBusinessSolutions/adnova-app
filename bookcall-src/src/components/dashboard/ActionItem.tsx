
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface ActionItemProps {
  title: string;
  description: string;
  severity: "high" | "medium" | "low";
  actionText: string;
  onAction: () => void;
}

export function ActionItem({ title, description, severity, actionText, onAction }: ActionItemProps) {
  return (
    <div className="flex items-start gap-4 p-4 border-b border-border last:border-0">
      <div className={cn("severity-indicator mt-1.5", {
        "severity-high": severity === "high",
        "severity-medium": severity === "medium",
        "severity-low": severity === "low",
      })} />
      <div className="flex-grow">
        <h4 className="font-medium">{title}</h4>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <Button
        variant="outline"
        size="sm"
        className={cn({
          "border-error-300 text-error-600 hover:bg-error-50": severity === "high",
          "border-warning-300 text-warning-700 hover:bg-warning-50": severity === "medium",
          "border-shopify-300 text-shopify hover:bg-shopify-50": severity === "low",
        })}
        onClick={onAction}
      >
        {actionText}
      </Button>
    </div>
  );
}
