const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const orders = await prisma.order.findMany({
    orderBy: { platformCreatedAt: 'desc' }
  });
  console.log('Total:', orders.length);
  
  const suspicious = orders.filter(o => {
    // Determine what makes an order "not real" based on context.
    // Probably test orders from postman/scripts where orderNumber is something like 'test-xxx' or 'TEST' or revenue is exactly 0/suspicious or platform is 'api' testing
    return String(o.orderId).toLowerCase().includes('test') || String(o.orderNumber).toLowerCase().includes('test') || (o.revenue === 0) || o.orderNumber === 'undefined';
  });

  console.log('Suspicious count:', suspicious.length);
  console.log(suspicious.slice(0, 15).map(o => ({
    id: o.id,
    orderId: o.orderId,
    orderNumber: o.orderNumber,
    rev: o.revenue,
    platformCreated: o.platformCreatedAt
  })));

  // If user meant the backfilled duplicate dummy orders, maybe just the test orders. Let's see what is printed.
}

main().finally(() => prisma.$disconnect());