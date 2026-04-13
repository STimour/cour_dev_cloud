const client = require("prom-client");

const register = new client.Registry()
client.collectDefaultMetrics({ register })

const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'route', 'status']
})

const httpRequestDurationMs = new client.Histogram({
  name: 'http_request_duration_ms',
  help: 'HTTP request duration in ms',
  labelNames: ['method', 'route', 'status'],
  buckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2000]
})

const tasksCreatedTotal = new client.Counter({
  name: 'tasks_created_total',
  help: 'Total number of tasks created',
  labelNames: ['priority']
})

const tasksStatusChangesTotal = new client.Counter({
  name: 'tasks_status_changes_total',
  help: 'Total number of task status transitions',
  labelNames: ['from_status', 'to_status']
})

const tasksGauge = new client.Gauge({
  name: 'tasks_gauge',
  help: 'Current number of tasks by status',
  labelNames: ['status']
})

// Register metrics
register.registerMetric(httpRequestsTotal)
register.registerMetric(httpRequestDurationMs)
register.registerMetric(tasksCreatedTotal)
register.registerMetric(tasksStatusChangesTotal)
register.registerMetric(tasksGauge)

module.exports = {
  register,
  httpRequestsTotal,
  httpRequestDurationMs,
  tasksCreatedTotal,
  tasksStatusChangesTotal,
  tasksGauge
}