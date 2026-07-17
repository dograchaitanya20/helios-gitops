const { test, after } = require("node:test");
const assert = require("node:assert");
const http = require("node:http");

process.env.PORT = 8081;
process.env.FAIL_INJECT = "false";

// Import after env vars are set so the app picks them up
delete require.cache[require.resolve("../server.js")];
const { server } = require("../server.js");

function get(path) {
  return new Promise((resolve, reject) => {
    http.get(`http://localhost:8081${path}`, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve({ status: res.statusCode, body: data }));
    }).on("error", reject);
  });
}

test("startup delay", async () => {
  await new Promise((r) => setTimeout(r, 500));
});

test("GET /health returns 200", async () => {
  const res = await get("/health");
  assert.strictEqual(res.status, 200);
  const json = JSON.parse(res.body);
  assert.strictEqual(json.status, "ok");
});

test("GET /ready returns 200", async () => {
  const res = await get("/ready");
  assert.strictEqual(res.status, 200);
});

test("GET /metrics exposes Prometheus format", async () => {
  const res = await get("/metrics");
  assert.strictEqual(res.status, 200);
  assert.ok(res.body.includes("http_requests_total"));
});

test("GET /api/tasks returns task list", async () => {
  const res = await get("/api/tasks");
  assert.strictEqual(res.status, 200);
  const json = JSON.parse(res.body);
  assert.ok(Array.isArray(json.tasks));
});

after(() => new Promise((resolve) => server.close(resolve)));
