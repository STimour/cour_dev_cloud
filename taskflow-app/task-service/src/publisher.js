const { createClient } = require('redis');

const client = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });

client.on('error', (err) => console.error('Redis error', err));

let connected = false;

async function connect() {
  if (!connected) {
    await client.connect();
    connected = true;
  }
}

async function publish(channel, message) {
  await connect();
  await client.publish(channel, JSON.stringify(message));
}

module.exports = { publish };
