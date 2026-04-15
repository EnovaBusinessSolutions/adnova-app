
import { CircleCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export interface PixelEvent {
  id: string;
  name: string;
  required: boolean;
  detected: boolean;
  platform: "Facebook" | "Google" | "TikTok";
}

export function PixelTable() {
  const { toast } = useToast();
  
  const pixelEvents: PixelEvent[] = [
    { id: "1", name: "PageView", required: true, detected: true, platform: "Facebook" },
    { id: "2", name: "ViewContent", required: true, detected: true, platform: "Facebook" },
    { id: "3", name: "AddToCart", required: true, detected: true, platform: "Facebook" },
    { id: "4", name: "InitiateCheckout", required: true, detected: false, platform: "Facebook" },
    { id: "5", name: "Purchase", required: true, detected: false, platform: "Facebook" },
    { id: "6", name: "page_view", required: true, detected: true, platform: "Google" },
    { id: "7", name: "view_item", required: true, detected: true, platform: "Google" },
    { id: "8", name: "add_to_cart", required: true, detected: true, platform: "Google" },
    { id: "9", name: "begin_checkout", required: true, detected: false, platform: "Google" },
    { id: "10", name: "purchase", required: true, detected: false, platform: "Google" },
  ];
  
  const handleFix = () => {
    toast({
      title: "Pixel fix deployed",
      description: "Missing pixel events have been added to your store",
    });
  };
  
  const missingEvents = pixelEvents.filter(event => !event.detected);
  
  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="section-title">Pixel Events</h2>
          <p className="text-sm text-muted-foreground">
            Analysis of required tracking events for your marketing platforms
          </p>
        </div>
        
        {missingEvents.length > 0 && (
          <Button onClick={handleFix} className="bg-shopify hover:bg-shopify-700">
            Fix All Missing Events
          </Button>
        )}
      </div>
      
      <div className="border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Event Name</TableHead>
              <TableHead>Platform</TableHead>
              <TableHead>Required</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pixelEvents.map((event) => (
              <TableRow key={event.id}>
                <TableCell className="font-medium">{event.name}</TableCell>
                <TableCell>{event.platform}</TableCell>
                <TableCell>{event.required ? "Yes" : "No"}</TableCell>
                <TableCell>
                  {event.detected ? (
                    <span className="status-badge status-badge-success">
                      <CircleCheck className="h-3 w-3" />
                      Detected
                    </span>
                  ) : (
                    <span className="status-badge status-badge-error">
                      Missing
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  {!event.detected && (
                    <Button variant="outline" size="sm" onClick={handleFix}>
                      Inject Fix
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
