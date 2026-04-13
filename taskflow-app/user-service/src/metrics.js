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

const userRegistrationsTotal = new client.Counter({
  name: 'user_registrations_total',
  help: 'Total number of successful user registrations'
})

const userLoginAttemptsTotal = new client.Counter({
  name: 'user_login_attempts_total',
  help: 'Total number of login attempts',
  labelNames: ['success']
})

// Register metrics
register.registerMetric(httpRequestsTotal)
register.registerMetric(httpRequestDurationMs)
register.registerMetric(userRegistrationsTotal)
register.registerMetric(userLoginAttemptsTotal)

module.exports = {
  register,
  httpRequestsTotal,
  httpRequestDurationMs,
  userRegistrationsTotal,
  userLoginAttemptsTotal
}