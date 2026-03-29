require('dotenv').config();
const mongoose = require('mongoose');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function testRoute() {
    const account_id = 'shogun.mx';
    const limit = 6;
    const since = new Date(Date.now() - 30 * 60 * 1000);
    
    const recentEvents = await prisma.event.findMany({
      where: {
        accountId: account_id,
        createdAt: { gte: since },
      },
      select: {
        eventName: true,
        createdAt: true,
        sessionId: true,
        userKey: true,
        rawPayload: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });

    console.log('Total events fetched:', recentEvents.length);
    let size = JSON.stringify(recentEvents).length;
    console.log('JSON size of all recentEvents:', size);
    
    // ... we can just check if rawPayload has huge stuff
    for (const e of recentEvents) {
        if (JSON.stringify(e.rawPayload).length > 50000) {
            console.log('Huge payload found in event:', e.eventName, 'size:', JSON.stringify(e.rawPayload).length);
        }
    }
}
testRoute().finally(() => process.exit(0));
