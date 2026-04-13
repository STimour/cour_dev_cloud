const { NodeSDK } = require("@opentelemetry/sdk-node");
const { Resource } = require("@opentelemetry/resources");
const {
	OTLPTraceExporter,
} = require("@opentelemetry/exporter-trace-otlp-http");
const {
	OTLPMetricExporter,
} = require("@opentelemetry/exporter-metrics-otlp-http");
const {
	PeriodicExportingMetricReader,
} = require("@opentelemetry/sdk-metrics");
const {
	getNodeAutoInstrumentations,
} = require("@opentelemetry/auto-instrumentations-node");

const serviceName = process.env.OTEL_SERVICE_NAME || "user-service";
const resource = new Resource({
	"service.name": serviceName,
	"service.version": process.env.npm_package_version || "1.0.0",
	"deployment.environment": process.env.NODE_ENV || "development",
});

const collectorHttpEndpoint =
	process.env.OTEL_EXPORTER_OTLP_ENDPOINT || "http://otel-collector:4318";

const sdk = new NodeSDK({
	resource,
	traceExporter: new OTLPTraceExporter({
		url: `${collectorHttpEndpoint}/v1/traces`,
	}),
	metricReader: new PeriodicExportingMetricReader({
		exporter: new OTLPMetricExporter({
			url: `${collectorHttpEndpoint}/v1/metrics`,
		}),
		exportIntervalMillis: Number(process.env.OTEL_EXPORT_INTERVAL_MS) || 10000,
	}),
	instrumentations: [
		getNodeAutoInstrumentations({
			"@opentelemetry/instrumentation-http": { enabled: true },
			"@opentelemetry/instrumentation-express": { enabled: true },
			"@opentelemetry/instrumentation-pg": { enabled: true },
		}),
	],
});

sdk.start();

const shutdown = async () => {
	try {
		await sdk.shutdown();
	} catch (err) {
		console.error("OpenTelemetry shutdown failed", err);
	}
};

process.on("SIGTERM", () => {
	shutdown().finally(() => process.exit(0));
});

process.on("SIGINT", () => {
	shutdown().finally(() => process.exit(0));
});