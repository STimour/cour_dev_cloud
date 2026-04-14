# TaskFlow — TP Cloud & DevOps

Architecture multi-services avec une stack d'observabilité complète : traces distribuées, métriques et logs centralisés dans Grafana.

## Architecture

### Services applicatifs

| Service | Port | Rôle |
|---|---|---|
| frontend | 5173 | Interface React servie par Nginx |
| api-gateway | 3000 | Point d'entrée unique, proxy + auth JWT |
| user-service | 3001 | Gestion des utilisateurs |
| task-service | 3002 | CRUD des tâches |
| notification-service | 3003 | Notifications via Redis Pub/Sub |
| postgres | 5433 | Base de données principale |
| redis | 6380 | Bus de messages entre services |

### Stack d'observabilité

| Outil | Port | Rôle |
|---|---|---|
| Grafana | 3100 | Visualisation — dashboards, Explore |
| Prometheus | 9090 | Scrape et stockage des métriques |
| Tempo | 3200 | Stockage et requêtage des traces |
| Loki | 3101 | Stockage des logs |
| OTel Collector | 4317/4318 | Réception et routage des traces/métriques |

## Installation

### Prérequis

- Docker + Docker Compose
- Node.js 20+

### 1. Cloner le repo

```bash
git clone <url-du-repo>
cd taskflow-app
```

### 2. Créer le fichier `.env`

Créer un fichier `.env` à la racine avec :

```env
# PostgreSQL
POSTGRES_USER=taskflow
POSTGRES_PASSWORD=taskflow
POSTGRES_DB=taskflow
DATABASE_URL=postgresql://taskflow:taskflow@postgres:5432/taskflow

# Redis
REDIS_URL=redis://redis:6379

# Auth
JWT_SECRET=supersecretjwt

# Services URLs (pour api-gateway)
USER_SERVICE_URL=http://user-service:3001
TASK_SERVICE_URL=http://task-service:3002
NOTIFICATION_SERVICE_URL=http://notification-service:3003

# OpenTelemetry
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
OTEL_EXPORT_INTERVAL_MS=5000

# Logs
NODE_ENV=production
LOG_LEVEL=info
```

### 3. Lancer l'application

```bash
docker compose up -d --build
```

### 4. Lancer la stack d'observabilité

```bash
docker compose -f docker-compose.infra.yml up -d
```

### 5. Accéder aux interfaces

| Interface | URL | Identifiants |
|---|---|---|
| Frontend | http://localhost:5173 | — |
| Grafana | http://localhost:3100 | admin / admin |
| Prometheus | http://localhost:9090 | — |

## Guide d'observation dans Grafana

### Dashboards

Les deux dashboards sont chargés automatiquement au démarrage dans le dossier **TaskFlow** :
- **Vue d'ensemble des services** — taux de requêtes, latence p50/p95/p99, erreurs 5xx, statut UP/DOWN
- **Métriques métier TaskFlow** — tâches créées, répartition par priorité, transitions de statut, tentatives de connexion

### Retrouver une trace (Explore > Tempo)

Toutes les traces POST sur l'api-gateway :
```traceql
{ resource.service.name = "api-gateway" && span.http.method = "POST" }
```

Traces en erreur :
```traceql
{ resource.service.name = "task-service" && status = error }
```

### Filtrer des logs (Explore > Loki)

Logs de tous les services :
```logql
{job=~".+"}
```

Erreurs uniquement :
```logql
{job=~".+"} | json | level="error"
```

Requêtes en 500 :
```logql
{job=~".+"} | json | statusCode >= 500
```

Retrouver les logs d'une trace spécifique (remplacer par le traceId Tempo) :
```logql
{job=~".+"} |= "<traceId>"
```
