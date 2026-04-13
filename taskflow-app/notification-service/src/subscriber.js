const { createClient } = require('redis');
const pino = require('pino');

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

// In-memory notification storage (simplified — no DB for this service)
const notifications = [];

async function startSubscriber() {
  const subscriber = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
  subscriber.on('error', (err) => logger.error({ err }, 'Redis subscriber error'));

  await subscriber.connect();
  logger.info('Redis subscriber connected');

  // Listen for events published by task-service
  await subscriber.subscribe('task.created', (message) => {
    const data = JSON.parse(message);
    logger.info({ event: 'task.created', data }, 'New task created');

    if (data.assigneeId) {
      const notif = {
        id: Date.now().toString(),
        userId: data.assigneeId,
        message: `A new task has been assigned to you: "${data.title}"`,
        type: 'task_assigned',
        read: false,
        createdAt: new Date().toISOString(),
      };
      notifications.push(notif);
      logger.info({ notif }, 'Notification stored');
    }
  });

  await subscriber.subscribe('task.status_changed', (message) => {
    const data = JSON.parse(message);
    logger.info({ event: 'task.status_changed', data }, 'Task status changed');

    if (data.assigneeId) {
      const notif = {
        id: Date.now().toString(),
        userId: data.assigneeId,
        message: `Status updated: ${data.oldStatus} → ${data.newStatus}`,
        type: 'status_changed',
        read: false,
        createdAt: new Date().toISOString(),
      };
      notifications.push(notif);
    }
  });

  logger.info('Subscribed to task.created, task.status_changed');
}

function getNotifications(userId) {
  if (userId) return notifications.filter((n) => n.userId === userId);
  return notifications;
}

function markAsRead(notifId) {
  const notif = notifications.find((n) => n.id === notifId);
  if (notif) notif.read = true;
  return notif;
}

module.exports = { startSubscriber, getNotifications, markAsRead };
