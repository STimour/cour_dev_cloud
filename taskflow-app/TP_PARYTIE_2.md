# TP — Stress test avec k6

## Objectif

Observer le comportement de TaskFlow sous charge et identifier le goulot d'étranglement en combinant les résultats k6 (latence end-to-end) et Grafana (trafic par service en temps réel).

---

## Prérequis

- TaskFlow lancé avec sa stack d'observabilité depuis la commande `npm run dev:infra`
- Grafana accessible sur http://localhost:3000
- Le panel **Request Rate per Service** — doit montrer le trafic reçu par chaque service en req/s
- k6 installé — [https://k6.io/docs/get-started/installation/](https://k6.io/docs/get-started/installation/)
- Un token JWT valide (se connecter via le frontend et récupérer le token dans le localStorage ou les DevTools)
- Un compte utilisateur valide dans l'application (email + mot de passe)

> **Note** : le panel *Latency p50/p95/p99* mesure le temps de traitement **interne** au service (une fois la connexion TCP acceptée par Node.js). Sous forte charge, les connexions refusées au niveau OS ne sont jamais chronométrées. Utilisez le **résumé terminal de k6** comme source de vérité pour la latence end-to-end.

---

## Étape 1 — Lancer un premier test léger

Regardez le ficher `scripts/load-test-light.js`, lancer le test de charge légère.

```bash
k6 run -e TOKEN=<votre_token> scripts/load-test.js
```

**À la fin du test, lisez le résumé k6 dans le terminal :**

> **Question 1** — Quelle est la latence p95 affichée par k6 pendant ce test léger ? Est-elle dans les seuils acceptables (< 200ms) ?

> **Question 2** — Le taux `http_req_failed` est-il à 0 % ? Si non, quel code d'erreur observez-vous ?

---

## Étape 2 — Monter la charge progressivement

Lancez maintenant le script réaliste `scripts/load-test-realistic.js` qui simule un vrai parcours utilisateur sur tous les services :

```bash
k6 run -e EMAIL=<email> -e PASSWORD=<password> scripts/load-test-realistic.js
```

Relancez et observez **Grafana** + **terminal k6** en continu.

> **Question 3** — Dans le résumé k6, observez les lignes `checks_failed` et `http_req_duration`. À partir de quel stade (combien de VUs) le check `tasks response < 500ms` commence-t-il à échouer massivement ? Quelle est la p95 finale ?
> Ne pas hésiter à faire varier les options du scénario pour répondre complètement à la question.

> **Question 4** — Dans Grafana, observez le panel **Request Rate per Service** au pic de charge. L'`api-gateway` reçoit environ 2× plus de trafic que le `task-service` et 4× plus que le `user-service`. Expliquez pourquoi en vous appuyant sur le script de test : combien de requêtes par service sont émises à chaque itération ?

> **Question 5** — Pourquoi le `task-service` est-il plus impacté que le `user-service` ou le `notification-service` sous forte charge ?

---

## Étape 3 — Tester les limites de `docker scale`

**Manipulation 1** — Tentez de scaler le `task-service` à 3 replicas :

```bash
docker compose up --scale task-service=3
```

> **Question 6** — Que se passe-t-il ? Quelle erreur obtenez-vous et pourquoi ? Identifiez dans le `docker-compose.yml` la ligne responsable.

**Manipulation 2** — Contourner cette erreur en modifiant `docker-compose.yml`, puis relancez :

```bash
docker compose up --scale task-service=3
```

Relancez ensuite le test k6 et observez Grafana.

> **Question 7** — Le scaling a-t-il amélioré les métriques ? Dans Grafana, les 3 replicas reçoivent-ils du trafic ? Mêmes questions depuis l'interface Prometheus sur http://localhost:9090/targets. Combien de targets `task-service` voyez-vous malgré les 3 replicas ? Expliquez pourquoi Prometheus ne peut pas surveiller les 3 instances individuellement avec cette configuration ?

> **Question 8** — Pourquoi `docker scale` ne suffit pas pour un scaling propre en production ? Qu'est-ce qu'un orchestrateur comme Kubernetes apporterait pour résoudre les problèmes que vous avez rencontrés ?

---

## Étape 4 — Limites de l'instrumentation

> **Question 9** — Le panel *Error Rate 5xx* affiche "No data" alors que k6 signale des erreurs. Le serveur retourne-t-il des erreurs HTTP ? Peut-on utiliser ce panel pour détecter une dégradation de performance ?

> **Question 10** — Le panel *Latency p50/p95/p99* reste flat pendant tout le test, alors que k6 mesure une p95 qui ne correcpond pas à ce que montre Grafana. D'où vient cet écart ? Qu'est-ce que ce panel mesure réellement, et qu'est-ce qu'il ne mesure pas ? Que faudrait-il faire pour rectifier ça ?

---

## Livrable

Complétez votre document `REPORT.md` avec vos réponses aux 10 questions.
Inclure des captures d'écran Grafana (panel Request Rate) pour les questions 4 et 5, et le résumé terminal k6 pour les questions 3 et 6.