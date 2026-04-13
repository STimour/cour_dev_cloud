# TaskFlow — TP Cloud & DevOps

Architecture multi-services pour apprendre Kubernetes, l'observabilité et le CI/CD.

## Partie 1 - Observer l'application dans Grafana

### A. Instrumenter l'application

- Instrumenter chaque service avec le **SDK OpenTelemetry**
  - Documentation: https://opentelemetry.io/docs/languages/js/getting-started/nodejs/
    - Créer le fichier `tracing.js`, ce fichier devra :
    1. Initialiser OpenTelemetry SDK avec NodeSDK
    2. Déclarer la ressource : l'ensemble de paires clé-valeur permettant de distinguer à quel service appartient chaque trace
    3. Configurer l'export des traces vers le OTel Collector (OTLP HTTP)
    4. Activer les auto-instrumentations (Express, PG, HTTP)
    5. S'assurer qu'en cas de shutdown, les traces et métriques en attente soient bien exportées
  - ⚠️ S'assurer que le fichier tracing s'exécute avant que le service ne démarre

- Configurer le **collecteur OTel**
  - Documentation : https://opentelemetry.io/docs/collector/configuration/
  - Un pipeline OTel se compose de 3 parties :
    - receivers → comment le collector reçoit les données
    - processors → transformations (optionnel)
    - exporters → où il envoie les données
  - Compléter la config OTel Collector (`infra/otel/config.yml`)
    1. Configurer les receivers otlp (grpc + http)
    2. Configurer un exporter vers Tempo
    - Pour la communication entre deux services backend (Collector → Tempo), on utilisera le endpoint gRPC (port 4317), plus performant qu'HTTP.
    3. Configurer un exporter vers la console (pour déboguer)
    4. Configurer l'exposition des metrics du collector afin que Prometheus puisse venir les chercher et les interpréter
    5. Assembler un pipeline metrics et un pipeline traces

- Configurer **Tempo**
  - Compléter la config Tempo (`infra/tempo/tempo.yml`)
    1. On veut que Tempo expose son API et son UI sur le port 3200. C'est ce port que Grafana utilise pour interroger les traces.
    2. Tempo écoute sur le port qui permettra une communication plus performante.
    3. On souhaitera stocker en local
    4. On utilisera Write-Ahead Log, un buffer temporaire pour ne pas perdre les traces en cas de crash avant qu'elles soient écrites

- Configurer **Prometheus**
  - Documentation : https://prometheus.io/docs/prometheus/latest/configuration/configuration/
  - Compléter la configuration (`infra/prometheus/prometheus.yml`)
    - Ajouter la config globale
    - Ajouter les scrape configs pour chaque service
    - Scraper les métriques internes du OTel Collector(port 8888)

- Configurer **Grafana**
  1. Créer le fichier `infra/grafana/provisioning/datasources/datasources.yml`
  2. Ajouter les configurations pour automatiser la configuration des datasources (Prometheus et Tempo).
  3. Créer le fichier `infra/grafana/provisioning/dashboard/dashboard.yml`
  4. Ajouter les configurations pour que grafana charge automatiquement les dashboards.

- Créer le fichier `docker-compose.infra.yml` et **configurer les services d'infra** :
  1. `otel-collector`
  - Doit exposer les ports permettant de recevoir les traces/métriques en gRPC et HTTP ainsi que les métriques internes du Collector lui-même (que Prometheus peut scraper)
  - Doit monter la configuration de démarrage et sa commande d'exécution
  2. `tempo`
  - Doit exposer son API/UI
  - Doit monter la configuration de démarrage et sa commande d'exécution
  3. `prometheus`
  - Doit exposer l'interface web de Prometheus.
  - Doit monter la config de scraping dans le conteneur et sa commande d'exécution
  - Doit persister les données au redémarrage du conteneur.
  4. `grafana`
  - Exposer l'interface web Grafana
  - Définir les variables d'environement :
    - `GF_SECURITY_ADMIN_PASSWORD` : mot de passe admin par défaut (admin)
    - `GF_USERS_ALLOW_SIGN_UP` : désactive l'inscription publique — seul l'admin peut créer des comptes
  - Les dashboards, préférences, etc.. doivent persistés
  5. Faire s'attendre entre eux les services qui le nécessite pour éviter des erreurs au démarrage.

### B. Visualisation de l'application

#### Metriques

Vous avez déjà `http_requests_total` et `http_request_duration_ms`. On voudrait maintenant ajouter des métriques spécifiques au domaine de l'application :

- `task-service` :
  - `tasks_created_total` — Counter, avec label priority (low/medium/high)
  - `tasks_status_changes_total` — Counter, avec labels from_status et to_status
  - `tasks_gauge` — Gauge, nombre de tâches avec label status (à mettre à jour après chaque CREATE/PATCH/DELETE)

- `user-service` :
  - `user_registrations_total` — Counter
  - `user_login_attempts_total` — Counter avec label success (true/false)

- `api-gateway` :
  - `upstream_errors_total` — Counter avec label service (user-service, task-service...) quand un proxy retourne 502

- `notification-service` :
  - `notifications_sent_total` — Counter avec label event_type (task.created, task.status_changed)

Il faudra d'abord déclarer les métriques dans `metrics.js` puis instrumenter le code métier.

#### Dashboards Grafana

- Dashboard 1 — **Vue d'ensemble des services**
  - Taux de requêtes par service (rate sur http_requests_total)
  - Latence p50/p95/p99 (histogram_quantile sur http_request_duration_ms)
  - Taux d'erreurs (status 5xx)
  - Statut des services (métrique up)

- Dashboard 2 — **Métriques métier TaskFlow**
  - Tâches créées par minute
  - Répartition des tâches par priorité (pie chart)
  - Visualiser le taux de transitions de statut par minute (quels changements de statut sont les plus fréquents sur les 5 dernières minutes ?)
  - Visualiser le taux de tentatives de connexion réussies vs échouées

* Créer les dashboards dans l'interface Grafana, en prenant soin de rendre les graphiques les plus clairs possibles (unités, axes etc ...) 
* Exporter le JSON via Dashboard > Share > Export et le placer dans `infra/grafana/dashboards/`. 
* Configurer `docker-compose.infra.yml` afin de monter les dashboards dans le container du service Grafana pour qu'il puisse les créer au démarrage.

#### Traces

##### Compréhension

Réalisez le scénario suivant et documentez ce que vous observez :

- Faire une requête POST `/api/tasks` depuis le frontend
- Retrouver la trace dans Grafana > Explore > Tempo
- Identifier la chaîne de spans (api-gateway → task-service → postgres)
- Commenter, expliquer les attributs (http.method, http.route, db.statement, etc ...)

##### Ajout de spans custom

L'auto-instrumentation couvre déjà HTTP et PostgreSQL. Redis/pub-sub n'est pas toujours auto-instrumenté.

Dans `task-service/src/routes.js`, créer un span manuel autour de la logique de publication Redis :

```js
const { trace } = require('@opentelemetry/api');
const tracer = trace.getTracer('task-service');

const span = tracer.startSpan('publish.task.created');
await publish("task.created", { ... });
span.end();
```

- Retrouver ce span dans la vue distribuée d'une trace dans Grafana

### C. Ajout des Logs

#### Configuration

Ajouter Promtail et Loki pour voir les logs dans Grafana

- Compléter la config Promtail (`infra/promtail/promtail.yml`)
  1. Définir l'URL de Loki (Loki écoute sur le port 3100, endpoint /loki/api/v1/push)
  2. Parser le JSON Pino pour extraire level et msg
  3. Convertir les niveaux numériques Pino en strings afin de permettre d'écrire un LogQL `level="error"`dans Grafana
  - Pino : 30=info, 40=warn, 50=error

- Compléter la config Loki (`infra/loki/loki.yml`)
  1. Définir path_prefix : chemin de base pour tous les fichiers de Loki dans le container
  2. Définir chunks_directory et rules_directory : utiliser des sous-dossiers de path_prefix
  3. Compléter le schema de config.
  - store : quel moteur d'index ? (le plus récent recommandé par Loki)
  - object_store : cohérent avec le stockage défini au-dessus
  - schema : version v13
- Compléter le fichier `docker-compose.infra.yml` avec les nouveaux services :
  - **Promtail** :
    - Doit monter la config dans le conteneur et sa commande d'exécution
    - Doit pouvoir lire les logs du dossier hôte Docker.
    - Doit pouvoir lire l'API Docker afin de récupérer les métadonnées de chaque conteneur
  - **Loki** :
    - Doit exposer l'API loki.
    - Doit monter la config de scraping dans le conteneur et sa commande d'exécution

- Éditer le fichier `/infra/grafana/provisioning/datasources/datasources.yml` pour ajouter Loki aux datasources de Grafana

#### Visualisation

- Dans Grafana > Explore, sélectionner la datasource Loki, filtrer les logs du task-service uniquement.
  - Quelle syntaxe LogQL est utilisée ?
  - Quelle différence y a-t-il avec une requête Prometheus ?

- Déclencher une erreur volontairement (ex: créer une tâche sans title). Retrouver le log d'erreur correspondant dans Loki.
  - Quelle requête utiliser pour filtrer ?

- Écrire une requête LogQL qui affiche uniquement les logs de niveau error sur tous les services à la fois. Grâce à pino, les services loggent en JSON. Écrire une requête qui extrait et filtre sur le champ statusCode pour ne voir que les requêtes ayant retourné un 500.
  - Comparer :
    - Dans Prometheus http_requests_total{status="500"}.
    - Dans Loki, comment obtenir l'équivalent en passant par les logs ?
  - Entre ces deux approches, laquelle est la plus adaptée et pourquoi ?

- Effectuer une requête POST /api/tasks. Dans Tempo, retrouver la trace correspondante et noter son traceId.
  - Peut-on retrouver ce traceId dans les logs Loki ?
  - Que faudrait-il configurer pour que ce soit automatique ?

- Mettons que l'on observe un pic d'erreurs dans le dashboard Prometheus.
  - Décrire la démarche pour investiguer : par où commencer, comment utiliser métriques, logs et traces ?

## Cheat sheet PromQL · LogQL · TraceQL

### PromQL — Métriques (Prometheus)

#### Types de métriques

| Type      | Description             | Utiliser avec          |
| --------- | ----------------------- | ---------------------- |
| Counter   | Ne fait qu'augmenter    | `rate()`, `increase()` |
| Gauge     | Monte et descend        | Valeur directe         |
| Histogram | Distribution en buckets | `histogram_quantile()` |

#### Fonctions essentielles

```promql
# Taux de requêtes sur 5 minutes (req/s)
rate(http_requests_total[5m])

# Taux de requêtes par minute
rate(http_requests_total[5m]) * 60

# Augmentation cumulée sur 1 heure
increase(http_requests_total[1h])

# Latence p50 / p95 / p99
histogram_quantile(0.95, sum by(job, le) (rate(http_request_duration_ms_bucket[5m])))

# Agrégation par label (une ligne par service)
sum by(job) (rate(http_requests_total[5m]))

# Filtrer sur une valeur de label
http_requests_total{status="500"}

# Filtrer avec une regex (tous les 5xx)
http_requests_total{status=~"5.."}

# Santé des services (1 = up, 0 = down)
up
```

#### Patterns courants

```promql
# Taux d'erreurs (%)
sum(rate(http_requests_total{status=~"5.."}[5m]))
/
sum(rate(http_requests_total[5m])) * 100

# État actuel d'une entité métier (gauge par label)
sum by(<label>) (<your_gauge_metric>)

# Requêtes par service, sans les scrapes /metrics
sum by(job) (rate(http_requests_total{route!="/metrics"}[5m]))
```

### LogQL — Logs (Loki)

#### Syntaxe de base

```logql
# Filtrer les logs d'un service
{job="<your-service>"}

# Filtres multiples
{job="<your-service>", container="<container-name>"}

# Filtrer sur le contenu du log
{job="<your-service>"} |= "error"

# Exclure un pattern
{job="<your-service>"} != "GET /metrics"

# Filtre regex
{job="<your-service>"} |~ "status.*5[0-9]{2}"
```

#### Parsing JSON

```logql
# Parser le JSON et filtrer sur un champ
{job="<your-service>"} | json | level="error"

# Filtrer sur le code HTTP
{job="<your-service>"} |~ `"statusCode":500`

# Tous les services, erreurs uniquement
{job=~".+"} | json | level="error"

# Requêtes en 500 sur tous les services
{job=~".+"} | json | statusCode >= 500
```

#### Requêtes métriques (LogQL → graphe)

```logql
# Taux d'erreurs dans le temps sur tous les services
sum(rate({job=~".+"} | json | level="error" [5m])) by (job)
```

### TraceQL — Traces (Tempo)

#### Syntaxe de base

```traceql
# Tous les spans d'un service
{ resource.service.name = "<your-service>" }

# Filtrer par nom de span (route HTTP)
{ name = "POST /resource" }

# Filtrer par méthode HTTP
{ span.http.method = "POST" }

# Spans plus lents que 100ms
{ duration > 100ms }

# Spans en erreur
{ status = error }
```

#### Combinaison de filtres

```traceql
# Spans lents d'un service spécifique
{ resource.service.name = "<your-service>" && duration > 50ms }

# Erreurs sur une route spécifique
{ span.http.route = "/resource" && status = error }

# Span custom (instrumenté manuellement)
{ name = "<your-custom-span>" }
```

#### Attributs clés d'un span

| Attribut                | Description              |
| ----------------------- | ------------------------ |
| `resource.service.name` | Nom du service           |
| `span.http.method`      | Méthode HTTP             |
| `span.http.route`       | Route                    |
| `span.http.status_code` | Code HTTP                |
| `span.db.statement`     | Requête SQL              |
| `duration`              | Durée du span            |
| `status`                | `ok` / `error` / `unset` |

---

### Démarche d'investigation

```
1. MÉTRIQUES (Prometheus)  → détecter le problème
   "Le taux d'erreurs a augmenté sur <service> à 14h32"

2. LOGS (Loki)             → comprendre ce qui s'est passé
   {job="<service>"} | json | level="error"
   → "Cannot connect to database"

3. TRACES (Tempo)          → localiser la requête exacte
   { resource.service.name = "<service>" && status = error }
   → vue waterfall : service-a → service-b → database (timeout 5s)
```
