# REPORT — TaskFlow TP Cloud & DevOps

## A. Instrumentation

Chaque service Node.js est instrumenté via un fichier `tracing.js` chargé en première ligne de `index.js` avec `require('./tracing')`. Il initialise le SDK OpenTelemetry avec :
- Une **ressource** identifiant le service (`service.name`, `service.version`, `deployment.environment`)
- Un **exporter de traces** OTLP HTTP vers l'OTel Collector (`http://otel-collector:4318/v1/traces`)
- Un **exporter de métriques** OTLP HTTP avec export périodique toutes les 5 secondes
- Les **auto-instrumentations** Express, HTTP et PG (PostgreSQL)
- Un handler de **shutdown propre** sur SIGTERM/SIGINT pour vider le buffer avant arrêt

Les métriques métier ajoutées dans `metrics.js` de chaque service :

| Service | Métriques |
|---|---|
| task-service | `tasks_created_total` (label: priority), `tasks_status_changes_total` (labels: from_status, to_status), `tasks_gauge` (label: status) |
| user-service | `user_registrations_total`, `user_login_attempts_total` (label: success) |
| api-gateway | `upstream_errors_total` (label: service) |
| notification-service | `notifications_sent_total` (label: event_type) |

---

## B. Dashboards Grafana

### Vue d'ensemble des services

![Dashboard overview](images/dashboard-overview.png)

- **Taux de requêtes par service** — on voit le trafic en req/s sur api-gateway, task-service, user-service et notification-service
- **Latence HTTP p50/p95/p99** — histogramme permettant de détecter des dégradations. Ici la latence p99 dépasse 4ms sur certains services au moment des tests
- **Taux d'erreurs 5xx** — vide pendant les tests normaux, s'allume dès qu'une erreur est provoquée
- **Statut des services** — tous les 4 services affichés **UP** en vert

### Métriques métier

![Dashboard business](images/dashboard-business.png)

- **Tâches créées par minute** — pic visible lors de la création de tâches en rafale pendant les tests
- **Répartition par priorité** — pie chart : toutes les tâches créées avaient la priorité `medium`
- **Transitions de statut** — no data car aucun changement de statut n'a été effectué pendant la session de test
- **Tentatives de connexion** — `success=true` visible lors du login, axe gradué jusqu'à 100 req/m

---

## B. Traces distribuées

### Scénario testé

Création d'une tâche via POST `/api/tasks` depuis le frontend.

### Recherche dans Grafana / Tempo

```traceql
{ resource.service.name = "api-gateway" && span.http.method = "POST" }
```

![Tempo search](images/tempo-search.png)

### Chaîne de spans observée

![Tempo waterfall](images/tempo-waterfall.png)

```
api-gateway: POST /api/tasks (14.71ms)
  ├── middleware (expressInit, query, result, authMiddleware, <anonymous>)
  ├── POST → tcp.connect (vers task-service:3002)
  └── task-service: POST /tasks (10.24ms)
       ├── middleware (expressInit, query, jsonParser, <anonymous>, router)
       ├── pg-pool.connect → pg.connect → tcp.connect → dns.lookup
       ├── pg.query:INSERT taskflow (2.11ms) — création de la tâche
       ├── pg-pool.connect → pg.query:SELECT taskflow (934µs) — rechargement gauge
       ├── publish.task.created (590µs) — span custom
       │    └── redis-PUBLISH task.created (511µs)
```

### Attributs importants commentés

![Tempo span details](images/tempo-span-details.png)

| Span | Attribut | Valeur | Signification |
|---|---|---|---|
| `api-gateway` | `http.method` | `POST` | Méthode HTTP de la requête entrante |
| `api-gateway` | `http.route` | `/api/tasks` | Route instrumentée côté gateway |
| `api-gateway` | `http.status_code` | `201` | La tâche a bien été créée |
| `api-gateway` | `http.flavor` | `1.0` | Version HTTP entre le client et le gateway |
| `task-service` | `http.route` | `/tasks` | Route interne du service |
| `pg.query:INSERT` | `db.system` | `postgresql` | Système de base de données |
| `pg.query:INSERT` | `db.statement` | `INSERT INTO tasks...` | Requête SQL exécutée (auto-instrumentée par le plugin PG) |
| `publish.task.created` | `messaging.system` | `redis` | Span custom — identifie Redis comme système de messaging |
| `publish.task.created` | `messaging.destination` | `task.created` | Canal Redis sur lequel l'événement est publié |

Le span `publish.task.created` a été ajouté **manuellement** car Redis n'est pas couvert par les auto-instrumentations. Il permet de voir dans le waterfall que la publication Redis se fait bien après l'INSERT en base, et mesure son temps d'exécution (590µs ici).

---

## C. Logs (Loki)

Promtail collecte les logs de tous les containers via l'API Docker socket. Il parse le JSON Pino et convertit les niveaux numériques en strings lisibles (`30→info`, `40→warn`, `50→error`), ce qui permet d'écrire des filtres LogQL comme `level="error"`.

### Requêtes LogQL utilisées

Logs du task-service uniquement :
```logql
{job=~".*task-service.*"}
```

Erreurs sur tous les services :
```logql
{job=~".+"} | json | level="error"
```

Requêtes ayant retourné un 500 :
```logql
{job=~".+"} | json | statusCode >= 500
```

Une erreur a été provoquée en envoyant un POST sans body via curl :
```bash
curl -X POST http://localhost:3002/tasks -H "Content-Type: application/json" -d '{}'
```
Le log d'erreur est apparu immédiatement dans Loki avec `level="error"`.

### LogQL vs PromQL

- **PromQL** — travaille sur des séries temporelles agrégées. `http_requests_total{status="500"}` donne un compteur mais pas de contexte sur ce qui s'est passé. Adapté pour détecter et quantifier un problème.
- **LogQL** — travaille sur les lignes de log brutes. On voit le message d'erreur exact, la stack trace, les paramètres de la requête. Indispensable pour comprendre *pourquoi* une erreur s'est produite.

Pour compter les 500 dans le temps, Prometheus est plus adapté (données déjà agrégées, requêtes rapides). Pour savoir ce qui a planté et lire le message d'erreur, Loki est indispensable.

### Corrélation trace ↔ log

![Loki correlation](images/loki-correlation.png)

Trace ID récupérée dans Tempo : `41fdf3c858b79ceeda5f0786df8f7aba`

Requête Loki :
```logql
{job=~".+"} |= "41fdf3c858b79ceeda5f0786df8f7aba"
```

**Résultat : 29 lignes** — on retrouve les logs Pino de l'api-gateway et du task-service correspondant exactement à cette requête, avec le même `trace_id` dans les champs JSON.

Pour le moment la corrélation est manuelle (copier-coller du traceId). Pour qu'elle soit automatique avec un lien cliquable depuis Tempo vers Loki, il faudrait configurer un **Derived field** dans la datasource Tempo qui détecte les traceIds et génère un lien vers une requête Loki pré-remplie.

### Démarche d'investigation en cas de pic d'erreurs

```
1. MÉTRIQUES (Prometheus / Dashboard)
   → Détecter : rate(http_requests_total{status=~"5.."}[5m])
   → On identifie quel service est touché et à quelle heure

2. LOGS (Loki)
   → Comprendre : {job="task-service"} | json | level="error"
   → On lit le message d'erreur exact (ex: "Cannot connect to database")

3. TRACES (Tempo)
   → Localiser : { resource.service.name = "task-service" && status = error }
   → On voit le waterfall complet et quel appel a échoué
     (DB timeout ? Redis unreachable ? Service downstream en erreur ?)
```

Cette approche en entonnoir — métriques → logs → traces — permet d'aller du général au particulier sans chercher une aiguille dans une botte de foin.

---

## Partie 2 — Stress test k6

### Étape 1 — Test léger (5 VUs, 30s)

Commande :
```bash
k6 run -e TOKEN=<jwt> scripts/load-test-light.js
```

Résultat :

![k6 light test](images/k6-light-test.png)

```
checks_succeeded: 100.00% (300/300)
http_req_duration: avg=18.81ms  p(90)=23.82ms  p(95)=32.01ms
http_req_failed:   0.00%
```

**Q1 — Latence p95 ?**
La p95 est de **32ms**, largement sous le seuil de 200ms. Sous faible charge (5 VUs), l'application répond très rapidement.

**Q2 — http_req_failed à 0% ?**
Oui, **0% d'échecs**. Tous les checks passent (status 200 + réponse < 200ms). L'application est stable sous charge légère.

---

### Étape 2 — Test réaliste avec montée en charge

**Test à 50 VUs (scénario progressif 3m30s) :**

![k6 realistic 50 VUs](images/k6-realistic-50vus.png)

```
checks_succeeded: 100.00% (12132/12132)
http_req_duration: avg=48.56ms  p(90)=122.55ms  p(95)=134.51ms
http_req_failed:   0.00%
```

**Test à 200 VUs (1 min) — point de rupture :**

![k6 realistic 200 VUs](images/k6-realistic-200vus.png)

```
checks_failed:  15.85% (1659/10464)
✗ tasks response < 500ms  →  4% seulement
http_req_duration: avg=1.19s  p(90)=2.89s  p(95)=3.22s
```

**Q3 — À quel stade le check `tasks response < 500ms` échoue massivement ?**
Le check tient jusqu'à **50 VUs** (100% de succès, p95=134ms). À **200 VUs**, il passe à **96% d'échecs** avec une p95 à **3.22s**. Le point de rupture se situe entre 50 et 200 VUs. Les requêtes HTTP ne retournent pas d'erreur (http_req_failed=0%) — le serveur répond, mais trop lentement.

**Q4 — Pourquoi l'api-gateway reçoit ~4x plus de trafic que user-service ?**

![Dashboard sous charge](images/dashboard-load-test.png)

Par itération dans le script, chaque VU envoie **4 requêtes** qui passent toutes par l'api-gateway :
- POST `/api/users/login` → api-gateway + user-service (1 req chacun)
- GET `/api/tasks` → api-gateway + task-service (1 req chacun)
- POST `/api/tasks` → api-gateway + task-service (1 req chacun)
- GET `/api/notifications` → api-gateway + notification-service (1 req chacun)

Bilan par itération :
- **api-gateway** : 4 requêtes
- **task-service** : 2 requêtes
- **user-service** : 1 requête
- **notification-service** : 1 requête

L'api-gateway reçoit donc 4x plus que user-service et 2x plus que task-service, ce qui est visible sur le panel *Request Rate per Service*.

**Q5 — Pourquoi task-service est-il plus impacté ?**
task-service reçoit **2 requêtes par itération** (GET + POST) contre 1 pour user-service. De plus, le POST `/tasks` est une opération lourde : INSERT en base + SELECT pour recharger la gauge + publication Redis. Le user-service fait uniquement une query SQL + génération JWT sans écriture.

---

### Étape 3 — Limites de docker scale

**Q6 — Que se passe-t-il avec `docker compose up --scale task-service=3` ?**

Erreur obtenue :
```
Bind for 0.0.0.0:3002 failed: port is already allocated
```

La cause est la ligne dans `docker-compose.yml` :
```yaml
task-service:
  ports:
    - "3002:3002"
```

Le port hôte `3002` est statique. Le premier replica le prend, les deux suivants ne peuvent pas binder le même port. Fix : supprimer le mapping de port — task-service n'est accessible que depuis l'api-gateway via le réseau Docker interne, pas depuis l'hôte.

**Après fix — Test à 200 VUs avec 3 replicas :**

![k6 200 VUs 3 replicas](images/k6-200vus-3replicas.png)

```
checks_failed:  11.00% (1595/14496)
✗ tasks response < 500ms  →  34% de succès (vs 4% avant)
http_req_duration: avg=659ms  p(90)=1.64s  p(95)=1.81s  (vs 3.22s avant)
http_reqs: 151/s  (vs 106/s avant)
```

**Q7 — Le scaling a-t-il amélioré les métriques ? Prometheus voit combien de targets ?**

Le scaling améliore les métriques :
- p95 passe de **3.22s à 1.81s** (−44%)
- Throughput passe de **106 req/s à 151 req/s** (+42%)
- Le check `tasks < 500ms` passe de 4% à 34% de succès

Cependant, **Prometheus ne voit qu'1 seul target** `task-service` malgré les 3 replicas. La config Prometheus scrape `task-service:3002` — Docker résout ce nom DNS vers une seule instance à la fois. Prometheus ne dispose d'aucun mécanisme pour découvrir dynamiquement les replicas supplémentaires. Il faudrait une découverte de service dynamique (Docker SD ou Kubernetes SD) pour surveiller les 3 instances individuellement.

**Q8 — Pourquoi docker scale ne suffit pas en production ?**

Problèmes rencontrés :
- **Port fixe** : impossible de scaler sans modifier la config (suppression du mapping de port)
- **Prometheus aveugle** : ne monitore qu'une instance sur 3, les métriques sont incomplètes
- **Load balancing basique** : Docker utilise du round-robin DNS, pas de least-connections ni de health-aware routing
- **Scaling manuel** : on scale à la main, pas en réaction à la charge réelle

Ce que Kubernetes apporterait :
- **Service discovery automatique** : Prometheus découvre tous les pods via l'API Kubernetes
- **HPA (Horizontal Pod Autoscaler)** : scale automatiquement selon CPU, mémoire ou métriques custom
- **Load balancing intelligent** : iptables/IPVS avec health checks, un pod défaillant est retiré automatiquement du pool
- **Pas de conflit de ports** : les pods n'exposent pas de port hôte, la communication passe par les Services Kubernetes

---

### Étape 4 — Limites de l'instrumentation

**Q9 — Le panel Error Rate 5xx affiche "No data" alors que k6 signale des erreurs ?**

Le panel *affiche bien des données* pendant le test — des lignes apparaissent pour api-gateway et task-service. Mais la majorité des échecs k6 (1593 sur 1595) sont des **timeouts de performance** : le serveur retourne un 200 OK, juste au-delà de 500ms. Ces requêtes ne génèrent pas de 5xx, donc le panel ne les détecte pas.

**Ce panel ne peut pas être utilisé pour détecter une dégradation de performance** — il ne détecte que les vraies erreurs serveur (crashes, exceptions non gérées), pas la lenteur.

**Q10 — Pourquoi le panel Latence reste flat à ~3-5ms alors que k6 mesure une p95 à 1.81s ?**

Le panel Grafana affiche **2.5ms à 5ms** pendant tout le test. k6 mesure une **p95 à 1.81s**. L'écart est d'un facteur ~360.

Explication : OpenTelemetry instrumente le traitement **à l'intérieur de Node.js**, une fois la requête acceptée par le processus. Sous 200 VUs simultanés, les connexions TCP s'accumulent dans la **queue de l'OS** (backlog socket) avant que Node.js les dépile. Ce temps d'attente n'est jamais mesuré par l'instrumentation.

k6 mesure **end-to-end depuis le client** : depuis l'envoi de la requête jusqu'à la réception de la réponse complète — ce qui inclut le temps de queue TCP, le temps de traitement Node.js et le temps de réponse réseau.

Pour corriger cet écart, il faudrait mesurer la latence depuis l'extérieur du service : soit via une métrique custom dans l'api-gateway horodatant la requête dès son arrivée TCP, soit en intégrant k6 comme source de métriques dans Grafana (via k6 Cloud ou un exporter Prometheus).

---

## Partie 3 — Kubernetes

### Déploiement de la stack

La stack est décrite dans `k8s/base/` avec des manifests Kubernetes manuels pour :
- PostgreSQL en `StatefulSet`
- Redis en `Deployment`
- `user-service`, `task-service`, `notification-service`, `api-gateway` et `frontend` en `Deployment`
- un `Ingress` nginx exposant `/api` vers l'api-gateway et `/` vers le frontend

Les variables communes non sensibles sont centralisées dans le `ConfigMap` `taskflow-app-config`. Les valeurs sensibles ou assimilées sont dans `taskflow-app-secret` et `postgres-secret`.

Les services Node.js utilisent `DATABASE_URL`, `REDIS_URL` et `JWT_SECRET`. La configuration Kubernetes doit donc fournir ces variables directement, sinon les services retombent sur leurs valeurs locales par défaut et ne se connectent pas aux bons composants du cluster.

Validation réalisée sur kind :
- cluster `taskflow` créé avec 3 nœuds `Ready`
- namespace `staging` créé
- tous les Pods applicatifs en `1/1 Running`
- `curl http://localhost/api/health` retourne `200 OK`
- l'inscription, la connexion et la création d'une tâche via `/api` retournent `201 Created`

Les images Docker Hub `v1.0.0` ont été publiées sous le namespace `dorianyloj` :
- `dorianyloj/taskflow-api-gateway:v1.0.0`
- `dorianyloj/taskflow-user-service:v1.0.0`
- `dorianyloj/taskflow-task-service:v1.0.0`
- `dorianyloj/taskflow-notification-service:v1.0.0`
- `dorianyloj/taskflow-frontend:v1.0.0`

Le frontend `dorianyloj/taskflow-frontend:v1.0.1` a aussi été publié pour le scénario de rolling update. Les Deployments utilisent `imagePullPolicy: IfNotPresent`, ce qui permet à kind d'utiliser une image déjà présente localement ou de la pull depuis Docker Hub sur un cluster neuf.

### Deployment vs StatefulSet

**1. Quelle propriété du StatefulSet garantit que chaque Pod conserve le même volume ?**

Le `volumeClaimTemplates` du StatefulSet crée un PVC stable par Pod. Avec l'identité stable du Pod (`postgres-0`) et le PVC associé, Kubernetes rattache le même volume au même membre du StatefulSet après redémarrage ou rescheduling.

**2. Pourquoi un Deployment est inadapté pour PostgreSQL ?**

Un Deployment traite les Pods comme interchangeables. Il ne garantit pas une identité stable par instance, ni une association naturelle entre une instance logique de base de données et son stockage. Pour PostgreSQL, perdre cette relation peut provoquer des problèmes de persistance, de récupération et de cohérence. Un Deployment est adapté à des processus stateless, pas à un moteur de base de données avec état durable.

**3. Quel autre composant mériterait potentiellement un StatefulSet en production ?**

Redis pourrait mériter un StatefulSet en production si on l'utilise comme composant durable ou en cluster avec réplication. Dans ce TP, Redis sert de bus de messages éphémère, donc un Deployment suffit. En production, avec persistance AOF/RDB ou topologie leader/replicas, il faudrait des identités stables et du stockage attaché.

### Redis et notification-service

Le `notification-service` consomme Redis avec `subscriber.subscribe(...)` sur les canaux `task.created` et `task.status_changed`.

Redis Pub/Sub diffuse chaque message à tous les abonnés actifs. Si on lance plusieurs replicas du `notification-service`, chaque replica reçoit le même événement et peut créer une notification en double. Pour ce TP, le bon choix est donc `replicas: 1` pour `notification-service`.

Le `task-service` peut avoir plusieurs replicas : il publie des événements et traite des requêtes HTTP stateless, à condition que tous les replicas partagent la même base PostgreSQL et le même Redis.

### Choix des replicas et ressources

`user-service` est à 1 replica en staging : il est léger et surtout dépendant de PostgreSQL. En production, on pourrait le scaler horizontalement.

`task-service` est à 2 replicas car il reçoit plus de trafic et effectue les opérations les plus coûteuses : lecture/écriture PostgreSQL et publication Redis.

`notification-service` reste à 1 replica pour éviter les doublons Pub/Sub et parce que son stockage est en mémoire.

`api-gateway` est à 2 replicas : il est stateless et reçoit tout le trafic client, donc il se scale facilement.

`frontend` est à 2 replicas : il sert des fichiers statiques via nginx. Les ressources demandées sont plus faibles que pour les services Node.js, car il n'exécute pas de logique métier à chaque requête.

### Ingress et investigation PostgreSQL

L'Ingress expose :
- `/api` vers le Service `api-gateway`
- `/` vers le Service `frontend`

Si la création de compte échoue alors que l'interface répond, l'investigation doit remonter la chaîne :

```bash
kubectl logs -n staging deployment/api-gateway
kubectl logs -n staging deployment/user-service
kubectl describe pod -n staging -l app=user-service
```

Pour inspecter PostgreSQL depuis la machine locale, on utilise un port-forward :

```bash
kubectl port-forward -n staging svc/postgres 5433:5432
psql postgresql://taskflow:taskflow@localhost:5433/taskflow
```

La différence importante avec Docker Compose est l'initialisation de la base. Compose monte directement `./scripts/init.sql`. En Kubernetes, ce fichier doit exister dans le cluster, par exemple via un `ConfigMap` monté dans `/docker-entrypoint-initdb.d/init.sql`. Sans ce montage, les tables `users`, `tasks` et `notifications` n'existent pas et l'inscription échoue.

Pendant le test, `/api/health` retournait d'abord `401` car l'api-gateway exposait seulement `/health` en public, puis appliquait l'authentification sur les routes `/api/*`. Un alias public `/api/health` a été ajouté avant le middleware d'authentification pour correspondre à la commande du TP.

### Service vs Ingress

**1. Pourquoi ne pas se connecter directement à `localhost:5432` ?**

Le Service PostgreSQL est un `ClusterIP`, donc il est accessible uniquement depuis le réseau interne du cluster. `localhost:5432` pointe vers la machine hôte, pas vers le cluster kind. Le `port-forward` crée explicitement un tunnel local vers le Service Kubernetes.

**2. Qui fait réellement le routage HTTP de l'Ingress ?**

Le routage est effectué par l'Ingress Controller nginx, pas par l'objet `Ingress` seul. L'objet `Ingress` décrit les règles, puis le controller les lit via l'API Kubernetes et configure nginx. Il apparaît dans le cluster après l'application du manifest officiel `ingress-nginx` pour kind.

**3. Qui load balance entre les replicas de `task-service` ?**

Le Service Kubernetes `task-service` load balance vers les Pods prêts via ses Endpoints. L'Ingress ne route que vers l'api-gateway. Ensuite, l'api-gateway appelle `http://task-service:3002`, et c'est le Service `task-service` qui répartit les requêtes entre les replicas prêts.

### Scénario 1 — Self-healing

Commande :

```bash
kubectl delete pod -n staging -l app=task-service
```

Observation réelle : les deux Pods `task-service` ont été supprimés, puis deux nouveaux Pods ont été recréés automatiquement :

```text
task-service-fddfdc44f-5wf4q   1/1 Running
task-service-fddfdc44f-vf78r   1/1 Running
```

Kubernetes recrée les Pods parce que le Deployment déclare un état désiré (`replicas: 2`). Le ReplicaSet associé compare l'état réel à cet état désiré et crée les Pods manquants.

### Scénario 2 — Readiness probe

Avec la readiness probe du `task-service` cassée sur `/does-not-exist`, les Pods peuvent être en état `Running` mais rester en `0/1 READY`.

Observation réelle en appliquant la readiness cassée sur le Deployment existant : un nouveau Pod est resté en `0/1 Running`, et le rollout a expiré :

```text
task-service-69f4cc88bb-vkx2n   0/1 Running
error: timed out waiting for the condition
```

Comme le test a été fait sur un Deployment déjà sain, Kubernetes a conservé les anciens Pods prêts pendant que la nouvelle révision restait bloquée. En recréant le cluster from scratch avec cette readiness cassée, tous les Pods `task-service` seraient `0/1 READY` et le Service n'aurait aucun endpoint prêt.

Effet attendu dans le scénario from scratch :
- le login fonctionne, car `api-gateway` et `user-service` restent prêts
- la création ou la liste des tâches échoue, car le Service `task-service` n'a plus d'endpoint prêt
- l'api-gateway peut répondre avec une erreur upstream ou un timeout selon le comportement exact du proxy

Après correction du path vers `/health` et réapplication du Deployment, les Pods repassent en `1/1 READY` et les tâches redeviennent accessibles.

Différence readiness/liveness :
- `readinessProbe` décide si un Pod peut recevoir du trafic via un Service
- `livenessProbe` décide si le container doit être redémarré

Si la liveness probe avait été cassée, Kubernetes aurait redémarré les containers en boucle, avec un état du type `CrashLoopBackOff` après plusieurs échecs.

### Scénario 3 — Rolling update

Le frontend démarre en `v1.0.0`. Pour tester le rolling update, il faut publier une image `v1.0.1`, modifier le tag dans `k8s/base/frontend/deployment.yaml`, puis appliquer :

```bash
kubectl apply -f k8s/base/frontend/deployment.yaml
kubectl rollout status -n staging deployment/frontend
```

Pendant le rolling update, Kubernetes crée progressivement les nouveaux Pods et retire les anciens quand les nouveaux deviennent prêts. Avec 2 replicas, la disponibilité ne doit pas tomber à zéro. Les paramètres par défaut (`maxUnavailable: 25%`, `maxSurge: 25%`) permettent de garder l'application servie pendant la transition.

Observation réelle : le frontend est passé en `v1.0.1` avec deux nouveaux Pods prêts, puis le rollback a restauré le ReplicaSet précédent en `v1.0.0`. L'historique avant annotation contenait `CHANGE-CAUSE: <none>`. Après annotation :

```text
REVISION  CHANGE-CAUSE
1         <none>
3         passage a v1.0.1 - nouvelle interface
4         <none>
```

Si le nouveau Pod ne passe jamais en `1/1`, le rollout reste bloqué et Kubernetes conserve les anciens Pods disponibles. C'est précisément l'intérêt de la readiness probe : empêcher une version non prête de recevoir du trafic.

La colonne `CHANGE-CAUSE` est vide tant qu'on n'annote pas le Deployment. L'annotation rend l'historique exploitable :

```bash
kubectl annotate deployment/frontend -n staging kubernetes.io/change-cause="passage a v1.0.1 - nouvelle interface"
```

`kubectl rollout undo` est utile pour revenir rapidement à une révision précédente, mais ce n'est pas une stratégie complète de rollback production. Il ne gère pas les migrations de base de données irréversibles, les changements de contrats API, les dépendances externes, les secrets/configmaps incompatibles ou la validation métier après retour arrière.

### Réflexion théorique

Valeurs répétées dans les manifests :
- le namespace `staging`
- le préfixe d'image Docker Hub et les tags `v1.0.0`
- les noms DNS internes (`user-service`, `task-service`, `notification-service`, `postgres`, `redis`)
- les ports applicatifs `3000`, `3001`, `3002`, `3003`, `5432`, `6379`
- les ressources `requests`/`limits`

Si on doit passer en production, il faut modifier ces valeurs dans plusieurs fichiers. Le risque concret est d'oublier un fichier, de déployer une image incohérente, de pointer un service vers une mauvaise URL ou de garder des secrets de staging. C'est exactement le type de répétition que Helm ou Kustomize permet de réduire avec des valeurs centralisées et des overlays par environnement.

---

## Partie 4A — Helm

### Objectif et structure du chart

Helm résout la répétition vue dans les manifests Kubernetes en transformant les fichiers YAML en templates. Les valeurs qui changent selon le service ou l'environnement sont centralisées dans `values.yaml`, puis injectées dans les templates au rendu. Le fichier central d'un chart est donc `values.yaml` pour la configuration, avec `Chart.yaml` pour les métadonnées et les dépendances du chart.

Helm devient indispensable dès qu'on maintient plusieurs services sur plusieurs environnements. Sur TaskFlow, avec 5 services applicatifs, PostgreSQL, Redis et au moins `staging`/`production`, la duplication des images, replicas, ressources, URLs internes et secrets devient trop risquée à maintenir à la main.

La convention retenue pour coller au support Helm est :
- `values.yaml` : valeurs communes ;
- `values.staging.yaml` : surcharges staging non sensibles ;
- `values.production.yaml` : surcharges production non sensibles ;
- `values.secret.yaml.example` : exemple commité sans vraies valeurs ;
- `values.secret.yaml` : vraies valeurs locales, ignorées par Git.

Dans `templates/`, les fichiers suivent le nom de la ressource ou du service : `frontend.yaml`, `task-service.yaml`, `api-gateway.yaml`, `configmap.yaml`, `secret.yaml`, `postgres.yaml`, `ingress.yaml`. Le template Redis maison a été supprimé car Redis est maintenant fourni par le sous-chart Bitnami.

### Redis en sous-chart Bitnami

Redis se prête à un chart officiel car c'est un composant standard, très réutilisé, avec une configuration Kubernetes connue : Service, StatefulSet, probes, persistance optionnelle, auth optionnelle. Il n'y a pas de logique métier TaskFlow à coder dans son template.

PostgreSQL est conservé en template maison car la configuration actuelle contient deux éléments qui rendraient une migration Bitnami coûteuse :
- l'initialisation SQL personnalisée montée via `postgres-initdb` avec les tables `users`, `tasks`, `notifications` ;
- la forme actuelle des secrets et de `DATABASE_URL`, déjà consommée directement par les services Node.js.

La dépendance ajoutée dans `Chart.yaml` :

```yaml
dependencies:
  - name: redis
    version: "18.x.x"
    repository: https://charts.bitnami.com/bitnami
    condition: redis.enabled
```

Commande exécutée :

```bash
helm dependency update ./helm/taskflow
```

Résultat : `redis-18.19.4.tgz` a été téléchargé dans `helm/taskflow/charts/`, et `Chart.lock` a été généré.

Vérification du Service Redis :

```bash
helm template taskflow ./helm/taskflow \
  --values ./helm/taskflow/values.yaml \
  --values ./helm/taskflow/values.staging.yaml \
  --set postgres.password=test-password \
  --set jwt.secret=test-jwt-secret \
  --show-only charts/redis/templates/master/service.yaml
```

Le Service généré s'appelle bien `redis-master`. Les variables applicatives pointent donc vers :

```yaml
REDIS_URL: "redis://redis-master:6379"
```

Note pratique : le chart Bitnami Redis 18.19.4 pointait par défaut vers `docker.io/bitnami/redis:7.2.4-debian-12-r9`, qui n'était plus disponible au pull. J'ai surchargé `redis.image.tag: latest` pour que le Pod démarre correctement dans ce TP.

### Valeurs sensibles

Les secrets ne sont plus écrits en clair dans `values.yaml` ni dans `values.production.yaml`. Les valeurs sensibles attendues sont :

```yaml
postgres:
  password: ...

jwt:
  secret: ...
```

Elles peuvent être fournies via un fichier local ignoré par Git :

```bash
cp helm/taskflow/values.secret.yaml.example helm/taskflow/values.secret.yaml
helm upgrade --install taskflow ./helm/taskflow \
  --namespace staging \
  --values ./helm/taskflow/values.yaml \
  --values ./helm/taskflow/values.staging.yaml \
  --values ./helm/taskflow/values.secret.yaml
```

Ou via `--set` pour un test local :

```bash
helm template taskflow ./helm/taskflow \
  --values ./helm/taskflow/values.yaml \
  --values ./helm/taskflow/values.staging.yaml \
  --set postgres.password=test-password \
  --set jwt.secret=test-jwt-secret
```

Les variables d'environnement non sensibles sont rendues dans `templates/configmap.yaml`, les valeurs sensibles dans `templates/secret.yaml`, puis injectées dans les Pods avec `envFrom` :

```yaml
envFrom:
  - configMapRef:
      name: taskflow-app-config
  - secretRef:
      name: taskflow-app-secret
```

Cette solution est plus sûre qu'un secret commité dans `values.production.yaml` car le secret n'entre pas dans l'historique Git. Un dépôt privé ne protège pas contre une fuite d'accès, un fork, un backup, une mauvaise permission ou un log CI.

`helm-secrets` résout un problème supplémentaire : il permet de versionner des fichiers de valeurs chiffrés. Ma solution évite de commiter les secrets, mais elle ne donne pas d'historique Git des changements de secrets et ne facilite pas leur partage sécurisé entre membres de l'équipe ou runners CI. `helm-secrets` devient nécessaire quand plusieurs personnes/environnements doivent déployer avec des secrets versionnés mais illisibles sans clé GPG/KMS.

Dans GitHub Actions, je passerais les secrets via les secrets GitHub masqués :

```yaml
env:
  POSTGRES_PASSWORD: ${{ secrets.POSTGRES_PASSWORD }}
  JWT_SECRET: ${{ secrets.JWT_SECRET }}

run: |
  helm upgrade --install taskflow ./helm/taskflow \
    --namespace staging \
    --values ./helm/taskflow/values.yaml \
    --values ./helm/taskflow/values.staging.yaml \
    --set-string postgres.password="$POSTGRES_PASSWORD" \
    --set-string jwt.secret="$JWT_SECRET"
```

Il faut éviter `set -x` et ne jamais faire `echo` des valeurs.

### Rendu et installation

Sans valeur fournie, Helm ne bloque pas automatiquement le rendu. Une référence directe à une clé absente peut produire `<no value>` ou une chaîne vide selon le contexte du template. Dans ce chart, les clés sensibles existent dans `values.yaml` mais avec des valeurs vides, ce qui permet de lancer les commandes de rendu du TP sans secret en clair :

```yaml
postgres:
  password: ""
jwt:
  secret: ""
```

Pour un vrai déploiement, ces valeurs doivent être fournies via `values.secret.yaml` ou `--set`. Si on veut forcer Helm à échouer quand une valeur manque, on peut utiliser la fonction `required`, mais je ne l'ai pas gardée ici car elle empêche aussi la commande de vérification ciblée du sous-chart Redis donnée dans l'énoncé.

Comparaison `helm template` du `task-service` avec `k8s/base/task-service/deployment.yaml` :
- le manifeste Helm génère un `Deployment` et un `Service` depuis un seul template ;
- le namespace vient de `.Release.Namespace` au lieu d'être écrit en dur ;
- l'image, les replicas, les ressources et le pull policy viennent de `values.yaml` et de la surcharge `values.staging.yaml` ;
- la configuration commune est factorisée via `taskflow-app-config` et `taskflow-app-secret` ;
- Redis pointe maintenant sur `redis-master` au lieu de `redis`.

Installation exécutée :

```bash
kubectl delete namespace staging
kubectl create namespace staging

helm upgrade --install taskflow ./helm/taskflow \
  --namespace staging \
  --values ./helm/taskflow/values.yaml \
  --set-string postgres.password="$POSTGRES_PASSWORD" \
  --set-string jwt.secret="$JWT_SECRET"
```

Résultat :

```text
NAME: taskflow
NAMESPACE: staging
STATUS: deployed
REVISION: 1
```

Après correction du template Redis maison et de l'image Bitnami, toutes les ressources sont prêtes :

```text
pod/api-gateway-...             1/1 Running
pod/frontend-...                1/1 Running
pod/notification-service-...    1/1 Running
pod/postgres-0                  1/1 Running
pod/redis-master-0              1/1 Running
pod/task-service-...            1/1 Running
pod/user-service-...            1/1 Running
```

Test Ingress :

```bash
curl -i http://localhost/api/health
```

Résultat : `HTTP/1.1 200 OK`.

### Prévisualisation avec helm diff

Plugin installé :

```bash
helm plugin install https://github.com/databus23/helm-diff
```

Modification effectuée sous forme de surcharge dans `values.staging.yaml` :

```diff
 notificationService:
-  replicaCount: 1
+  replicaCount: 2
```

Commande de prévisualisation :

```bash
helm diff upgrade taskflow ./helm/taskflow \
  --namespace staging \
  --values ./helm/taskflow/values.yaml \
  --values ./helm/taskflow/values.staging.yaml \
  --set-string postgres.password="$POSTGRES_PASSWORD" \
  --set-string jwt.secret="$JWT_SECRET"
```

Sortie importante :

```diff
staging, notification-service, Deployment (apps) has changed:
  spec:
-   replicas: 1
+   replicas: 2
```

Cet outil est surtout critique pour un changement de `image.<service>.tag`. Un `replicaCount` modifie la capacité mais ne change pas le code exécuté. Un tag d'image peut introduire une régression applicative, une migration implicite, une incompatibilité de variables d'environnement ou un démarrage impossible. Kubernetes protège partiellement avec le rolling update et les readiness probes, mais `helm diff` permet de voir avant application quelle ressource va réellement changer.

Upgrade appliqué :

```bash
helm upgrade taskflow ./helm/taskflow \
  --namespace staging \
  --values ./helm/taskflow/values.yaml \
  --values ./helm/taskflow/values.staging.yaml \
  --set-string postgres.password="$POSTGRES_PASSWORD" \
  --set-string jwt.secret="$JWT_SECRET"
```

Observation du rollout :

```text
notification-service-...   1/1 Running
notification-service-...   1/1 Running
```

Le Deployment est passé à 2 replicas sans recréer les autres services.

### Historique et rollback

Historique après installation, upgrade et rollback :

```text
REVISION  STATUS      DESCRIPTION
1         superseded  Install complete
2         superseded  Upgrade complete
3         deployed    Rollback to 1
```

Commande de rollback testée :

```bash
helm rollback taskflow 1 -n staging
```

Après rollback, `notification-service` est revenu à 1 replica.

Avec `watch kubectl get pods -n staging -o wide`, on voit Kubernetes ajouter ou supprimer progressivement les Pods pour atteindre l'état désiré. Lors du passage de 1 à 2 replicas, un nouveau Pod `notification-service` apparaît d'abord en `0/1 Running`, puis passe en `1/1 Running`.

`helm history` contient une information absente de `kubectl rollout history` : l'historique global de la release Helm, avec chaque révision qui peut inclure plusieurs ressources Kubernetes. C'est critique en production car un déploiement ne se limite pas toujours à un Deployment ; il peut aussi modifier un Service, une ConfigMap, un Secret ou un StatefulSet.

`helm rollback taskflow 1` et `kubectl rollout undo deployment/task-service` n'ont donc pas le même périmètre. `kubectl rollout undo` revient en arrière sur un seul Deployment. Helm revient en arrière sur l'ensemble des ressources rendues par le chart pour une révision donnée.
