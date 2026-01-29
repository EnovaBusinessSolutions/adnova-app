
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

const topAdsData = [
  {
    headline: "Oferta Especial 50% Descuento",
    image: "/placeholder.svg",
    ctr: "4.2%",
    conversiones: "145",
    qualityScore: 9,
  },
  {
    headline: "Productos Premium - Envío Gratis",
    image: "/placeholder.svg",
    ctr: "3.8%",
    conversiones: "123",
    qualityScore: 8,
  },
  {
    headline: "Mejor Precio Garantizado",
    image: "/placeholder.svg",
    ctr: "3.1%",
    conversiones: "98",
    qualityScore: 7,
  },
  {
    headline: "Compra Ahora - Stock Limitado",
    image: "/placeholder.svg",
    ctr: "2.9%",
    conversiones: "87",
    qualityScore: 8,
  },
];

export const GoogleAdsTopAds = () => {
  const getQualityScoreBadge = (score: number) => {
    if (score >= 8) {
      return <Badge className="bg-green-100 text-green-800">{score}/10</Badge>;
    } else if (score >= 6) {
      return <Badge className="bg-yellow-100 text-yellow-800">{score}/10</Badge>;
    } else {
      return <Badge variant="destructive">{score}/10</Badge>;
    }
  };

  return (
    <Card className="border-2 rounded-2xl shadow-sm">
      <CardHeader>
        <CardTitle>Anuncios Destacados</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Anuncio</TableHead>
                <TableHead className="text-right">CTR</TableHead>
                <TableHead className="text-right">Conversiones</TableHead>
                <TableHead className="text-right">Quality Score</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {topAdsData.map((ad, index) => (
                <TableRow key={index}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <img 
                        src={ad.image} 
                        alt="Ad thumbnail" 
                        className="w-12 h-12 rounded-lg object-cover"
                      />
                      <div className="font-medium max-w-48 truncate">
                        {ad.headline}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-semibold">{ad.ctr}</TableCell>
                  <TableCell className="text-right">{ad.conversiones}</TableCell>
                  <TableCell className="text-right">
                    {getQualityScoreBadge(ad.qualityScore)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
};
