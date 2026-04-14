
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";

export interface AuditItemProps {
  title: string;
  description: string;
  severity: "high" | "medium" | "low";
  screenshot?: string;
  solution?: string;
}

export function AuditItem({
  title,
  description,
  severity,
  screenshot,
  solution,
}: AuditItemProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="border border-border rounded-md overflow-hidden">
      <div 
        className="flex items-center justify-between p-4 cursor-pointer"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-3">
          <div className={cn("severity-indicator", {
            "severity-high": severity === "high",
            "severity-medium": severity === "medium",
            "severity-low": severity === "low",
          })} />
          <h3 className="font-medium">{title}</h3>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="p-0 h-8 w-8"
        >
          {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </Button>
      </div>
      
      {isExpanded && (
        <div className="p-4 border-t border-border bg-muted/30 animate-fade-in">
          <p className="text-sm mb-4">{description}</p>
          
          {screenshot && (
            <div className="mb-4">
              <p className="text-xs text-muted-foreground mb-2">Screenshot</p>
              <div className="border border-border rounded-md overflow-hidden bg-white">
                <img 
                  src={screenshot} 
                  alt={`Screenshot showing ${title}`}
                  className="w-full h-auto max-h-48 object-cover"
                />
              </div>
            </div>
          )}
          
          {solution && (
            <div>
              <p className="text-xs text-muted-foreground mb-2">Recommended Solution</p>
              <p className="text-sm">{solution}</p>
            </div>
          )}
          
          <div className="flex gap-2 mt-4">
            <Button size="sm" className="bg-shopify hover:bg-shopify-700">
              Fix Issue
            </Button>
            <Button size="sm" variant="outline">
              Ignore
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
