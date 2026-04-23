const Redis = require('ioredis');

// Ensure an instance is only created once
let redisClient = null;

if (process.env.REDIS_URL) {
  redisClient = new Redis(process.env.REDIS_URL, {
    maxRetriesPerRequest: null,
    lazyConnect: true,
    retryStrategy: (times) => {
      if (times >= 3) return null; // stop retrying after 3 attempts
      return Math.min(times * 1000, 5000);
    },
  });

  let _redisErrorLogged = false;
  redisClient.on('error', (err) => {
    if (!_redisErrorLogged) {
      console.warn('[Redis] Connection unavailable (running locally?):', err.message);
      _redisErrorLogged = true;
    }
  });
} else {
  console.warn('Warning: REDIS_URL not provided. Redis functionalities will be disabled.');
}

module.exports = redisClient;
