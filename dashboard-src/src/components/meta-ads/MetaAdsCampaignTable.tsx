
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

const campaignsData = [
  {
    campaign: "Summer Collection 2024",
    impresiones: 450000,
    alcance: 285000,
    frecuencia: 1.58,
    clics: 12450,
    ctr: 2.77,
    conversiones: 324,
    cpa: 28.50,
    roas: 4.2,
    status: "Activa",
  },
  {
    campaign: "Holiday Sale",
    impresiones: 380000,
    alcance: 240000,
    frecuencia: 1.92,
    clics: 9850,
    ctr: 2.59,
    conversiones: 278,
    cpa: 32.10,
    roas: 3.8,
    status: "Activa",
  },
  {
    campaign: "Brand Awareness Q1",
    impresiones: 620000,
    alcance: 420000,
    frecuencia: 1.48,
    clics: 15200,
    ctr: 2.45,
    conversiones: 198,
    cpa: 45.20,
    roas: 2.9,
    status: "Pausada",
  },
  {
    campaign: "Product Launch",
    impresiones: 290000,
    alcance: 185000,
    frecuencia: 1.67,
    clics: 8900,
    ctr: 3.07,
    conversiones: 412,
    cpa: 22.75,
    roas: 5.1,
    status: "Activa",
  },
  {
    campaign: "Retargeting Campaign",
    impresiones: 120000,
    alcance: 95000,
    frecuencia: 2.31,
    clics: 4200,
    ctr: 3.50,
    conversiones: 156,
    cpa: 18.90,
    roas: 6.2,
    status: "Activa",
  },
];

export const MetaAdsCampaignTable = () => {
  return (
    <Card className="glass-effect">
      <CardHeader>
        <CardTitle className="text-foreground">Rendimiento por Campaña</CardTitle>
        <CardDescription>
          Análisis detallado de todas las campañas activas
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-muted-foreground">Campaña</TableHead>
              <TableHead className="text-muted-foreground">Impresiones</TableHead>
              <TableHead className="text-muted-foreground">Alcance</TableHead>
              <TableHead className="text-muted-foreground">Frecuencia</TableHead>
              <TableHead className="text-muted-foreground">Clics</TableHead>
              <TableHead className="text-muted-foreground">CTR</TableHead>
              <TableHead className="text-muted-foreground">Conversiones</TableHead>
              <TableHead className="text-muted-foreground">CPA</TableHead>
              <TableHead className="text-muted-foreground">ROAS</TableHead>
              <TableHead className="text-muted-foreground">Estado</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {campaignsData.map((campaign, index) => (
              <TableRow key={index} className="hover:bg-muted/50">
                <TableCell className="font-medium text-foreground">
                  {campaign.campaign}
                </TableCell>
                <TableCell className="text-foreground">
                  {campaign.impresiones.toLocaleString()}
                </TableCell>
                <TableCell className="text-foreground">
                  {campaign.alcance.toLocaleString()}
                </TableCell>
                <TableCell className="text-foreground">
                  {campaign.frecuencia}
                </TableCell>
                <TableCell className="text-foreground">
                  {campaign.clics.toLocaleString()}
                </TableCell>
                <TableCell>
                  <Badge 
                    variant={campaign.ctr > 3 ? "default" : "secondary"}
                    className="text-xs"
                  >
                    {campaign.ctr}%
                  </Badge>
                </TableCell>
                <TableCell className="text-foreground">
                  {campaign.conversiones}
                </TableCell>
                <TableCell className="text-foreground">
                  ${campaign.cpa}
                </TableCell>
                <TableCell>
                  <Badge 
                    variant={campaign.roas > 4 ? "default" : "secondary"}
                    className="text-xs"
                  >
                    {campaign.roas}x
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge 
                    variant={campaign.status === "Activa" ? "default" : "secondary"}
                    className="text-xs"
                  >
                    {campaign.status}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
};
