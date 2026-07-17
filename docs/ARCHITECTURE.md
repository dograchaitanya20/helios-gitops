# Helios — Architecture & Setup Walkthrough

## 1. Component map

```
                    ┌─────────────┐
                    │   GitHub    │
                    │  (source)   │
                    └──────┬──────┘
                           │ push
                           ▼
                 ┌───────────────────┐
                 │  GitHub Actions    │
                 │  test → build →    │
                 │  Trivy scan → push │
                 └─────────┬──────────┘
                           │ image
                           ▼
                 ┌───────────────────┐
                 │  GHCR (registry)   │
                 └─────────┬──────────┘
                           │
                 CI commits new image tag
                    to k8s/overlays/production
                           │
                           ▼
                 ┌───────────────────┐
                 │      ArgoCD        │◄── watches Git, NOT the registry
                 │  (auto-sync +      │
                 │   self-heal)       │
                 └─────────┬──────────┘
                           │ applies manifests
                           ▼
                 ┌───────────────────┐
                 │    Kubernetes       │
                 │  (k3s cluster)      │
                 │  - Deployment       │
                 │  - HPA              │
                 │  - Ingress          │
                 └─────────┬──────────┘
                           │ scrapes /metrics
                           ▼
                 ┌───────────────────┐
                 │  Prometheus         │──► Grafana dashboards
                 └─────────┬──────────┘
                           │ queried by
                           ▼
                 ┌───────────────────┐
                 │ Rollback Controller │──► ArgoCD API (rollback call)
                 │  (PostSync Job)      │──► Slack webhook (alert)
                 └───────────────────┘
```

## 2. Why this hand-off matters (the actual "GitOps" part)

CI never talks to the Kubernetes cluster directly — it only ever commits a
changed file to Git. ArgoCD, running inside the cluster, is the only thing
with deploy credentials, and it pulls its desired state from Git rather than
having anything pushed to it. This has two concrete benefits that come up in
interviews constantly:

1. **Every deployment is a Git commit** — you get a full audit trail for
   free, and `git revert` is a valid rollback mechanism.
2. **`selfHeal: true` means manual `kubectl edit` gets reverted automatically**
   — the cluster can never silently drift from what's in Git.

## 3. Bringing it up on a real cluster

```bash
# --- Option A: cheapest path, a single k3s VM via Terraform ---
cd terraform
terraform init
terraform apply -var="do_token=YOUR_DO_TOKEN" -var="ssh_key_fingerprint=YOUR_KEY_FP"
# copy the kubeconfig off the VM: scp root@<ip>:/etc/rancher/k3s/k3s.yaml ~/.kube/config
# then edit the server URL in that file from 127.0.0.1 to the VM's public IP

# --- Option B: free local path, Minikube ---
minikube start --cpus=4 --memory=6g

# --- Then, either way ---
bash scripts/setup.sh          # installs ArgoCD, Prometheus/Grafana, ingress-nginx, cert-manager
kubectl apply -f argocd/application.yaml

# Reach the UIs:
kubectl -n argocd port-forward svc/argocd-server 8080:443       # https://localhost:8080
kubectl -n monitoring port-forward svc/monitoring-grafana 3000:80
```

## 4. Building and pushing the app image yourself

```bash
cd app
docker build -t ghcr.io/<your-username>/helios-api:local .
docker run -p 8080:8080 ghcr.io/<your-username>/helios-api:local
curl localhost:8080/health
```

Push this to GHCR once and update the `OWNER/REPO` placeholders in:
`k8s/base/deployment.yaml`, `k8s/overlays/*/kustomization.yaml`,
`argocd/application.yaml`, `rollback-controller/job.yaml`.

## 5. Demoing the auto-rollback for real

1. Set `FAIL_INJECT=true` in a new commit to `app/`.
2. Push to `main` — watch the Actions tab build, scan, and hand off to ArgoCD.
3. Watch `kubectl -n helios get pods -w` — new pods come up.
4. The rollback Job (PostSync hook) starts polling Prometheus. Within the
   watch window it will detect the elevated error rate and call the ArgoCD
   rollback API — watch `kubectl -n argocd get application helios-api -w`.
5. Check the Slack channel (or `kubectl logs job/rollback-watch -n helios`)
   for the rollback notification.

## 6. What to screenshot for your report/demo

- GitHub Actions run: green checkmarks on test → build → scan → push
- Trivy scan output showing 0 CRITICAL/HIGH vulnerabilities
- ArgoCD UI: application synced, health "Healthy"
- Grafana dashboard: request rate / error rate / latency panels
- The rollback event: Grafana showing the error-rate spike, then the
  Slack/log message confirming rollback, then the metric returning to normal
- `dashboard/index.html` running the "simulate bad deploy" flow

## 7. Likely interview questions and where the answer lives in this repo

| Question | Where to point |
|---|---|
| "Why GitOps over just running `kubectl apply` in CI?" | `argocd/application.yaml` — `selfHeal`, audit trail via Git history |
| "How does the rollback actually work?" | `rollback-controller/rollback.js` — polls Prometheus, calls ArgoCD's rollback endpoint |
| "How do you store secrets?" | `k8s/base/secret.example.yaml` — Sealed Secrets, never plaintext in Git |
| "Rolling update vs canary — which do you use?" | `k8s/base/deployment.yaml` (rolling) vs `argocd/rollout.yaml` (canary via Argo Rollouts, the upgrade path) |
| "What happens if the image has vulnerabilities?" | `.github/workflows/ci-cd.yaml` — Trivy step has `exit-code: "1"`, pipeline stops |
| "How do you avoid downtime during deploys?" | `maxUnavailable: 0` in the Deployment strategy + readiness probes gating traffic |
