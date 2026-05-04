# TP — Kubernetes 

## Objectif

Déployer l'intégralité de la stack TaskFlow sur un cluster kind local en écrivant les manifests YAML manuellement. L'objectif est de comprendre chaque ressource Kubernetes par la pratique — et de ressentir la répétition qui motive Helm.

---

## Partie 0 

- Docker installé et en cours d'exécution
- `kind` installé — https://kind.sigs.k8s.io/docs/user/quick-start/#installation
- `kubectl` installé — https://kubernetes.io/docs/tasks/tools/
- Les images TaskFlow publiées sur Docker Hub (votre CI doit avoir tourné)

---

## Partie 1 - Monter la stack avec K8S

### Étape 1 — Créer le cluster kind multi-nœuds

Compléter le fichier `k8s/kind-config.yaml` avant de créer le cluster :

```bash
kind create cluster --name taskflow --config k8s/kind-config.yaml
```

⚠️ Cette commande peut mettre un certain temps avant d'être complétée.

Vérifiez que le cluster est prêt :

```bash
kubectl get nodes
```

Vous devez voir 3 nœuds en état `Ready`.

Créez le namespace staging :

```bash
kubectl create namespace staging
```

---

### Étape 2 — Ouvrir les terminaux d'observation

Avant d'écrire quoi que ce soit, ouvrez 1 terminal et gardez-le visible.

**Terminal A — Watch Pods :**
```bash
watch kubectl get pods -n staging -o wide
```

Aucune donnée pour l'instant. Laissez-le ouvert pendant tout le TP afin de voir l'évolution de votre infrastructure.

---

### Étape 3  — Déployer le user-service

Compléter les fichiers :
- `k8s/base/user-service/configmap.yaml`
    * Compléter la configuration 
    * Ajouter les variables d'environnement
- `k8s/base/user-service/deployment.yaml`
    * Compléter la configuration 
    * Ajouter les spécifications liées à votre image taskflow-user-service (ports, probes, etc.)
- `k8s/base/user-service/service.yaml`
    * Compléter la configuration
    * Ajouter les ports du service

Puis appliquez la configuration :

```bash
kubectl apply -f k8s/base/user-service/
```

> Observez le Terminal A. Les pods passent-ils en 1/1 Running ?
> 
> Si vous voyez `ImagePullBackOff` ou `ErrImagePull`, diagnostiquez avant de continuer, lisez attentivement la section Events. 
> 1. Que vous dit Kubernetes ? 
> 2. Qu'est-ce qui manque dans votre configuration actuelle par rapport à ce que vous avez déployé jusqu'ici ?
> 
> Corrigez le problème, et vérifiez que les pods passent bien en Running avant de passer à l'étape suivante.

---

### Étape 4 — Déployer PostgreSQL (StatefulSet)

Compléter les fichiers suivants : 
 - `k8s/base/postgres/secret.yaml`
 - `k8s/base/postgres/service.yaml`
 - `k8s/base/postgres/statefulset.yaml`

Appliquez :

```bash
kubectl apply -f k8s/base/postgres/
```

> Jetez un œil au **Terminal A** 
> Combien de pods sont en `Running` ? 
> Sur quels nœuds sont-ils schedulés ?

---

> ### Deployment vs StatefulSet
>
> Vous venez de déployer PostgreSQL avec un **StatefulSet**. Vous utiliserez des **Deployments** pour les services applicatifs à partir de l'étape suivante.
>
> Répondez dans votre `REPORT.md` :
>
> 1. Quelle propriété du StatefulSet garantit que chaque Pod conserve toujours le même volume de stockage, même après un redémarrage ou un rescheduling sur un autre nœud ?
> 2. Pourquoi un Deployment serait-il inadapté pour PostgreSQL, même si techniquement on peut lui attacher un volume ?
> 3. Parmi les services restants de la stack TaskFlow (Redis, notification-service, `api-gateway`, frontend), lequel mériterait potentiellement un StatefulSet plutôt qu'un Deployment en production ? Justifiez votre choix.

---

### Étape 5 — Déployer le `task-service` et le `notification-service`

Le `notification-service` s'abonne aux événements Redis publiés par le `task-service`.

Créez les 3 fichiers dans `k8s/base/<nom-du-service>/` en vous basant sur le pattern des étapes précédentes :

- **ConfigMap** (Veillez à inclure toutes les variables d'environnement utiles à chaque service)
- **Deployment**
- **Service** 

> Lisez le fichier `notification-service/src/subscriber.js`.
>
> 1. Comment ce service consomme-t-il les événements Redis ? 
> 2. Qu'est-ce que cela implique sur le nombre de replicas à choisir ? Pour quel(s) service(s) ?
> 3. Justifiez votre choix dans votre `REPORT.md`.

Appliquez et vérifiez que les Pods passent en `1/1 Running`.

---

### Étape 6 — Déployer Redis (Deployment)

Redis est utilisé comme bus de messages entre le `task-service` et le `notification-service`. Contrairement à PostgreSQL, une perte des données Redis au redémarrage est acceptable en environnement de développement.

Compléter les fichiers suivants :
- `k8s/base/redis/deployment.yaml`
    * Compléter la configuration
    * ℹ️ Contrairement aux services HTTP, Redis n'expose pas d'endpoint `/health`. Adaptez la `readinessProbe` pour vérifier qu'il est prêt à accepter des connexions.
- `k8s/base/redis/service.yaml`
    * Compléter la configuration
    * Ajouter les ports

Appliquez :

```bash
kubectl apply -f k8s/base/redis/
```

---

### Étape 7 — Déployer l'`api-gateway` et le frontend

L'`api-gateway` est le point d'entrée unique pour les clients. Il reçoit les requêtes et les proxie vers les services internes.

Le frontend est une application React compilée et servie par nginx. L'image embarque une configuration nginx qui proxie les requêtes `/api` vers l'`api-gateway` — ce nom DNS est résolu automatiquement grâce au Service Kubernetes de l'`api-gateway`.

Comme à l'étape 5, créez les fichiers de configuration dans des dossiers dédiés.

> Pour chaque service, posez-vous ces questions : 
>
> 1. Que sert-il ? De la logique métier ou des fichiers statiques ?
> 2. Y a-t-il un état partagé entre les requêtes qui pourrait poser problème avec plusieurs instances ?
> 3. Quel est l'impact d'une indisponibilité momentanée de l'un d'entre eux en environnement staging ?
> 4. Exécute-t-il du code à chaque requête, ou se contente-t-il de servir des fichiers précompilés ? Qu'est-ce que cela implique sur les ressources nécessaires (requests et limits) ?
>
> Choisissez le nombre de replicas et dimensionnez les ressources pour chaque service. Justifiez vos choix dans `REPORT.md`.

Appliquez et vérifiez que les Pods passent en `1/1 Running`.

---

### Étape 8 — Vérifier que tout tourne

```bash
kubectl get all -n staging
```

Tous les Pods doivent être en `1/1 Running`. Si un Pod reste en `0/1` ou `CrashLoopBackOff` :

```bash
kubectl describe pod -l app=<nom-du-pod> -n staging
kubectl logs pod -l app=<nom-du-pod> -n staging
```

Vérifiez les logs des services principaux :

```bash
kubectl logs -n staging deployment/task-service
kubectl logs -n staging deployment/user-service
kubectl logs -n staging deployment/notification-service
kubectl logs -n staging deployment/api-gateway
```

> **Note :** vous pouvez voir des erreurs de connexion vers `otel-collector` dans les logs. C'est normal — le collecteur OpenTelemetry fait partie de la stack d'observabilité (voir `docker-compose.infra.yaml`) qui n'est pas déployée dans ce TP. Ces erreurs sont sans impact sur le fonctionnement applicatif.

---

## Partie 2 — Exposer avec un Ingress

Activez l'addon Ingress de kind :

```bash
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/main/deploy/static/provider/kind/deploy.yaml
```

Attendez que l'Ingress controller soit prêt :

```bash
kubectl wait --namespace ingress-nginx \
  --for=condition=ready pod \
  --selector=app.kubernetes.io/component=controller \
  --timeout=90s
```

⚠️ Le manifest kind de l'Ingress controller ne force pas le scheduling sur le control-plane par défaut. Il peut atterrir sur n'importe quel worker, où le port 80 n'est pas exposé vers votre machine. 

Le controller **doit** tourner sur `taskflow-control-plane`. Effectuez une vérification explicite sur la colonne NODE avant de continuer :

```bash
kubectl get pods -n ingress-nginx -o wide
```

Pour corriger ça, on ajoute `ingress-ready: "true"` au `nodeSelector` du controller.

```bash
kubectl patch deployment ingress-nginx-controller -n ingress-nginx \
  --type='json' \
  -p='[{"op":"add","path":"/spec/template/spec/nodeSelector/ingress-ready","value":"true"}]'
```

On vient d'effectuer une opération de patch sur le manifest de Deployment du `ingress-nginx-controller` :

`op: add` — on ajoute une clé
`path` — le chemin dans le manifest à modifier
`value: "true"` — la valeur du label à matcher

Seul le control-plane porte ce label (configuré dans `kind-config.yaml`), donc le pod sera forcé de s'y scheduler.

Ensuite, on attend que le rollout soit terminé avant de continuer. Sans ça vous appliquerez l'Ingress avant que le controller soit prêt :

```bash
kubectl rollout status deployment/ingress-nginx-controller -n ingress-nginx
```

On vérifie maintenant que le controller tourne bien sur `taskflow-control-plane` :

```bash
kubectl get pods -n ingress-nginx -o wide
```

Complétez la configuration `k8s/base/ingress.yaml` en configurant les routes de votre application. 

Appliquez et testez :

```bash
kubectl apply -f k8s/base/ingress.yaml
curl http://localhost/api/health
```

Ouvrez http://localhost dans votre navigateur — vous devez voir l'interface TaskFlow.

> 1. Essayez de créer un compte sur l'interface. Est-ce que ça fonctionne ?
> 2. Si vous obtenez une erreur, remontez la chaîne de logs (Ingress → api-gateway → user-service ...) jusqu'au service concerné. Une fois la cause identifiée, vous aurez besoin d'inspecter directement le contenu de la base. Comment accéder à PostgreSQL depuis votre machine ? 
> 3. Comparez votre configuration Kubernetes avec docker-compose.yaml. Qu'est-ce qui est fait dans Compose et qui n'existe pas encore dans vos manifests ?
>
> Rectifiez le problème et commentez votre investigation dans `REPORT.md`

---

> ### Service vs Ingress
>
> Vous avez maintenant des **Services** (ClusterIP) et un **Ingress** dans votre cluster. Ces deux ressources exposent du trafic, mais à des niveaux et avec des responsabilités différentes.
>
> Répondez dans votre `REPORT.md` :
>
> 1. Vous avez utilisé une commande pour vous connecter à PostgreSQL depuis votre machine. Pourquoi n'avez-vous pas pu vous connecter directement sur `localhost:5432` sans celle-ci ?
> 2. Quel composant du cluster fait réellement le routage HTTP que vous avez décrit dans votre `Ingress` ? Comment est-il apparu dans le cluster ?
> 3. Dans votre cluster, qui joue le rôle de load balancer entre les replicas de `task-service` ? Est-ce l'Ingress, le Service, ou autre chose ? Qu'est-ce que cela implique sur le rôle réel de l'Ingress dans cette architecture ?

---

## Partie 3 — Scénarios d'observation (live)

Ces scénarios se font en gardant le Terminal A ouvert.

### Scénario 1 — Self-healing

```bash
kubectl delete pod -n staging -l app=task-service
```

Observez le Terminal A. 

> Décrivez dans votre `REPORT.md` ce que vous voyez et pourquoi Kubernetes recrée les Pods.

### Scénario 2 — Readiness probe

Recréez le cluster from scratch avec la readiness probe du `task-service` délibérément cassée. Modifiez le path dans `k8s/base/task-service/deployment.yaml` avant d'appliquer :

```yaml
readinessProbe:
  httpGet:
    path: /does-not-exist
    port: 3002
```

```bash
kind delete cluster --name taskflow
kind create cluster --name taskflow --config k8s/kind-config.yaml
kubectl create namespace staging
kubectl apply -f k8s/base/ --recursive
```

> Observez la colonne READY du Terminal A. 
> 1. Dans quel état sont les pods du `task-service` ?
> 2. Essayez de vous connecter, puis de créer une tâche. Quels services répondent, lesquels ne répondent pas ? 

Remettez le path à `/health`, réappliquez et observez les pods repasser en 1/1.

> 3. Réessayez de créer une tâche.
>
> Documentez dans votre `REPORT.md` puis expliquez la différence entre une readiness probe et une liveness probe. Que se serait-il passé si vous aviez cassé la liveness probe à la place ? 


### Scénario 3 — Rolling update

**1. Préparez une v1.0.1 identifiable du frontend**

Faites une modification visible dans l'interface (couleur, texte, titre...), buildez et publiez l'image :

```bash
docker build -t <votre-dockerhub>/taskflow-frontend:v1.0.1 ./frontend
docker push <votre-dockerhub>/taskflow-frontend:v1.0.1
```

**2. Déclenchez le rolling update** — modifiez le tag dans `k8s/base/frontend/deployment.yaml` (`v1.0.0` → `v1.0.1`) puis appliquez :

```bash
kubectl apply -f k8s/base/frontend/deployment.yaml
```

Observez la cohabitation des pods dans le Terminal A. Rafraîchissez http://localhost — la nouvelle version est en ligne.

**3. Consultez l'historique** :

```bash
kubectl rollout history -n staging deployment/frontend
```

Que voyez-vous dans la colonne `CHANGE-CAUSE` ? Est-ce utile ?

Annotez les révisions pour les rendre lisibles :

```bash
kubectl annotate deployment/frontend -n staging kubernetes.io/change-cause="passage à v1.0.1 - nouvelle interface"
```

**4. Faites un rollback** :

```bash
kubectl rollout undo deployment/frontend -n staging
```

Vérifiez dans le navigateur que l'ancienne version est restaurée. Consultez à nouveau l'historique.

---

> 1. Pendant le rolling update, le nombre de pods disponibles a-t-il diminué ? Pourquoi ?
> 2. Que se serait-il passé si le nouveau pod n'était jamais passé en `1/1` ?
> 3. Pourquoi annoter les révisions est-il important en équipe ?
> 4. `kubectl rollout undo` est-il suffisant comme stratégie de rollback en production ? Quelles limites voyez-vous ?

---

> ### Réflexion théorique
>
> Vous venez d'écrire environ 20 fichiers YAML pour déployer cette stack en staging.
>
> Répondez dans votre `REPORT.md` :
>
> 1. Identifiez au moins 3 valeurs que vous avez répétées dans plusieurs fichiers (namespace, nom d'image, URL de service...). Que se passe-t-il concrètement si vous devez changer l'une d'elles pour un déploiement en production ?

---

## Livrable

- Dossier `k8s/base/` avec tous les manifests versionnés : postgres, redis, user-service, task-service, notification-service, api-gateway, frontend, ingress
- L'interface TaskFlow accessible et fonctionnelle sur http://localhost
- `REPORT.md` avec :
  - Réponses aux questions théoriques et justification de vos choix
  - Observations et analyses des scénarios d'observation (self-healing, readiness probe, rolling update)
