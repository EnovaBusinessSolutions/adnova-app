
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Legend, BarChart, Bar } from "recharts";

const performanceData = [
  { date: "1 Nov", usuarios: 4200, sesiones: 6800, conversiones: 180, engagement: 65 },
  { date: "5 Nov", usuarios: 3800, sesiones: 6200, conversiones: 165, engagement: 68 },
  { date: "10 Nov", usuarios: 4500, sesiones: 7200, conversiones: 195, engagement: 70 },
  { date: "15 Nov", usuarios: 4800, sesiones: 7800, conversiones: 210, engagement: 72 },
  { date: "20 Nov", usuarios: 5200, sesiones: 8400, conversiones: 225, engagement: 69 },
  { date: "25 Nov", usuarios: 4900, sesiones: 7900, conversiones: 208, engagement: 71 },
  { date: "30 Nov", usuarios: 5400, sesiones: 8900, conversiones: 245, engagement: 73 },
];

const userTypesData = [
  { period: "Sem 1", nuevos: 4200, recurrentes: 2800 },
  { period: "Sem 2", nuevos: 3800, recurrentes: 3200 },
  { period: "Sem 3", nuevos: 4500, recurrentes: 3600 },
  { period: "Sem 4", nuevos: 4800, recurrentes: 4100 },
];

const performanceConfig = {
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

const userTypesConfig = {
  nuevos: {
    label: "Usuarios Nuevos",
    color: "hsl(var(--primary))",
  },
  recurrentes: {
    label: "Usuarios Recurrentes",
    color: "hsl(267, 84%, 77%)",
  },
};

export const GoogleAnalyticsPerformanceAndUserTypes = () => {
  return (
    <Card className="glass-effect">
      <CardHeader>
        <CardTitle className="text-foreground">Performance y Tipos de Usuario</CardTitle>
        <CardDescription>
          Análisis completo de tendencias y segmentación de usuarios
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-8">
        {/* Performance Trends Chart */}
        <div>
          <h3 className="text-lg font-semibold text-foreground mb-4">Tendencias de Performance</h3>
          <ChartContainer config={performanceConfig} className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={performanceData}>
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
        </div>

        {/* User Types Chart */}
        <div>
          <h3 className="text-lg font-semibold text-foreground mb-4">Usuarios Nuevos vs Recurrentes</h3>
          <ChartContainer config={userTypesConfig} className="h-[300px]">
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
        </div>
      </CardContent>
    </Card>
  );
};
