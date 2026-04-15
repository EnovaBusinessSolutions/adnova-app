
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer } from "recharts";

const conversionData = [
  { campaign: "Búsqueda", conversiones: 789, roas: 5.2 },
  { campaign: "Display", conversiones: 445, roas: 4.8 },
  { campaign: "Shopping", conversiones: 234, roas: 2.1 },
  { campaign: "Video", conversiones: 567, roas: 6.2 },
];

const chartConfig = {
  conversiones: { label: "Conversiones", color: "hsl(var(--primary))" },
  roas: { label: "ROAS", color: "hsl(220 70% 50%)" },
};

export const GoogleAdsConversionChart = () => {
  return (
    <Card className="border-2 rounded-2xl shadow-sm">
      <CardHeader>
        <CardTitle>Conversiones y ROAS por Campaña</CardTitle>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig} className="h-[400px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={conversionData} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis 
                dataKey="campaign" 
                className="text-xs fill-muted-foreground"
              />
              <YAxis yAxisId="left" className="text-xs fill-muted-foreground" />
              <YAxis yAxisId="right" orientation="right" className="text-xs fill-muted-foreground" />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar 
                yAxisId="left"
                dataKey="conversiones" 
                fill={chartConfig.conversiones.color}
                radius={[4, 4, 0, 0]}
              />
              <Bar 
                yAxisId="right"
                dataKey="roas" 
                fill={chartConfig.roas.color}
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </ChartContainer>
      </CardContent>
    </Card>
  );
};
