
import { useState } from "react";
import { BarChart3, TrendingUp } from "lucide-react";

export const ChannelPerformance = () => {
  const [activeTab, setActiveTab] = useState("google");

  const googleAdsData = {
    gasto: "€2,485",
    conversiones: "127",
    roas: "4.2x",
    cpc: "€1.95",
    cpa: "€19.57"
  };

  const metaAdsData = {
    gasto: "€1,892",
    conversiones: "89",
    roas: "3.8x",
    cpc: "€1.42",
    cpa: "€21.25"
  };

  const analyticsData = {
    sesiones: "18,492",
    usuarios: "14,238",
    rebote: "42.3%",
    duracion: "3:24"
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Paid Advertising Summary */}
      <div className="bg-[#15121A] border border-[#2C2530] rounded-2xl p-6 hover:shadow-[0_4px_20px_rgba(181,92,255,0.1)] hover:border-[#A664FF] transition-all duration-300">
        <h3 className="text-[#E5D3FF] text-lg font-bold mb-4">Resumen de Publicidad Pagada</h3>
        
        {/* Tabs */}
        <div className="flex space-x-1 mb-6 bg-[#0B0B0D] rounded-lg p-1">
          <button
            onClick={() => setActiveTab("google")}
            className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-all ${
              activeTab === "google"
                ? "bg-gradient-to-r from-[#B55CFF] to-[#9D5BFF] text-white"
                : "text-[#9A8CA8] hover:text-white"
            }`}
          >
            Google Ads
          </button>
          <button
            onClick={() => setActiveTab("meta")}
            className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-all ${
              activeTab === "meta"
                ? "bg-gradient-to-r from-[#B55CFF] to-[#9D5BFF] text-white"
                : "text-[#9A8CA8] hover:text-white"
            }`}
          >
            Meta Ads
          </button>
        </div>

        {/* Content */}
        <div className="space-y-4">
          {activeTab === "google" ? (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-[#9A8CA8] text-sm">Gasto</p>
                <p className="text-white text-xl font-bold">{googleAdsData.gasto}</p>
              </div>
              <div>
                <p className="text-[#9A8CA8] text-sm">Conversiones</p>
                <p className="text-white text-xl font-bold">{googleAdsData.conversiones}</p>
              </div>
              <div>
                <p className="text-[#9A8CA8] text-sm">ROAS</p>
                <p className="text-green-400 text-xl font-bold">{googleAdsData.roas}</p>
              </div>
              <div>
                <p className="text-[#9A8CA8] text-sm">CPC</p>
                <p className="text-white text-xl font-bold">{googleAdsData.cpc}</p>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-[#9A8CA8] text-sm">Gasto</p>
                <p className="text-white text-xl font-bold">{metaAdsData.gasto}</p>
              </div>
              <div>
                <p className="text-[#9A8CA8] text-sm">Conversiones</p>
                <p className="text-white text-xl font-bold">{metaAdsData.conversiones}</p>
              </div>
              <div>
                <p className="text-[#9A8CA8] text-sm">ROAS</p>
                <p className="text-green-400 text-xl font-bold">{metaAdsData.roas}</p>
              </div>
              <div>
                <p className="text-[#9A8CA8] text-sm">CPC</p>
                <p className="text-white text-xl font-bold">{metaAdsData.cpc}</p>
              </div>
            </div>
          )}
        </div>

        {/* Mini Chart Placeholder */}
        <div className="mt-6 h-20 bg-[#0B0B0D] rounded-lg flex items-end justify-center space-x-1 p-2">
          {[...Array(12)].map((_, i) => (
            <div
              key={i}
              className="bg-gradient-to-t from-[#B55CFF] to-[#9D5BFF] rounded-sm"
              style={{ 
                width: '8px',
                height: `${Math.random() * 100}%`,
                opacity: 0.7
              }}
            />
          ))}
        </div>
      </div>

      {/* Google Analytics Summary */}
      <div className="bg-[#15121A] border border-[#2C2530] rounded-2xl p-6 hover:shadow-[0_4px_20px_rgba(181,92,255,0.1)] hover:border-[#A664FF] transition-all duration-300">
        <h3 className="text-[#E5D3FF] text-lg font-bold mb-6">Resumen Google Analytics</h3>
        
        <div className="grid grid-cols-2 gap-4 mb-6">
          <div>
            <p className="text-[#9A8CA8] text-sm">Sesiones</p>
            <p className="text-white text-xl font-bold">{analyticsData.sesiones}</p>
          </div>
          <div>
            <p className="text-[#9A8CA8] text-sm">Usuarios</p>
            <p className="text-white text-xl font-bold">{analyticsData.usuarios}</p>
          </div>
          <div>
            <p className="text-[#9A8CA8] text-sm">Tasa de Rebote</p>
            <p className="text-yellow-400 text-xl font-bold">{analyticsData.rebote}</p>
          </div>
          <div>
            <p className="text-[#9A8CA8] text-sm">Duración Media</p>
            <p className="text-white text-xl font-bold">{analyticsData.duracion}</p>
          </div>
        </div>

        {/* Area Chart Placeholder */}
        <div className="h-20 bg-[#0B0B0D] rounded-lg relative overflow-hidden">
          <svg className="w-full h-full" viewBox="0 0 300 80">
            <defs>
              <linearGradient id="areaGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="#B55CFF" stopOpacity="0.3" />
                <stop offset="100%" stopColor="#9D5BFF" stopOpacity="0.1" />
              </linearGradient>
            </defs>
            <path
              d="M0,60 L30,45 L60,50 L90,30 L120,35 L150,20 L180,25 L210,15 L240,20 L270,10 L300,15 L300,80 L0,80 Z"
              fill="url(#areaGradient)"
            />
            <path
              d="M0,60 L30,45 L60,50 L90,30 L120,35 L150,20 L180,25 L210,15 L240,20 L270,10 L300,15"
              stroke="#B55CFF"
              strokeWidth="2"
              fill="none"
            />
          </svg>
        </div>
      </div>
    </div>
  );
};
