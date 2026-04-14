
import { ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import { CircleCheck } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ConnectionCardProps {
  title: string;
  description: string;
  icon: ReactNode;
  connected?: boolean;
  onConnect: () => void;
  onDisconnect?: () => void;
  required?: boolean;
}

export function ConnectionCard({
  title,
  description,
  icon,
  connected = false,
  onConnect,
  onDisconnect,
  required = false,
}: ConnectionCardProps) {
  const [isConnecting, setIsConnecting] = useState(false);
  const [isConnected, setIsConnected] = useState(connected);

  const handleConnect = async () => {
    setIsConnecting(true);
    // Simulate connection
    setTimeout(() => {
      setIsConnected(true);
      setIsConnecting(false);
      onConnect();
    }, 1500);
  };

  const handleDisconnect = () => {
    setIsConnected(false);
    onDisconnect?.();
  };

  return (
    <div className={cn(
      "connection-card",
      isConnected && "border-shopify border-2",
      required && !isConnected && "border-warning-300 border-2"
    )}>
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-md flex items-center justify-center bg-muted">
            {icon}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-medium">{title}</h3>
              {required && (
                <span className="text-xs px-1.5 py-0.5 bg-warning-100 text-warning-700 rounded-full">
                  Required
                </span>
              )}
            </div>
            <p className="text-sm text-muted-foreground">{description}</p>
          </div>
        </div>
        {isConnected && (
          <span className="status-badge status-badge-success">
            <CircleCheck className="h-3 w-3" />
            Connected
          </span>
        )}
      </div>
      <div className="mt-4">
        {isConnected ? (
          <Button
            variant="outline"
            size="sm"
            onClick={handleDisconnect}
            className="w-full"
            disabled={required}
          >
            {required ? "Required" : "Disconnect"}
          </Button>
        ) : (
          <Button
            variant="gradient"
            size="sm"
            onClick={handleConnect}
            disabled={isConnecting}
            className="w-full"
          >
            {isConnecting ? "Connecting..." : "Connect"}
          </Button>
        )}
      </div>
    </div>
  );
}
