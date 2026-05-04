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
