# TaskFlow — TP Cloud & DevOps — Compte Rendu Partie 1

## Stack mise en place

L'application TaskFlow est composée de plusieurs services :
- **api-gateway** — point d'entrée unique, proxy vers les services
- **user-service** — gestion des utilisateurs et authentification JWT
- **task-service** — gestion des tâches (CRUD + pub Redis)
- **notification-service** — écoute Redis et stocke les notifications
- **frontend** — interface React servie par Nginx

Infra d'observabilité :
- **OpenTelemetry Collector** — reçoit les traces/métriques des services
- **Tempo** — stockage et requêtage des traces
- **Prometheus** — scrape et stockage des métriques
- **Grafana** — visualisation (dashboards + Explore)
- **Loki + Promtail** — collecte et stockage des logs

---

## A. Instrumentation

Chaque service Node.js a été instrumenté avec le SDK OpenTelemetry via un fichier `tracing.js` chargé au démarrage. Il initialise :
- L'export des traces vers l'OTel Collector en HTTP (port 4318)
- L'export des métriques via `PeriodicExportingMetricReader`
- Les auto-instrumentations Express, PG et HTTP

Les métriques métier ont été ajoutées dans `metrics.js` de chaque service :

| Service | Métriques ajoutées |
|---|---|
| task-service | `tasks_created_total` (label: priority), `tasks_status_changes_total` (from/to), `tasks_gauge` (status) |
| user-service | `user_registrations_total`, `user_login_attempts_total` (label: success) |
| api-gateway | `upstream_errors_total` (label: service) |
| notification-service | `notifications_sent_total` (label: event_type) |

Un span custom a été ajouté dans `task-service/src/routes.js` autour de la publication Redis :

```js
const span = tracer.startSpan('publish.task.created', {
  attributes: { 'messaging.system': 'redis', 'messaging.destination': 'task.created' }
});
await publish('task.created', { ... });
span.end();
```

---

## B. Dashboards Grafana

### Dashboard 1 — Vue d'ensemble des services

![Dashboard Overview](infra/grafana/dashboards/taskflow-overview.json)

Ce dashboard montre :
- **Taux de requêtes par service** (req/s) — on voit le trafic sur api-gateway, task-service, user-service, notification-service
- **Latence HTTP p50/p95/p99** en ms — permet de détecter des dégradations de perf
- **Taux d'erreurs 5xx** en % — vide si tout va bien
- **Statut des services** — tous les 4 services affichés UP en vert

### Dashboard 2 — Métriques métier

Ce dashboard montre les métriques spécifiques à l'application :
- **Tâches créées par minute** — pic visible lors des tests
- **Répartition par priorité** — pie chart, toutes les tâches créées étaient en priorité `medium`
- **Transitions de statut** — no data car aucun changement de statut effectué pendant la démo
- **Tentatives de connexion** — `success=true` visible lors du login

---

## B. Traces distribuées (Tempo)

### Scénario

Requête POST `/api/tasks` depuis le frontend.

### Recherche dans Grafana / Tempo

```traceql
{ resource.service.name = "api-gateway" && span.http.method = "POST" }
```

### Chaîne de spans observée

```
api-gateway: POST /api/tasks (14.71ms)
  └── task-service: POST /tasks (10.24ms)
       ├── pg.connect → tcp.connect → dns.lookup
       ├── pg.query:SELECT (vérif doublons)
       ├── pg.query:INSERT taskflow (création)
       ├── pg.query:SELECT (rechargement gauge)
       ├── publish.task.created (span custom)
       │    └── redis-PUBLISH task.created
```

### Attributs importants

| Span | Attribut | Valeur |
|---|---|---|
| `api-gateway` | `http.method` | POST |
| `api-gateway` | `http.route` | /api/tasks |
| `api-gateway` | `http.status_code` | 201 |
| `task-service` | `http.route` | /tasks |
| `pg.query:INSERT` | `db.system` | postgresql |
| `pg.query:INSERT` | `db.statement` | INSERT INTO tasks... |
| `publish.task.created` | `messaging.system` | redis |
| `publish.task.created` | `messaging.destination` | task.created |

---

## C. Logs (Loki)

Promtail collecte les logs de tous les containers via l'API Docker. Il parse le JSON Pino et convertit les niveaux numériques en strings (`30→info`, `40→warn`, `50→error`).

### Requêtes utilisées

Filtrer les logs du task-service :
```logql
{job=~".*task-service.*"}
```

Filtrer uniquement les erreurs sur tous les services :
```logql
{job=~".+"} | json | level="error"
```

Filtrer les requêtes en 500 :
```logql
{job=~".+"} | json | statusCode >= 500
```

Une erreur a été déclenchée en envoyant un POST `/tasks` sans body via curl. Le log d'erreur est apparu immédiatement dans Loki.

### Différence LogQL vs PromQL

- **PromQL** travaille sur des séries temporelles agrégées — on sait *combien* d'erreurs il y a eu mais pas le détail
- **LogQL** travaille sur les lignes de log brutes — on voit le message exact, la stack trace, le contexte de la requête

Pour compter les 500, Prometheus est plus adapté (déjà agrégé, moins coûteux). Pour comprendre *pourquoi* c'est une 500, Loki est indispensable.

### Corrélation trace ↔ log

Trace ID récupérée dans Tempo : `41fdf3c858b79ceeda5f0786df8f7aba`

Requête Loki :
```logql
{job=~".+"} |= "41fdf3c858b79ceeda5f0786df8f7aba"
```

Résultat : 29 lignes retrouvées — on voit exactement les logs Pino de l'api-gateway et du task-service correspondant à cette requête, avec le même `trace_id` dans les champs JSON.

Pour que cette corrélation soit automatique (lien cliquable depuis Tempo vers Loki), il faudrait configurer un **Derived field** dans la datasource Tempo pointant vers Loki avec le `traceId` comme clé.

### Démarche d'investigation

En cas de pic d'erreurs observé dans Prometheus :

1. **Prometheus** → détecter le problème : `rate(http_requests_total{status=~"5.."}[5m])` — on identifie quel service est touché et à quelle heure
2. **Loki** → comprendre ce qui s'est passé : `{job="task-service"} | json | level="error"` — on lit le message d'erreur exact
3. **Tempo** → localiser la requête exacte : `{ resource.service.name = "task-service" && status = error }` — on voit le waterfall complet et quel appel a échoué (DB timeout, Redis unreachable, etc.)
