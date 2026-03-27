const { PrismaClient } = require('@prisma/client'); const prisma = new PrismaClient(); prisma.order.count().then(console.log).finally(() => prisma.$disconnect());
