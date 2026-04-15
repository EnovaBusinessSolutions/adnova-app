
import { CheckCircle, AlertCircle, XCircle } from "lucide-react";

const pixelData = [
  {
    name: "Shopify Pixel",
    status: "active",
    lastUpdate: "hace 2 min",
    icon: CheckCircle,
    color: "text-green-400"
  },
  {
    name: "Google Analytics",
    status: "active",
    lastUpdate: "hace 5 min",
    icon: CheckCircle,
    color: "text-green-400"
  },
  {
    name: "Meta Pixel",
    status: "warning",
    lastUpdate: "hace 15 min",
    icon: AlertCircle,
    color: "text-yellow-400"
  },
  {
    name: "Google Ads",
    status: "active",
    lastUpdate: "hace 3 min",
    icon: CheckCircle,
    color: "text-green-400"
  }
];

export const PixelHealth = () => {
  return (
    <div className="bg-[#15121A] border border-[#2C2530] rounded-2xl p-6 hover:shadow-[0_4px_20px_rgba(181,92,255,0.1)] hover:border-[#A664FF] transition-all duration-300">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-[#E5D3FF] text-lg font-bold">Estado de Píxeles</h3>
        <div className="text-right">
          <p className="text-[#9A8CA8] text-sm">Próximamente</p>
        </div>
      </div>
      
      <div className="space-y-4">
        {pixelData.map((pixel, index) => (
          <div
            key={index}
            className="flex items-center justify-between p-3 bg-[#0B0B0D] rounded-lg border border-[#2C2530] hover:border-[#A664FF] transition-colors"
          >
            <div className="flex items-center space-x-3">
              <pixel.icon className={`w-5 h-5 ${pixel.color}`} />
              <div>
                <p className="text-white font-medium">{pixel.name}</p>
                <p className="text-[#9A8CA8] text-sm">{pixel.lastUpdate}</p>
              </div>
            </div>
            <div className={`w-2 h-2 rounded-full ${
              pixel.status === 'active' ? 'bg-green-400' :
              pixel.status === 'warning' ? 'bg-yellow-400' : 'bg-red-400'
            } animate-pulse`} />
          </div>
        ))}
      </div>
    </div>
  );
};
