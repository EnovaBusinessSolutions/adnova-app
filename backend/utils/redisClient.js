const Redis = require('ioredis');

// Ensure an instance is only created once
let redisClient = null;

if (process.env.REDIS_URL) {
  redisClient = new Redis(process.env.REDIS_URL, {
    maxRetriesPerRequest: 3,
    lazyConnect: true,
  });

  redisClient.on('error', (err) => {
    console.error('Redis connection error:', err);
  });
} else {
  console.warn('Warning: REDIS_URL not provided. Redis functionalities will be disabled.');
}

module.exports = redisClient;
