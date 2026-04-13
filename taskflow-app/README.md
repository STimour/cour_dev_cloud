# TaskFlow — TP Cloud & DevOps

Architecture multi-services pour apprendre Kubernetes, l'observabilité et le CI/CD.

## Services

| Service | Port | Rôle |
|---|---|---|
| api-gateway | 3000 | Point d'entrée unique, auth JWT |
| user-service | 3001 | Gestion des utilisateurs |
| task-service | 3002 | CRUD des tâches |
| notification-service | 3003 | Événements via Redis Pub/Sub |
| frontend | 5173 | Interface React |

## Infrastructure

| Outil | Port | Rôle |
|---|---|---|
| PostgreSQL | 5432 | Base de données principale |
| Redis | 6379 | Bus de messages entre services |

## Démarrage rapide

```bash
# Installation des dépendances et génération des lockfiles
npm run install:all

# Lancer l'app
npm run dev

# Lancer l'infra d'observabilité
docker compose -f docker-compose.infra.yml up -d
```
