
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { 
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const campaignData = [
  {
    campaign: "Campaña Búsqueda Principal",
    impresiones: "456,789",
    clics: "12,345",
    ctr: "2.7%",
    cpc: "$1.15",
    conversiones: "789",
    cpa: "$18.50",
    roas: "5.2x",
    status: "active",
    performance: "good",
  },
  {
    campaign: "Campaña Display Premium",
    impresiones: "789,123",
    clics: "8,901",
    ctr: "1.1%",
    cpc: "$0.85",
    conversiones: "445",
    cpa: "$17.20",
    roas: "4.8x",
    status: "active",
    performance: "good",
  },
  {
    campaign: "Campaña Shopping",
    impresiones: "234,567",
    clics: "5,678",
    ctr: "2.4%",
    cpc: "$1.45",
    conversiones: "234",
    cpa: "$35.10",
    roas: "2.1x",
    status: "paused",
    performance: "poor",
  },
  {
    campaign: "Campaña Video YouTube",
    impresiones: "1,234,567",
    clics: "15,678",
    ctr: "1.3%",
    cpc: "$0.65",
    conversiones: "567",
    cpa: "$18.90",
    roas: "6.2x",
    status: "active",
    performance: "excellent",
  },
];

export const GoogleAdsCampaignTable = () => {
  const getPerformanceColor = (performance: string) => {
    switch (performance) {
      case "excellent":
        return "bg-primary/10 text-primary border-l-4 border-l-primary";
      case "good":
        return "bg-accent/30 text-accent-foreground border-l-4 border-l-accent";
      case "poor":
        return "bg-muted/50 text-muted-foreground border-l-4 border-l-border";
      default:
        return "bg-card text-card-foreground";
    }
  };

  const getStatusBadge = (status: string) => {
    return status === "active" 
      ? <Badge className="bg-primary/20 text-primary border border-primary/30 hover:bg-primary/30">Activo</Badge>
      : <Badge className="bg-muted text-muted-foreground border border-border hover:bg-muted/80">Pausado</Badge>;
  };

  return (
    <Card className="border-2 rounded-2xl shadow-sm">
      <CardHeader>
        <CardTitle>Rendimiento por Campaña</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Campaña</TableHead>
                <TableHead className="text-right">Impresiones</TableHead>
                <TableHead className="text-right">Clics</TableHead>
                <TableHead className="text-right">CTR</TableHead>
                <TableHead className="text-right">CPC</TableHead>
                <TableHead className="text-right">Conversiones</TableHead>
                <TableHead className="text-right">CPA</TableHead>
                <TableHead className="text-right">ROAS</TableHead>
                <TableHead>Estado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {campaignData.map((campaign, index) => (
                <TableRow key={index} className={getPerformanceColor(campaign.performance)}>
                  <TableCell className="font-medium">{campaign.campaign}</TableCell>
                  <TableCell className="text-right">{campaign.impresiones}</TableCell>
                  <TableCell className="text-right">{campaign.clics}</TableCell>
                  <TableCell className="text-right">{campaign.ctr}</TableCell>
                  <TableCell className="text-right">{campaign.cpc}</TableCell>
                  <TableCell className="text-right">{campaign.conversiones}</TableCell>
                  <TableCell className="text-right">{campaign.cpa}</TableCell>
                  <TableCell className="text-right font-semibold">{campaign.roas}</TableCell>
                  <TableCell>{getStatusBadge(campaign.status)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
};
