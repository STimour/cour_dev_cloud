require("./tracing");
const { register } = require("./metrics");
const express = require("express");
const pino = require("pino");
const pinoHttp = require("pino-http");
const routes = require("./routes");

const logger = pino({ level: process.env.LOG_LEVEL || "info" });
const app = express();

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
  res.json({ status: "ok", service: "task-service" }),
);

app.get("/metrics", async (req, res) => {
  res.set("Content-Type", register.contentType);
  res.end(await register.metrics());
});

app.use("/tasks", routes);

const PORT = process.env.PORT || 3002;
app.listen(PORT, () => {
  logger.info({ port: PORT }, "task-service started");
});
