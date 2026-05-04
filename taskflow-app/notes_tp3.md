**Important : le fichier init.sql ne s’exécute que lors de la première initialisation du volume Postgres.**
Modification de init.sql après coup,  ne sera pas rejoué automatiquement.

- Pour repartir proprement :
```bash
kind delete cluster --name taskflow
kind create cluster --name taskflow --config k8s/kind-config.yaml
kubectl create namespace staging
```