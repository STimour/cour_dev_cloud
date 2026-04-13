import { Registry, collectDefaultMetrics, Counter, Histogram } from "prom-client";

export const register = new Registry();

// Métriques techniques du process Node.js (CPU, mémoire, event loop, etc.)
collectDefaultMetrics({ register });

// Nombre total de requêtes HTTP
export const httpRequestsTotal = new Counter({
  name: "http_requests_total",
  help: "Total number of HTTP requests",
  labelNames: ["method", "route", "status_code"],
  registers: [register],
});

// Distribution des temps de réponse en millisecondes
export const httpResponseDuration = new Histogram({
  name: "http_response_duration_ms",
  help: "HTTP response duration in milliseconds",
  labelNames: ["method", "route", "status_code"],
  buckets: [5, 10, 25, 50, 100, 250, 500, 1000],
  registers: [register],
});
