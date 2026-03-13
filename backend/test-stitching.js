require('dotenv').config({ path: __dirname + '/.env' });
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
  try {
    const orders = await prisma.order.findMany({
      where: {
        accountId: 'shogun.mx',
      },
      take: 10,
      orderBy: { createdAt: 'desc' }
    });
    console.log('Recent Orders in DB:', orders.map(o => ({
      id: o.id,
      platformOrderId: o.platformOrderId,
      emailHash: o.emailHash,
      phoneHash: o.phoneHash,
      sessionId: o.sessionId,
      checkoutToken: o.checkoutToken,
      customerName: o.attributionSnapshot && o.attributionSnapshot.customer_name ? o.attributionSnapshot.customer_name : null,
      session_id_snapshot: o.attributionSnapshot ? o.attributionSnapshot.session_id : null
    })));

    const sessions = await prisma.session.findMany({
      where: {
        accountId: 'shogun.mx'
      },
      take: 5,
      orderBy: { createdAt: 'desc' }
    });
    console.log('Recent Sessions in DB:', sessions.map(s => ({
      id: s.id,
      sessionId: s.sessionId,
      userId: s.userId
    })));
  } catch (err) {
    console.error(err);
  } finally {
    await prisma.$disconnect();
  }
}

check();