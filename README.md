# Helios — GitOps Continuous Deployment Platform

Helios is a production-style CI/CD pipeline that takes application code from a
`git push` to a live, monitored, **self-healing** deployment on Kubernetes —
with no manual intervention.

## The problem this solves

Manual deployments fail silently. A team pushes a change, it looks fine in
testing, but under real traffic it starts erroring — and nobody notices until
a user complains. By the time someone manually rolls it back, the outage has
already cost minutes or hours of downtime.

Helios closes that gap: every deployment is watched automatically after it
goes live, and if the error rate crosses a safety threshold, the system
reverts itself back to the last known-good version — before a human has to
step in.

## How it works, end to end

```
Developer pushes code
        │
        ▼
GitHub Actions:  run tests → build Docker image → Trivy security scan
        │                                            (blocks on CRITICAL/HIGH CVEs)
        ▼
Push image to GitHub Container Registry
        │
        ▼
CI updates the image tag in the Kubernetes manifests (Git is the source of truth —
this hand-off is what makes it "GitOps", not a script that deploys directly)
        │
        ▼
ArgoCD detects the Git change and syncs the cluster to match
        │
        ▼
Kubernetes rolls out the new version (zero-downtime rolling update)
        │
        ▼
Rollback controller watches Prometheus error-rate metrics for a fixed window
        │
   ┌────┴────┐
   ▼         ▼
 Healthy   Error rate > threshold
   │         │
 done     ArgoCD API rollback → previous version restored → Slack alert sent
```

## Why each tool is there (not just "used because it's popular")

| Tool | Why it's actually needed here |
|---|---|
| **Docker** | Packages the app identically for every environment; multi-stage build keeps the final image small, runs as non-root for security |
| **GitHub Actions** | Runs tests and builds on every push — nothing untested reaches an image |
| **Trivy** | Scans the built image for known vulnerabilities before it's ever allowed into the registry — a real security gate, not just a badge |
| **ArgoCD (GitOps)** | The cluster state is defined by Git, not by whoever last ran `kubectl`. If someone manually edits the cluster, ArgoCD's `selfHeal` reverts it back to match Git — this is the actual definition of GitOps |
| **Kubernetes + Kustomize** | Runs the app with self-healing pods, rolling updates, and environment-specific config (staging vs production) without duplicating YAML |
| **Horizontal Pod Autoscaler** | Scales pods up under load and back down when idle, based on CPU/memory |
| **Prometheus + Grafana** | Turns raw application behavior into queryable metrics and dashboards — this is what the rollback decision is actually based on, not a guess |
| **Custom rollback controller** | Written by hand (rather than only relying on a framework default) to demonstrate the actual mechanism: poll a metric, evaluate a threshold, call an API, notify a human |
| **Terraform** | Provisions the underlying server/cluster as code, so the whole environment is reproducible from a single command instead of manual clicking in a cloud console |

## Repository layout

```
helios-gitops/
├── app/                      # the sample service the pipeline deploys
│   ├── server.js             # Express API with /health, /ready, /metrics
│   └── test/                 # automated tests run by CI
├── .github/workflows/        # the CI pipeline definition
├── k8s/
│   ├── base/                 # Deployment, Service, HPA, Ingress, Secret template
│   └── overlays/              # staging & production environment configs
├── argocd/                   # the GitOps Application + optional canary Rollout
├── monitoring/                # Prometheus scrape config + alert rules
├── rollback-controller/      # the auto-rollback logic
├── terraform/                # infrastructure-as-code for the cluster
├── dashboard/                # interactive pipeline visualization (index.html)
└── scripts/setup.sh          # one-command bootstrap for a fresh cluster
```

## Running it

**Just want to see how it behaves?** Open `dashboard/index.html` — it's a
self-contained interactive demo of the whole pipeline, including a
"simulate bad deploy" button that shows the auto-rollback happening live.

**Want to deploy it for real?** You'll need a Kubernetes cluster (the
`terraform/` folder provisions a low-cost one via k3s on a single VM) and a
GitHub repo with Actions enabled. Then:

```bash
# 1. Provision the cluster
cd terraform && terraform init && terraform apply

# 2. Point kubectl at it, then bootstrap ArgoCD, Prometheus, ingress, etc.
bash scripts/setup.sh

# 3. Push a change to app/ on main — the pipeline takes it from there
```

Full command-by-command notes are in `docs/ARCHITECTURE.md`.

## Honest status of this build

This repository contains complete, working code for every stage of the
pipeline — the app's automated tests pass (5/5), every Kubernetes/ArgoCD/CI
manifest is syntactically validated, and the Dockerfile follows security
best practice (non-root, multi-stage, health-checked). What it does **not**
include is a live, running cluster — that requires your own cloud account
(or a free k3s VM) and about 20 minutes following `scripts/setup.sh`. The
`docs/ARCHITECTURE.md` walks through exactly what "live" looks like at each
stage, including what to screenshot for a demo/report.
