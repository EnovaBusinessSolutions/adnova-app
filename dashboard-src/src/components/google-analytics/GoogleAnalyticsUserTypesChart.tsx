
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer } from "recharts";

const userTypesData = [
  { period: "Sem 1", nuevos: 4200, recurrentes: 2800 },
  { period: "Sem 2", nuevos: 3800, recurrentes: 3200 },
  { period: "Sem 3", nuevos: 4500, recurrentes: 3600 },
  { period: "Sem 4", nuevos: 4800, recurrentes: 4100 },
];

const chartConfig = {
  nuevos: {
    label: "Usuarios Nuevos",
    color: "hsl(var(--primary))",
  },
  recurrentes: {
    label: "Usuarios Recurrentes",
    color: "hsl(267, 84%, 77%)",
  },
};

export const GoogleAnalyticsUserTypesChart = () => {
  return (
    <Card className="glass-effect">
      <CardHeader>
        <CardTitle className="text-foreground">Usuarios Nuevos vs Recurrentes</CardTitle>
        <CardDescription>
          Comparación semanal de tipos de usuarios
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig} className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={userTypesData} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis 
                dataKey="period" 
                stroke="hsl(var(--muted-foreground))"
                fontSize={12}
              />
              <YAxis 
                stroke="hsl(var(--muted-foreground))"
                fontSize={12}
              />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar 
                dataKey="nuevos" 
                fill="var(--color-nuevos)" 
                radius={[4, 4, 0, 0]}
              />
              <Bar 
                dataKey="recurrentes" 
                fill="var(--color-recurrentes)" 
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </ChartContainer>
      </CardContent>
    </Card>
  );
};
