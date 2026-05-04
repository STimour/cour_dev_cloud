**Important : le fichier init.sql ne s’exécute que lors de la première initialisation du volume Postgres.**
Modification de init.sql après coup,  ne sera pas rejoué automatiquement.

- Pour repartir proprement :
```bash
kind delete cluster --name taskflow
kind create cluster --name taskflow --config k8s/kind-config.yaml
kubectl create namespace staging
```

## Checklist TP3

### 0. Outils installés

Installés dans `~/.local/bin` :

```bash
kubectl version --client
# Client Version: v1.36.0

kind version
# kind v0.31.0
```

### 1. Vérifier les images Docker Hub

Les manifests utilisent actuellement le préfixe :

```text
dorianyloj/taskflow-<service>:v1.0.0
```

Le compte Docker Hub utilisé pour le TP est `dorianyloj`.

```bash
k8s/base/api-gateway/deployment.yaml
k8s/base/user-service/deployment.yaml
k8s/base/task-service/deployment.yaml
k8s/base/notification-service/deployment.yaml
k8s/base/frontend/deployment.yaml
```

Les images `v1.0.0` ont ensuite été poussées sur Docker Hub. Pour les reconstruire localement :

```bash
docker build -t dorianyloj/taskflow-api-gateway:v1.0.0 ./api-gateway
docker build -t dorianyloj/taskflow-user-service:v1.0.0 ./user-service
docker build -t dorianyloj/taskflow-task-service:v1.0.0 ./task-service
docker build -t dorianyloj/taskflow-notification-service:v1.0.0 ./notification-service
docker build -t dorianyloj/taskflow-frontend:v1.0.0 ./frontend

kind load docker-image \
  dorianyloj/taskflow-api-gateway:v1.0.0 \
  dorianyloj/taskflow-user-service:v1.0.0 \
  dorianyloj/taskflow-task-service:v1.0.0 \
  dorianyloj/taskflow-notification-service:v1.0.0 \
  dorianyloj/taskflow-frontend:v1.0.0 \
  --name taskflow
```

### 2. Créer le cluster et appliquer la stack

```bash
kind delete cluster --name taskflow
kind create cluster --name taskflow --config k8s/kind-config.yaml
kubectl create namespace staging
kubectl apply -f k8s/base/ --recursive
kubectl get pods -n staging -o wide
```

Tous les pods applicatifs doivent finir en `1/1 Running`.

### 3. Installer l'Ingress nginx kind

```bash
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/main/deploy/static/provider/kind/deploy.yaml
kubectl wait --namespace ingress-nginx --for=condition=ready pod --selector=app.kubernetes.io/component=controller --timeout=90s
kubectl get pods -n ingress-nginx -o wide
```

Si le controller n'est pas sur `taskflow-control-plane` :

```bash
kubectl patch deployment ingress-nginx-controller -n ingress-nginx --type='json' -p='[{"op":"add","path":"/spec/template/spec/nodeSelector/ingress-ready","value":"true"}]'
kubectl rollout status deployment/ingress-nginx-controller -n ingress-nginx
```

Puis tester :

```bash
curl http://localhost/api/health
```

### 4. Debug rapide

```bash
kubectl get all -n staging
kubectl describe pod -n staging -l app=task-service
kubectl logs -n staging deployment/api-gateway
kubectl logs -n staging deployment/user-service
kubectl logs -n staging deployment/task-service
kubectl logs -n staging deployment/notification-service
```

Accès Postgres depuis la machine :

```bash
kubectl port-forward -n staging svc/postgres 5433:5432
psql postgresql://taskflow:taskflow@localhost:5433/taskflow
```
