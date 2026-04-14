
import { TrendingUp, TrendingDown, ShoppingCart, DollarSign, Package, Target } from "lucide-react";

const kpiData = [
  {
    title: "Tráfico de la Tienda",
    value: "Proximamente",
    change: "+0.0%",
    trend: "up",
    icon: TrendingUp,
    sparkline: [20, 25, 22, 28, 26, 30, 28, 32, 30, 35, 33, 38]
  },
  {
    title: "Pedidos últimos 30 días",
    value: "Proximamente",
    change: "+0.0%",
    trend: "up",
    icon: ShoppingCart,
    sparkline: [15, 18, 16, 22, 20, 25, 23, 28, 26, 30, 28, 32]
  },
  {
    title: "Ventas últimos 30 días",
    value: "Proximamente",
    change: "+0.0%",
    trend: "up",
    icon: DollarSign,
    sparkline: [30, 35, 32, 40, 38, 45, 42, 48, 46, 52, 50, 55]
  },
  {
    title: "Valor Promedio de Pedido",
    value: "Proximamente",
    change: "+0.0%",
    trend: "down",
    icon: Target,
    sparkline: [60, 58, 62, 59, 57, 55, 58, 56, 54, 52, 55, 53]
  }
];

export const KPIRow = () => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      {kpiData.map((kpi, index) => (
        <div
          key={index}
          className="bg-[#15121A] border border-[#2C2530] rounded-2xl p-6 hover:shadow-[0_4px_20px_rgba(181,92,255,0.1)] hover:border-[#A664FF] transition-all duration-300 hover:-translate-y-1 animate-fade-in"
          style={{ animationDelay: `${index * 100}ms` }}
        >
          <div className="flex items-center justify-between mb-4">
            <div className="p-2 bg-gradient-to-r from-[#B55CFF] to-[#9D5BFF] rounded-lg">
              <kpi.icon className="w-5 h-5 text-white" />
            </div>
            <div className={`flex items-center space-x-1 px-2 py-1 rounded-full text-xs font-medium ${
              kpi.trend === 'up' 
                ? 'bg-green-500/20 text-green-400' 
                : 'bg-red-500/20 text-red-400'
            }`}>
              {kpi.trend === 'up' ? (
                <TrendingUp className="w-3 h-3" />
              ) : (
                <TrendingDown className="w-3 h-3" />
              )}
              <span>{kpi.change}</span>
            </div>
          </div>
          
          <div className="space-y-2">
            <h3 className="text-[#9A8CA8] text-sm font-medium">{kpi.title}</h3>
            <p className="text-[#E5D3FF] text-2xl font-bold">{kpi.value}</p>
          </div>
          
          {/* Mini Sparkline */}
          <div className="mt-4 h-8 flex items-end space-x-1">
            {kpi.sparkline.map((value, i) => (
              <div
                key={i}
                className="bg-gradient-to-t from-[#B55CFF] to-[#9D5BFF] rounded-sm flex-1 opacity-70"
                style={{ height: `${(value / Math.max(...kpi.sparkline)) * 100}%` }}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};
