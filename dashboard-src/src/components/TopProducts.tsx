
const productsData = [
  {
    name: "Camiseta Premium",
    units: "247",
    revenue: "€4,685",
    ctr: 78
  },
  {
    name: "Sudadera Deluxe",
    units: "189",
    revenue: "€5,670",
    ctr: 65
  },
  {
    name: "Pantalones Sport",
    units: "156",
    revenue: "€3,120",
    ctr: 52
  },
  {
    name: "Zapatillas Pro",
    units: "134",
    revenue: "€6,700",
    ctr: 48
  },
  {
    name: "Gorra Classic",
    units: "98",
    revenue: "€1,960",
    ctr: 35
  }
];

export const TopProducts = () => {
  return (
    <div className="bg-[#15121A] border border-[#2C2530] rounded-2xl p-6 hover:shadow-[0_4px_20px_rgba(181,92,255,0.1)] hover:border-[#A664FF] transition-all duration-300">
      <h3 className="text-[#E5D3FF] text-lg font-bold mb-6">Top 5 productos más vendidos</h3>
      
      <div className="space-y-3">
        {productsData.map((product, index) => (
          <div
            key={index}
            className="flex items-center justify-between p-3 bg-[#0B0B0D] rounded-lg border border-[#2C2530] hover:border-[#A664FF] transition-colors"
          >
            <div>
              <p className="text-white font-medium text-sm">{product.name}</p>
              <p className="text-[#9A8CA8] text-xs">{product.units} unidades</p>
            </div>
            
            <div className="text-right">
              <p className="text-[#E5D3FF] font-bold text-sm">{product.revenue}</p>
              <div className="flex items-center space-x-2 mt-1">
                <div className="w-12 bg-[#2C2530] rounded-full h-1 overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-[#B55CFF] to-[#9D5BFF] transition-all duration-1000"
                    style={{ width: `${product.ctr}%` }}
                  />
                </div>
                <span className="text-[#9A8CA8] text-xs">{product.ctr}%</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
