# Grille d'évaluation — TaskFlow TP Cloud & DevOps

**Travail en binôme**

Doit être rendu sous la forme d'un **repository GitHub** accompagné de :
- un **README** : installation, architecture, démarrage
- un **REPORT.md** : réponses théoriques, observations, captures d'écran, démarche d'investigation

La note finale est calculée sur **100 points**.

> **Périmètre d'évaluation**
> La logique métier de TaskFlow est fournie — elle n'est pas évaluée.
> Ce qui est évalué : tout ce qui relève de l'observabilité, que ce soit dans le code applicatif (logs, métriques, instrumentation) ou dans la configuration de la stack (OTel Collector, Prometheus, Tempo, Grafana, Loki).

---

# 1. Fonctionnement global du projet

| Critère | Description |
|---|---|
| Stack d'observabilité opérationnelle | L'ensemble de la stack (OTel Collector, Prometheus, Tempo, Grafana, Loki) démarre et fonctionne correctement |
| Données visibles dans Grafana | Les métriques, logs et traces remontent bien jusqu'à Grafana et sont exploitables |
| Infrastructure reproductible | La stack peut être lancée sur une machine externe en suivant uniquement le README |
| Stabilité | La stack fonctionne de manière reproductible sans manipulation imprévue |

---

# 2. Implémentation technique

| Critère | Description |
|---|---|
| Qualité des logs | Les logs sont structurés, exploitables, et les niveaux sont utilisés de façon cohérente |
| Pertinence des métriques | Les métriques ajoutées permettent d'observer efficacement le comportement de l'application |
| Pipeline d'observabilité | Les données transitent correctement de l'application jusqu'à Grafana |
| Dashboards | Les dashboards Grafana sont lisibles, pertinents et versionnés dans le repo |
| Traces distribuées | Les traces couvrent plusieurs services et incluent des spans custom là où c'est justifié |

---

# 3. README et documentation

| Critère | Description |
|---|---|
| Notice d'installation | Instructions claires pour lancer la stack d'observabilité étape par étape |
| Guide d'observation | Étapes permettant d'observer les comportements dans Grafana — comment retrouver une trace, filtrer des logs, lire un dashboard |

---

# 4. REPORT.md — Compréhension et analyse

| Critère | Description |
|---|---|
| Réponses théoriques | Réponses structurées, argumentées, montrant une compréhension réelle des outils |
| Observations et preuves | Les conclusions sont étayées par des preuves concrètes — captures Grafana, résumés k6, chiffres précis — pas d'affirmations sans justification |
| Analyse des résultats | Les comportements observés sont interprétés, mis en perspective, et les limites des outils sont identifiées quand elles sont pertinentes |
| Justification des choix | Les décisions de configuration prises sont expliquées et cohérentes |


---

# 5. Qualité du code et rigueur Git

| Critère | Description |
|---|---|
| Qualité du code d'observabilité | Tout le code relevant de l'observabilité est lisible et cohérent — logs dans les routes et middlewares, `tracing.js`, `metrics.js`, endpoint `/metrics`, configs infra — sans gestion d'erreurs silencieuse |
| Organisation Git | Les commits sont atomiques et les messages clairs |

---

# Pénalités possibles

| Situation | Pénalité |
|---|---|
| Stack d'observabilité impossible à lancer | -20 |
| README absent ou incomplet | -15 |
| Données non visibles dans Grafana | -20 |
| Fichiers sensibles committés (.env, tokens, secrets) | -30 |

---

# Barème final

| Note | Interprétation |
|---|---|
| 90–100 | Travail excellent, compréhension solide |
| 75–89 | Travail maîtrisé |
| 60–74 | Compréhension partielle |
| <60 | Objectifs non atteints |