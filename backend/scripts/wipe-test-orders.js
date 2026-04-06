require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function cleanTestOrders() {
  console.log('Iniciando limpieza de pedidos de prueba (tests/dummies)...');
  
  try {
    const result = await prisma.order.deleteMany({
      where: {
        OR: [
          { orderId: { startsWith: 'test-', mode: 'insensitive' } },
          { orderId: { startsWith: 'test_', mode: 'insensitive' } },
          { orderId: { contains: 'postman', mode: 'insensitive' } },
          { orderNumber: { contains: 'test', mode: 'insensitive' } },
          // A veces los webhooks de prueba mandan orderId muy extraños o 0s
          { revenue: 0 },
          { accountId: { contains: 'test', mode: 'insensitive' } }
        ]
      }
    });
    
    console.log(`\n¡Limpieza completada!`);
    console.log(`✅ Se eliminaron permanentemente: ${result.count} pedidos falsos.`);
  } catch (err) {
    console.error('Error limpiando los pedidos:', err);
  } finally {
    await prisma.$disconnect();
  }
}

cleanTestOrders();