
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer } from "recharts";

const conversionsData = [
  { campaign: "Summer Collection", conversiones: 324, roas: 4.2 },
  { campaign: "Holiday Sale", conversiones: 278, roas: 3.8 },
  { campaign: "Product Launch", conversiones: 412, roas: 5.1 },
  { campaign: "Retargeting", conversiones: 156, roas: 6.2 },
  { campaign: "Brand Awareness", conversiones: 198, roas: 2.9 },
];

const chartConfig = {
  conversiones: {
    label: "Conversiones",
    color: "hsl(var(--primary))",
  },
  roas: {
    label: "ROAS",
    color: "hsl(142, 76%, 36%)",
  },
};

export const MetaAdsConversionsChart = () => {
  return (
    <Card className="glass-effect">
      <CardHeader>
        <CardTitle className="text-foreground">Conversiones y ROAS por Campaña</CardTitle>
        <CardDescription>
          Comparación del rendimiento de conversiones
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig} className="h-[350px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={conversionsData} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis 
                dataKey="campaign" 
                stroke="hsl(var(--muted-foreground))"
                fontSize={12}
                angle={-45}
                textAnchor="end"
                height={100}
              />
              <YAxis 
                yAxisId="left"
                stroke="hsl(var(--muted-foreground))"
                fontSize={12}
              />
              <YAxis 
                yAxisId="right"
                orientation="right"
                stroke="hsl(var(--muted-foreground))"
                fontSize={12}
              />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar 
                yAxisId="left"
                dataKey="conversiones" 
                fill="var(--color-conversiones)" 
                radius={[4, 4, 0, 0]}
              />
              <Bar 
                yAxisId="right"
                dataKey="roas" 
                fill="var(--color-roas)" 
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </ChartContainer>
      </CardContent>
    </Card>
  );
};
