
import { ShoppingCart, CreditCard, CheckCircle } from "lucide-react";

const funnelData = [
  {
    step: "Añadir al Carrito",
    count: "2,847",
    conversion: "100%",
    progress: 100,
    icon: ShoppingCart,
    color: "from-[#B55CFF] to-[#9D5BFF]"
  },
  {
    step: "Iniciar Pago",
    count: "1,456",
    conversion: "51.2%",
    progress: 51,
    icon: CreditCard,
    color: "from-[#9D5BFF] to-[#8B4BFF]"
  },
  {
    step: "Compra",
    count: "1,245",
    conversion: "85.5%",
    progress: 44,
    icon: CheckCircle,
    color: "from-[#8B4BFF] to-[#7A3FFF]"
  }
];

export const ConversionFunnel = () => {
  return (
    <div className="bg-[#15121A] border border-[#2C2530] rounded-2xl p-6 hover:shadow-[0_4px_20px_rgba(181,92,255,0.1)] hover:border-[#A664FF] transition-all duration-300">
      <h3 className="text-[#E5D3FF] text-lg font-bold mb-6">Embudo de Conversión</h3>
      
      <div className="space-y-6">
        {funnelData.map((step, index) => (
          <div key={index} className="relative">
            {/* Step Content */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center space-x-3">
                <div className={`p-2 bg-gradient-to-r ${step.color} rounded-lg`}>
                  <step.icon className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h4 className="text-white font-medium">{step.step}</h4>
                  <p className="text-[#9A8CA8] text-sm">Conversión: {step.conversion}</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-[#E5D3FF] text-xl font-bold">{step.count}</p>
              </div>
            </div>
            
            {/* Progress Bar */}
            <div className="w-full bg-[#0B0B0D] rounded-full h-2 overflow-hidden">
              <div
                className={`h-full bg-gradient-to-r ${step.color} transition-all duration-1000 ease-out`}
                style={{ width: `${step.progress}%` }}
              />
            </div>
            
            {/* Animated Dots */}
            <div className="absolute right-0 top-1/2 transform -translate-y-1/2">
              <div className="flex space-x-1">
                {[...Array(3)].map((_, i) => (
                  <div
                    key={i}
                    className="w-1 h-1 bg-[#EB2CFF] rounded-full animate-pulse"
                    style={{ animationDelay: `${i * 200}ms` }}
                  />
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
