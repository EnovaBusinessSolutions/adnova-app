
import { useEffect, useState } from "react";
import { KpiCard } from "@/components/dashboard/KpiCard";
import { ActionCenter } from "@/components/dashboard/ActionCenter";
import { Activity, TrendingUp, Mail, Facebook } from "lucide-react";

import {
  BarChart,
  Bar,
  Cell,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
  LabelList,
} from "recharts";
import { Button } from "@/components/ui/button";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";

const CONVERSION_DATA = [
  { name: "Añadir al Carrito", value: 68 },
  { name: "Iniciar Pago", value: 42 },
  { name: "Compra", value: 23 },
];

// Colores actualizados a tonos de azul
const COLORS = ["#0EA5E9", "#38BDF8", "#7DD3FC"];

export default function Dashboard() {
  const [syncTime, setSyncTime] = useState("2 minutos");
  
  useEffect(() => {
    const interval = setInterval(() => {
      setSyncTime("justo ahora");
      setTimeout(() => setSyncTime("2 minutos"), 10000);
    }, 60000);
    
    return () => clearInterval(interval);
  }, []);
  
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="page-title">Panel de Control</h1>
        <div className="sync-badge">
          <span className="h-2 w-2 rounded-full bg-shopify-500"></span>
          Última sincronización: hace {syncTime}
        </div>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <KpiCard
          title="Tráfico de la Tienda"
          value="4,826"
          change={{ value: "12%", positive: true }}
          icon={<TrendingUp size={18} />}
        />
        <KpiCard
          title="Tasa de Conversión"
          value="2.3%"
          change={{ value: "0.5%", positive: false }}
        />
        <KpiCard
          title="Eventos de Seguimiento"
          value="7/12"
          change={{ value: "5 faltantes", positive: false }}
          icon={<Activity size={18} />}
        />
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="dashboard-section">
          <h2 className="section-title">Embudo de Conversión</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={CONVERSION_DATA}
                layout="vertical"
                margin={{ top: 20, right: 30, left: 20, bottom: 5 }}
              >
                <XAxis type="number" hide />
                <YAxis 
                  dataKey="name" 
                  type="category" 
                  tick={{ fill: "#374151", fontSize: 12 }}
                  width={100}
                  axisLine={false}
                />
                <Tooltip
                  content={props => (
                    <div className="bg-white p-2 border border-border rounded shadow-sm">
                      <p className="text-sm font-medium">{props.payload?.[0]?.name}: {props.payload?.[0]?.value}</p>
                    </div>
                  )}
                />
                <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                  {CONVERSION_DATA.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                  <LabelList 
                    dataKey="value" 
                    position="right"
                    fill="#374151" 
                    formatter={(value) => `${value}`}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        
        <div className="dashboard-section">
          <h2 className="section-title">Estado de Píxeles</h2>
          <div className="space-y-4">
            <div className="flex justify-between items-center p-3 border border-border rounded-md">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
                  <Facebook size={16} />
                </div>
                <div>
                  <h3 className="text-sm font-medium">Píxel de Facebook</h3>
                  <p className="text-xs text-muted-foreground">ID: 123456789</p>
                </div>
              </div>
              <span className="status-badge status-badge-warning">
                Incompleto
              </span>
            </div>
            
            <div className="flex justify-between items-center p-3 border border-border rounded-md">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
                  <Mail size={16} />
                </div>
                <div>
                  <h3 className="text-sm font-medium">Google Analytics</h3>
                  <p className="text-xs text-muted-foreground">ID: GA-12345</p>
                </div>
              </div>
              <span className="status-badge status-badge-warning">
                Incompleto
              </span>
            </div>
            
            <div className="flex justify-between p-3 border border-border rounded-md bg-muted/30">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
                  <span className="text-xs font-bold">TT</span>
                </div>
                <div>
                  <h3 className="text-sm font-medium">Píxel de TikTok</h3>
                  <p className="text-xs text-muted-foreground">No conectado</p>
                </div>
              </div>
              <Button variant="gradient" size="sm">
                Conectar
              </Button>
            </div>
          </div>
        </div>
      </div>
      
      <ActionCenter />
    </div>
  );
}
