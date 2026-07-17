/**
 * Helios API — the sample microservice deployed through the Helios
 * GitOps pipeline (a small task-tracking API, enough surface area to
 * demonstrate real CI/CD, health checks, and metrics).
 *
 * What matters for the pipeline is that this service exposes:
 *   GET /health   -> liveness  (is the process up)
 *   GET /ready    -> readiness (can it serve traffic — checks DB)
 *   GET /metrics  -> Prometheus exposition format
 *
 * FAIL_INJECT=true simulates a bad deploy (elevated error rate) so the
 * rollback controller has something real to detect and react to.
 */
const express = require("express");
const client = require("prom-client");

const app = express();
const PORT = process.env.PORT || 8080;
const VERSION = process.env.APP_VERSION || "dev";
const FAIL_INJECT = process.env.FAIL_INJECT === "true";

// --- Prometheus metrics setup ---
const register = new client.Registry();
client.collectDefaultMetrics({ register });

const httpRequestDuration = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "Duration of HTTP requests in seconds",
  labelNames: ["method", "route", "status_code"],
  buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5],
});
const httpRequestsTotal = new client.Counter({
  name: "http_requests_total",
  help: "Total HTTP requests",
  labelNames: ["method", "route", "status_code"],
});
const httpErrorsTotal = new client.Counter({
  name: "http_errors_total",
  help: "Total HTTP 5xx responses",
  labelNames: ["method", "route"],
});
register.registerMetric(httpRequestDuration);
register.registerMetric(httpRequestsTotal);
register.registerMetric(httpErrorsTotal);

app.use((req, res, next) => {
  const end = httpRequestDuration.startTimer();
  res.on("finish", () => {
    const labels = { method: req.method, route: req.path, status_code: res.statusCode };
    httpRequestsTotal.inc(labels);
    if (res.statusCode >= 500) httpErrorsTotal.inc({ method: req.method, route: req.path });
    end(labels);
  });
  next();
});

app.use(express.json());

// --- Sample business routes (this is the app's actual demo functionality) ---
app.get("/api/tasks", (req, res) => {
  if (FAIL_INJECT && Math.random() < 0.4) {
    return res.status(500).json({ error: "internal_error", detail: "simulated failure for rollback demo" });
  }
  res.json({
    version: VERSION,
    tasks: [
      { id: "t_1001", title: "Provision staging namespace", status: "done" },
      { id: "t_1002", title: "Rotate ArgoCD service account token", status: "in_progress" },
    ],
  });
});

// --- Health/readiness for Kubernetes probes ---
app.get("/health", (req, res) => res.status(200).json({ status: "ok", version: VERSION }));

app.get("/ready", (req, res) => {
  // In the real app this would check MongoDB connectivity, etc.
  const dbOk = true;
  if (!dbOk) return res.status(503).json({ status: "not_ready" });
  res.status(200).json({ status: "ready", version: VERSION });
});

// --- Metrics scrape endpoint for Prometheus ---
app.get("/metrics", async (req, res) => {
  res.set("Content-Type", register.contentType);
  res.end(await register.metrics());
});

const server = app.listen(PORT, () => {
  console.log(`helios-api version=${VERSION} fail_inject=${FAIL_INJECT} listening on ${PORT}`);
});

module.exports = { app, server };
