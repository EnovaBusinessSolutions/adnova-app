
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { AspectRatio } from "@/components/ui/aspect-ratio";

const topAdsData = [
  {
    creative: "/placeholder.svg",
    headline: "Descubre la Nueva Colección de Verano",
    quality: "Excelente",
    ctr: 4.2,
    conversiones: 89,
    relevancia: 9.2,
  },
  {
    creative: "/placeholder.svg",
    headline: "Ofertas Especiales por Tiempo Limitado",
    quality: "Buena",
    ctr: 3.8,
    conversiones: 76,
    relevancia: 8.7,
  },
  {
    creative: "/placeholder.svg",
    headline: "Productos Exclusivos Solo para Ti",
    quality: "Excelente",
    ctr: 4.5,
    conversiones: 92,
    relevancia: 9.5,
  },
  {
    creative: "/placeholder.svg",
    headline: "Envío Gratis en Toda Tu Compra",
    quality: "Buena",
    ctr: 3.4,
    conversiones: 64,
    relevancia: 8.1,
  },
  {
    creative: "/placeholder.svg",
    headline: "Últimas Tendencias de la Temporada",
    quality: "Regular",
    ctr: 2.9,
    conversiones: 45,
    relevancia: 7.3,
  },
];

export const MetaAdsTopAds = () => {
  const getQualityColor = (quality: string) => {
    switch (quality) {
      case "Excelente": return "default";
      case "Buena": return "secondary";
      case "Regular": return "outline";
      default: return "destructive";
    }
  };

  return (
    <Card className="glass-effect">
      <CardHeader>
        <CardTitle className="text-foreground">Ranking de Anuncios</CardTitle>
        <CardDescription>
          Los anuncios con mejor rendimiento y métricas de calidad
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-muted-foreground">Creatividad</TableHead>
              <TableHead className="text-muted-foreground">Headline</TableHead>
              <TableHead className="text-muted-foreground">Calidad</TableHead>
              <TableHead className="text-muted-foreground">CTR</TableHead>
              <TableHead className="text-muted-foreground">Conversiones</TableHead>
              <TableHead className="text-muted-foreground">Relevancia</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {topAdsData.map((ad, index) => (
              <TableRow key={index} className="hover:bg-muted/50">
                <TableCell>
                  <div className="w-16 h-16">
                    <AspectRatio ratio={1}>
                      <img 
                        src={ad.creative} 
                        alt="Ad creative" 
                        className="rounded-md object-cover w-full h-full"
                      />
                    </AspectRatio>
                  </div>
                </TableCell>
                <TableCell className="font-medium text-foreground max-w-xs">
                  {ad.headline}
                </TableCell>
                <TableCell>
                  <Badge 
                    variant={getQualityColor(ad.quality)}
                    className="text-xs"
                  >
                    {ad.quality}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge 
                    variant={ad.ctr > 4 ? "default" : "secondary"}
                    className="text-xs"
                  >
                    {ad.ctr}%
                  </Badge>
                </TableCell>
                <TableCell className="text-foreground">
                  {ad.conversiones}
                </TableCell>
                <TableCell>
                  <Badge 
                    variant={ad.relevancia > 9 ? "default" : "secondary"}
                    className="text-xs"
                  >
                    {ad.relevancia}/10
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
