
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";

const demographicsData = [
  { grupo: "18-24", conversiones: 145, porcentaje: 23 },
  { grupo: "25-34", conversiones: 298, porcentaje: 47 },
  { grupo: "35-44", conversiones: 156, porcentaje: 25 },
  { grupo: "45-54", conversiones: 89, porcentaje: 14 },
  { grupo: "55+", conversiones: 42, porcentaje: 7 },
];

const deviceData = [
  { name: "Móvil", value: 68, color: "hsl(var(--primary))" },
  { name: "Desktop", value: 24, color: "hsl(267, 84%, 77%)" },
  { name: "Tablet", value: 8, color: "hsl(142, 76%, 36%)" },
];

const placementData = [
  { placement: "Facebook Feed", conversiones: 312, ctr: 3.2 },
  { placement: "Instagram Stories", conversiones: 245, ctr: 4.1 },
  { placement: "Instagram Feed", conversiones: 189, ctr: 2.8 },
  { placement: "Facebook Stories", conversiones: 156, ctr: 3.7 },
  { placement: "Audience Network", conversiones: 98, ctr: 2.3 },
];

const chartConfig = {
  conversiones: {
    label: "Conversiones",
    color: "hsl(var(--primary))",
  },
  ctr: {
    label: "CTR",
    color: "hsl(142, 76%, 36%)",
  },
};

export const MetaAdsSegmentationCharts = () => {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Demografía por Edad */}
      <Card className="glass-effect">
        <CardHeader>
          <CardTitle className="text-foreground">Segmentación por Edad</CardTitle>
          <CardDescription>
            Distribución de conversiones por grupo etario
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ChartContainer config={chartConfig} className="h-[250px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={demographicsData} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis 
                  dataKey="grupo" 
                  stroke="hsl(var(--muted-foreground))"
                  fontSize={12}
                />
                <YAxis 
                  stroke="hsl(var(--muted-foreground))"
                  fontSize={12}
                />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar 
                  dataKey="conversiones" 
                  fill="var(--color-conversiones)" 
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </ChartContainer>
        </CardContent>
      </Card>

      {/* Dispositivos */}
      <Card className="glass-effect">
        <CardHeader>
          <CardTitle className="text-foreground">Distribución por Dispositivo</CardTitle>
          <CardDescription>
            Porcentaje de tráfico por tipo de dispositivo
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ChartContainer config={chartConfig} className="h-[250px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={deviceData}
                  cx="50%"
                  cy="50%"
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                  label={({ name, value }) => `${name}: ${value}%`}
                >
                  {deviceData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <ChartTooltip />
              </PieChart>
            </ResponsiveContainer>
          </ChartContainer>
        </CardContent>
      </Card>
    </div>
  );
};

export const MetaAdsPlacementChart = () => {
  const chartConfig = {
    conversiones: {
      label: "Conversiones",
      color: "hsl(var(--primary))",
    },
    ctr: {
      label: "CTR",
      color: "hsl(142, 76%, 36%)",
    },
  };

  const placementData = [
    { placement: "Facebook Feed", conversiones: 312, ctr: 3.2 },
    { placement: "Instagram Stories", conversiones: 245, ctr: 4.1 },
    { placement: "Instagram Feed", conversiones: 189, ctr: 2.8 },
    { placement: "Facebook Stories", conversiones: 156, ctr: 3.7 },
    { placement: "Audience Network", conversiones: 98, ctr: 2.3 },
  ];

  return (
    <Card className="glass-effect">
      <CardHeader>
        <CardTitle className="text-foreground">Performance por Placement</CardTitle>
        <CardDescription>
          Rendimiento en diferentes ubicaciones de anuncios
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig} className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={placementData} margin={{ top: 20, right: 30, left: 20, bottom: 60 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis 
                dataKey="placement" 
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
                dataKey="ctr" 
                fill="var(--color-ctr)" 
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </ChartContainer>
      </CardContent>
    </Card>
  );
};
