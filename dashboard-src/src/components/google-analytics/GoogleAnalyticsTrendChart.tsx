
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Legend } from "recharts";

const chartData = [
  { date: "1 Nov", usuarios: 4200, sesiones: 6800, conversiones: 180, engagement: 65 },
  { date: "5 Nov", usuarios: 3800, sesiones: 6200, conversiones: 165, engagement: 68 },
  { date: "10 Nov", usuarios: 4500, sesiones: 7200, conversiones: 195, engagement: 70 },
  { date: "15 Nov", usuarios: 4800, sesiones: 7800, conversiones: 210, engagement: 72 },
  { date: "20 Nov", usuarios: 5200, sesiones: 8400, conversiones: 225, engagement: 69 },
  { date: "25 Nov", usuarios: 4900, sesiones: 7900, conversiones: 208, engagement: 71 },
  { date: "30 Nov", usuarios: 5400, sesiones: 8900, conversiones: 245, engagement: 73 },
];

const chartConfig = {
  usuarios: {
    label: "Usuarios",
    color: "hsl(var(--primary))",
  },
  sesiones: {
    label: "Sesiones",
    color: "hsl(267, 84%, 77%)",
  },
  conversiones: {
    label: "Conversiones",
    color: "hsl(157, 84%, 67%)",
  },
  engagement: {
    label: "Engagement (%)",
    color: "hsl(47, 84%, 67%)",
  },
};

export const GoogleAnalyticsTrendChart = () => {
  return (
    <Card className="glass-effect">
      <CardHeader>
        <CardTitle className="text-foreground">Tendencias Principales</CardTitle>
        <CardDescription>
          Evolución de métricas principales del sitio web
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig} className="h-[400px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis 
                dataKey="date" 
                stroke="hsl(var(--muted-foreground))"
                fontSize={12}
              />
              <YAxis 
                stroke="hsl(var(--muted-foreground))"
                fontSize={12}
              />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Legend />
              <Line 
                type="monotone" 
                dataKey="usuarios" 
                stroke="var(--color-usuarios)" 
                strokeWidth={2}
                dot={{ fill: "var(--color-usuarios)", strokeWidth: 2 }}
              />
              <Line 
                type="monotone" 
                dataKey="sesiones" 
                stroke="var(--color-sesiones)" 
                strokeWidth={2}
                dot={{ fill: "var(--color-sesiones)", strokeWidth: 2 }}
              />
              <Line 
                type="monotone" 
                dataKey="conversiones" 
                stroke="var(--color-conversiones)" 
                strokeWidth={2}
                dot={{ fill: "var(--color-conversiones)", strokeWidth: 2 }}
              />
              <Line 
                type="monotone" 
                dataKey="engagement" 
                stroke="var(--color-engagement)" 
                strokeWidth={2}
                dot={{ fill: "var(--color-engagement)", strokeWidth: 2 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </ChartContainer>
      </CardContent>
    </Card>
  );
};
