require("./tracing");
const { register, httpRequestsTotal, httpRequestDurationMs } = require("./metrics");
const express = require("express");
const pino = require("pino");
const pinoHttp = require("pino-http");

const routes = require("./routes");

const ERROR_CODE = 500;

const logger = pino({ level: process.env.LOG_LEVEL || "info" });
const app = express();

const resolveRouteLabel = (req) => {
  if (req.route?.path) return `${req.baseUrl || ""}${req.route.path}`;
  return req.baseUrl || req.path || "unknown";
};

app.use((req, res, next) => {
  const end = httpRequestDurationMs.startTimer();
  res.on("finish", () => {
    const labels = {
      method: req.method,
      route: resolveRouteLabel(req),
      status: String(res.statusCode),
    };
    httpRequestsTotal.inc(labels);
    end(labels);
  });
  next();
});

app.use(express.json());
app.use(
  pinoHttp({
    logger,
    customLogLevel: (req, res) => {
      if (res.statusCode >= ERROR_CODE) return "error";
      return "info";
    },
    customSuccessMessage: (req, res) => {
      if (res.statusCode >= 400) return req.errorMessage ?? `request failed`;
      return `${req.method} completed`;
    },
    customErrorMessage: (req, res, err) => `request failed : ${err.message}`,
  }),
);

app.get("/health", (req, res) =>
  res.json({ status: "ok", service: "user-service" }),
);

app.get("/metrics", async (req, res) => {
  res.set("Content-Type", register.contentType);
  res.end(await register.metrics());
});

app.use("/users", routes);

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  logger.info({ port: PORT }, "user-service started");
});
