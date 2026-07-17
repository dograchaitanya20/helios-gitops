/**
 * Auto-rollback controller.
 *
 * Runs as a Kubernetes Job right after ArgoCD reports a new sync.
 * Watches the error-rate metric in Prometheus for WATCH_WINDOW_SECONDS.
 * If the error rate crosses ERROR_THRESHOLD, it calls the ArgoCD API to
 * roll the Application back to its previous synced revision, then posts
 * an alert to Slack.
 *
 * This is intentionally a plain script rather than a framework — the
 * whole point of building it by hand (instead of only relying on
 * Argo Rollouts' built-in analysis step) is to demonstrate you
 * understand the actual mechanism: read metrics -> decide -> call API.
 */
const https = require("https");
const http = require("http");

const PROMETHEUS_URL = process.env.PROMETHEUS_URL || "http://prometheus-server.monitoring.svc.cluster.local";
const ARGOCD_SERVER = process.env.ARGOCD_SERVER; // e.g. https://argocd.helios.example.com
const ARGOCD_TOKEN = process.env.ARGOCD_TOKEN;   // service account token, injected via K8s secret
const APP_NAME = process.env.ARGOCD_APP_NAME || "helios-api";
const ERROR_THRESHOLD = parseFloat(process.env.ERROR_THRESHOLD || "0.05"); // 5%
const WATCH_WINDOW_SECONDS = parseInt(process.env.WATCH_WINDOW_SECONDS || "180", 10);
const POLL_INTERVAL_SECONDS = parseInt(process.env.POLL_INTERVAL_SECONDS || "15", 10);
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;

function httpGetJson(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    lib.get(url, { headers }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`Failed to parse response from ${url}: ${e.message}`));
        }
      });
    }).on("error", reject);
  });
}

function httpPostJson(url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    const payload = JSON.stringify(body);
    const req = lib.request(
      url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload), ...headers },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve({ status: res.statusCode, body: data }));
      }
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

async function getCurrentErrorRate() {
  const query = encodeURIComponent(
    `sum(rate(http_errors_total{app="helios-api"}[1m])) / sum(rate(http_requests_total{app="helios-api"}[1m]))`
  );
  const url = `${PROMETHEUS_URL}/api/v1/query?query=${query}`;
  const json = await httpGetJson(url);
  const result = json?.data?.result?.[0]?.value?.[1];
  return result ? parseFloat(result) : 0;
}

async function rollbackArgoApp() {
  // ArgoCD REST API: get app history, then roll back to the previous
  // successful revision (history length - 2, since -1 is the current one).
  const headers = { Authorization: `Bearer ${ARGOCD_TOKEN}` };
  const app = await httpGetJson(`${ARGOCD_SERVER}/api/v1/applications/${APP_NAME}`, headers);
  const history = app?.status?.history || [];
  if (history.length < 2) {
    throw new Error("No previous revision available to roll back to");
  }
  const previous = history[history.length - 2];
  const res = await httpPostJson(
    `${ARGOCD_SERVER}/api/v1/applications/${APP_NAME}/rollback`,
    { id: previous.id },
    headers
  );
  return res;
}

async function notifySlack(message) {
  if (!SLACK_WEBHOOK_URL) {
    console.log(`[slack disabled] ${message}`);
    return;
  }
  await httpPostJson(SLACK_WEBHOOK_URL, { text: message });
}

async function main() {
  console.log(
    `Watching ${APP_NAME} for ${WATCH_WINDOW_SECONDS}s (threshold=${ERROR_THRESHOLD * 100}%, poll every ${POLL_INTERVAL_SECONDS}s)`
  );
  const deadline = Date.now() + WATCH_WINDOW_SECONDS * 1000;

  while (Date.now() < deadline) {
    let errorRate = 0;
    try {
      errorRate = await getCurrentErrorRate();
    } catch (e) {
      console.error("Failed to query Prometheus:", e.message);
    }

    console.log(`error_rate=${(errorRate * 100).toFixed(2)}%`);

    if (errorRate > ERROR_THRESHOLD) {
      console.error(`Error rate ${(errorRate * 100).toFixed(2)}% exceeded threshold. Rolling back ${APP_NAME}...`);
      try {
        await rollbackArgoApp();
        await notifySlack(
          `🔴 Auto-rollback triggered for *${APP_NAME}* — error rate hit ${(errorRate * 100).toFixed(1)}% (threshold ${ERROR_THRESHOLD * 100}%). Reverted to previous revision.`
        );
        console.log("Rollback triggered successfully.");
      } catch (e) {
        console.error("Rollback call failed:", e.message);
        await notifySlack(`⚠️ Rollback FAILED for *${APP_NAME}*: ${e.message}. Manual intervention required.`);
        process.exit(1);
      }
      return;
    }

    await new Promise((r) => setTimeout(r, POLL_INTERVAL_SECONDS * 1000));
  }

  console.log(`Deploy watch window passed for ${APP_NAME} with no threshold breach. Deploy considered healthy.`);
  await notifySlack(`✅ Deploy of *${APP_NAME}* is healthy after ${WATCH_WINDOW_SECONDS}s watch window.`);
}

main().catch((e) => {
  console.error("Fatal error in rollback controller:", e);
  process.exit(1);
});
