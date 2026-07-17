#!/usr/bin/env bash
# Brings up the full GitOps stack on an existing k3s/Minikube cluster.
# Run from the repo root: bash scripts/setup.sh
set -euo pipefail

echo "==> 1. Installing ArgoCD"
kubectl create namespace argocd --dry-run=client -o yaml | kubectl apply -f -
kubectl apply -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml

echo "==> 2. Installing kube-prometheus-stack (Prometheus + Grafana + Alertmanager)"
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo update
kubectl create namespace monitoring --dry-run=client -o yaml | kubectl apply -f -
helm upgrade --install monitoring prometheus-community/kube-prometheus-stack \
  -n monitoring -f monitoring/prometheus-values.yaml

echo "==> 3. Installing NGINX ingress controller"
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm upgrade --install ingress-nginx ingress-nginx/ingress-nginx -n ingress-nginx --create-namespace

echo "==> 4. Installing cert-manager (TLS)"
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/latest/download/cert-manager.yaml

echo "==> 5. Applying alert rules"
kubectl apply -f monitoring/alerts.yaml

echo "==> 6. Registering the ArgoCD Application (this is what makes it GitOps —"
echo "        from here, ArgoCD watches the repo and reconciles the cluster itself)"
kubectl apply -f argocd/application.yaml

echo "==> 7. Fetching ArgoCD initial admin password"
kubectl -n argocd get secret argocd-initial-admin-secret \
  -o jsonpath="{.data.password}" | base64 -d
echo ""

echo "Done. Port-forward to reach the UIs:"
echo "  kubectl -n argocd port-forward svc/argocd-server 8080:443"
echo "  kubectl -n monitoring port-forward svc/monitoring-grafana 3000:80"
