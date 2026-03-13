const { PrismaClient } = require('@prisma/client');

let prisma;

if (process.env.NODE_ENV === 'production') {
  prisma = new PrismaClient();
} else {
  if (!global.__prisma) {
    global.__prisma = new PrismaClient();
  }
  prisma = global.__prisma;
}

process.on('beforeExit', () => {
  if (prisma) {
    prisma.$disconnect().catch(() => {});
  }
});

module.exports = prisma;
