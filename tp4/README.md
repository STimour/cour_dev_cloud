# TP4 — Observabilité : Logs + Metrics + Health

API REST Node.js/Express/PostgreSQL conteneurisée avec Docker, instrumentée pour l'observabilité.

## Stack technique

- **Runtime** : Node.js 18 (ESM)
- **Framework** : Express 5
- **Base de données** : PostgreSQL 15
- **Logs** : Pino + pino-http
- **Métriques** : prom-client (Prometheus)
- **Conteneurisation** : Docker + Docker Compose

## Lancer le projet

```bash
# Copier les variables d'environnement
cp .env.template .env

# Démarrer les conteneurs
docker compose up --build
```

L'API est disponible sur `http://localhost:3000`.

---

## Partie 1 — Logger structuré avec Pino

### Ce que j'ai fait

J'ai remplacé tous les `console.log` par un logger Pino configuré dans `api/src/logger.js`. Le niveau de log est contrôlé par la variable d'environnement `LOG_LEVEL`.

```js
// api/src/logger.js
import pino from "pino";

const logger = pino({
  level: process.env.LOG_LEVEL || "info",
});

export default logger;
```

Dans le code, j'utilise ensuite `logger.info(...)`, `logger.warn(...)` selon le contexte :

```js
logger.info({ title }, "Creating note");       // flux normal
logger.warn({ retriesLeft }, "Waiting for database..."); // situation suspecte
```

### Questions théoriques

**1. À quoi ressemblent les logs produits par Pino ?**

```json
{"level":30,"time":1776064550426,"pid":19,"hostname":"2a9aa5a8d5fc","msg":"Database ready"}
{"level":30,"time":1776064614874,"pid":19,"hostname":"2a9aa5a8d5fc","title":"Ma note","msg":"Creating note"}
{"level":30,"time":1776064614880,"pid":19,"hostname":"2a9aa5a8d5fc","id":2,"msg":"Note created"}
```

Chaque log est une ligne JSON avec les champs : `level` (code numérique), `time` (timestamp Unix ms), `pid`, `hostname`, plus les champs métier passés en premier argument, et `msg`.

**2. En quoi ce format diffère-t-il d'un `console.log` classique ?**

Un `console.log("Note created", id)` produit une chaîne de texte libre, non structurée. Elle est lisible par un humain mais impossible à parser automatiquement. Pino produit du JSON : chaque information est un champ typé et requêtable. Cela permet d'indexer les logs dans des outils comme Loki, Elasticsearch ou Datadog, de filtrer par champ (`id=2`, `level=error`), et de construire des alertes ou dashboards.

**3. Que se passe-t-il avec `LOG_LEVEL=warn` ?**

Avec `LOG_LEVEL=warn`, seuls les logs de niveau `warn` (40), `error` (50) et `fatal` (60) sont émis. Tous les `logger.info(...)` disparaissent. En pratique, les logs "Creating note", "Note created", "Fetching all notes", "Database ready", "API is running" ne s'affichent plus. Seuls les avertissements comme "Waiting for database..." restent visibles. C'est utile en production pour réduire le volume de logs et ne garder que les signaux importants.

**4. Pourquoi ne peut-on pas stocker ces logs dans un fichier sur le cloud ?**

Sur le cloud, les conteneurs sont éphémères : ils peuvent être redémarrés, migrés ou supprimés à tout moment. Un fichier écrit dans le système de fichiers du conteneur est perdu à sa destruction. De plus, avec plusieurs instances du même service (scaling horizontal), les logs seraient dispersés dans N fichiers sur N machines différentes. La bonne pratique est d'écrire les logs sur `stdout`/`stderr` et de laisser l'infrastructure (Docker, Kubernetes, un agent de collecte) les acheminer vers un système centralisé comme Loki ou CloudWatch.

**5. Y a-t-il une information dans les logs Pino pour corréler les logs comme OTel ?**

Pino expose le champ `pid` (process ID) qui permet de grouper les logs d'un même process, mais ce n'est pas suffisant pour corréler les logs d'une même requête HTTP traversant plusieurs services. OpenTelemetry ajoute un `trace_id` et un `span_id` injectés dans chaque log, ce qui permet de reconstituer le chemin complet d'une requête. Pino seul ne le fait pas nativement, mais il est possible d'injecter manuellement un identifiant de requête (via `req.id` de pino-http par exemple) pour une corrélation intra-service.

---

## Partie 2 — Middleware HTTP avec pino-http

### Ce que j'ai fait

J'ai installé `pino-http` et branché le middleware au début de la chaîne Express, avant `express.json()`, pour intercepter toutes les requêtes. J'ai personnalisé son comportement pour adapter le niveau de log au statut HTTP et inclure des messages explicites.

```js
app.use(
  pinoHttp({
    logger,
    customLogLevel(req, res, err) {
      if (res.statusCode >= 500 || err) return "error";
      if (res.statusCode >= 400) return "warn";
      return "info";
    },
    customSuccessMessage(req, res) {
      return `${req.method} ${req.url} completed`;
    },
    customErrorMessage(req, res, err) {
      return err?.message ?? `${req.method} ${req.url} failed`;
    },
    customReceivedMessage(req) {
      return `${req.method} ${req.url} received`;
    },
  }),
);
```

### Questions théoriques

**1. Logs produits par pino-http sans configuration, quels champs apparaissent ?**

Sans configuration, pino-http logue automatiquement à la fin de chaque requête avec les champs : `req` (méthode, url, headers, remoteAddress, remotePort), `res` (statusCode, headers), `responseTime` (en ms), et `msg` qui vaut par défaut `"request completed"`. Il logue aussi à la réception avec `"request received"`.

**2. Quelles informations manquent pour diagnostiquer une requête en erreur ?**

Sans personnalisation, le message est générique (`"request completed"` quelle que soit l'issue) et le niveau de log est toujours `info`, même pour un 400 ou un 500. Il est donc impossible de distinguer visuellement une erreur d'un succès sans lire le champ `res.statusCode`. De plus, il n'y a aucun message explicite sur la raison de l'échec.

**3. Logs lors d'un appel échoué à cause d'une règle métier (POST sans title) :**

```json
{"level":30,"time":...,"req":{"method":"POST","url":"/notes",...},"msg":"POST /notes received"}
{"level":40,"time":...,"req":{"method":"POST","url":"/notes",...},"res":{"statusCode":400,...},"responseTime":3,"msg":"POST /notes completed"}
```

Ce qui a changé : le `level` passe à `40` (warn) car le status est 400, ce qui permet de filtrer immédiatement les requêtes en erreur dans un agrégateur de logs.

**4. Logs d'une ressource not found (GET /notes/9999) :**

```json
{"level":30,"time":...,"req":{"method":"GET","url":"/notes/9999",...},"msg":"GET /notes/9999 received"}
{"level":40,"time":...,"req":{"method":"GET","url":"/notes/9999",...},"res":{"statusCode":404,...},"responseTime":5,"msg":"GET /notes/9999 completed"}
```

Même comportement : level warn (40) pour tout 4xx.

**5. Quel niveau pour un 400 ? Pour un 200 ? Pourquoi ?**

- 200 → `info` (level 30) : la requête s'est déroulée normalement, c'est du bruit opérationnel attendu.
- 400 → `warn` (level 40) : quelque chose d'anormal s'est passé côté client, c'est un signal potentiellement utile à surveiller.
- 500 → `error` (level 50) : le serveur a planté, c'est critique.

Cette distinction est utile car elle permet de configurer des alertes précises : par exemple déclencher une alerte si le taux de logs `error` dépasse un seuil, sans être noyé par les `info` du flux normal.

---

## Partie 3 — Métriques Prometheus

### Ce que j'ai fait

J'ai créé un module dédié `api/src/metrics.js` qui expose un registre Prometheus, les métriques default du process Node.js, un Counter et un Histogram.

```js
// api/src/metrics.js
import { Registry, collectDefaultMetrics, Counter, Histogram } from "prom-client";

export const register = new Registry();

collectDefaultMetrics({ register });

export const httpRequestsTotal = new Counter({
  name: "http_requests_total",
  help: "Total number of HTTP requests",
  labelNames: ["method", "route", "status_code"],
  registers: [register],
});

export const httpResponseDuration = new Histogram({
  name: "http_response_duration_ms",
  help: "HTTP response duration in milliseconds",
  labelNames: ["method", "route", "status_code"],
  buckets: [5, 10, 25, 50, 100, 250, 500, 1000],
  registers: [register],
});
```

J'ai ensuite branché un middleware dans `app.js` qui écoute l'événement `finish` de la réponse pour mettre à jour les métriques, et exposé un endpoint `/metrics`.

```js
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    const route = req.route?.path ?? req.path;
    const labels = { method: req.method, route, status_code: res.statusCode };
    httpRequestsTotal.inc(labels);
    httpResponseDuration.observe(labels, Date.now() - start);
  });
  next();
});

app.get("/metrics", async (_, res) => {
  res.set("Content-Type", register.contentType);
  res.send(await register.metrics());
});
```

### Questions théoriques

**1. Métriques présentes à froid (sans requête préalable) :**

À froid, `http_requests_total` et `http_response_duration_ms` sont déclarées mais vides (aucune valeur). En revanche, toutes les métriques `process_cpu_*`, `nodejs_heap_*`, `nodejs_eventloop_lag_*`, `nodejs_gc_duration_seconds`, etc. sont déjà présentes. Elles viennent de `collectDefaultMetrics()` qui instrumente automatiquement le process Node.js au démarrage, sans qu'aucune requête soit nécessaire.

**2. Counter après plusieurs appels, quels labels ?**

```
http_requests_total{method="GET",route="/metrics",status_code="200"} 1
http_requests_total{method="POST",route="/notes",status_code="201"} 1
http_requests_total{method="GET",route="/notes/:id",status_code="404"} 1
```

Les labels sont `method`, `route` (normalisée, ex: `/notes/:id` et non `/notes/9999`), et `status_code`. La normalisation de la route via `req.route.path` est importante : sans elle, chaque id différent créerait une nouvelle série temporelle, ce qui exploser la cardinalité.

**3. Différence entre Counter et Histogram ?**

Un **Counter** est une valeur qui ne fait qu'augmenter. Il compte un nombre total d'occurrences : ici le nombre de requêtes. Il ne dit rien sur la distribution des valeurs.

Un **Histogram** répartit les observations dans des buckets prédéfinis et calcule une somme et un total. Il permet de calculer des percentiles (p50, p95, p99) sur le temps de réponse. On utilise un Histogram pour le temps de réponse car un Counter ne donnerait qu'une moyenne globale (sum/count), ce qui masque les valeurs extrêmes. Avec un Histogram, on peut détecter que 95% des requêtes répondent en moins de 25ms mais que 5% dépassent 500ms.

**4. Comment le middleware sait-il que la requête est terminée ?**

Le middleware écoute l'événement `"finish"` de l'objet `res` (la réponse Express). Cet événement est émis par Node.js lorsque toutes les données ont été écrites dans le socket réseau et que la réponse a été envoyée au client. C'est le signal fiable que la requête est terminée côté serveur. On ne peut pas enregistrer la métrique dans le handler de route directement car certains middlewares en aval pourraient encore modifier la réponse.

**5. Trois approches pour mesurer un temps de réponse :**

| Approche | Mécanisme | Précision | Performance | Fiabilité |
|---|---|---|---|---|
| `Date.now()` | Timestamp ms avant/après | Moyenne (ms) | Très bonne | Bonne |
| `process.hrtime.bigint()` | Horloge haute résolution (ns) | Très haute (ns) | Bonne | Très bonne |
| `perf_hooks.performance.now()` | API Web Performance (ms flottant) | Haute (µs) | Bonne | Bonne |

J'ai utilisé `Date.now()` car la précision à la milliseconde est suffisante pour des métriques HTTP. `process.hrtime.bigint()` serait préférable pour des mesures très fines (benchmarks), mais ajoute une conversion en ms avant l'observation dans l'Histogram.

---

## Partie 4 — Health check

> *À venir*

---

## Structure du projet

```
tp4/
├── docker-compose.yml
├── .env
├── .env.template
├── init.sql
└── api/
    ├── Dockerfile
    ├── package.json
    └── src/
        ├── server.js     # Point d'entrée, connexion DB
        ├── app.js        # Express, middlewares, routes
        ├── logger.js     # Instance Pino
        ├── metrics.js    # Registre Prometheus, Counter, Histogram
        └── db.js         # Pool PostgreSQL, waitForDb
```
