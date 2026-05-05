# TP — Helm

## Objectif

Packager l'ensemble de TaskFlow dans un chart Helm.

---

## Prérequis

- Helm installé — https://helm.sh/docs/intro/install/
- Le cluster kind `taskflow` toujours actif

> ### Réflexion théorique
>
> Répondez dans votre `REPORT.md` :
>
> 1. Comment Helm résout-il le problème de répétition vu dans la dernière partie du TP (cf. dernière question théorique de la partie précédente) ? Quel fichier joue le rôle central dans un chart Helm ?
> 2. À partir de quel niveau de complexité (nombre de services, nombre d'environnements) estimez-vous que Helm devient indispensable plutôt que simplement utile ? Justifiez.

---

## Partie A - Application Taskflow

### Étape 1 - Créer le chart de Taskflow

Un dossier `helm` est déjà créé, contenant quelques fichiers complets : 
- `helm/Chart.yaml`
- `helm/taskflow/templates/user-service.yaml`
- `helm/taskflow/templates/postgres.yaml`
- `helm/values.production.yaml`

---

#### Manipulations

* À vous maintenant de créer tous les autres services (sauf redis: cf section suivante) en suivant le template. Vous retrouverez également un fichier `values.yaml` à compléter.

Vous avez écrit un template Redis maison avec Kubernetes.
Helm permet de déléguer cette responsabilité à un chart Bitnami maintenu par la communauté.

 * Ajoutez la dépendance à Redis dans le fichier `helm/Chart.yaml` et inspectez les fichiers `values` afin d'identifier comment le service est configuré. 

* Téléchargez le sous-chart :

```bash
helm dependency update ./helm/taskflow
```

* Vérifiez que le Service Redis généré s'appelle bien `redis-master` :

```bash
helm template taskflow ./helm/taskflow \
  --values ./helm/taskflow/values.yaml \
  --show-only charts/redis/templates/master/service.yaml
```

> **Note :** Dans le chart Bitnami Redis 18.x, le Service du master est toujours nommé `{fullname}-master`, même avec `fullnameOverride: redis`. Le Service s'appelle donc `redis-master` et non `redis`.

* Mettez à jour vos variables `REDIS_URL` pour pointer vers le bon nom de service

```yaml
value: redis://redis-master:6379
```

---

#### Réflexion théorique — Répondez dans votre `REPORT.md`

> 1. En vous appuyant sur le critère vu en cours, justifiez pourquoi Redis se prête à un chart officiel.
>
> 2. Pourquoi a-t-on conservé un template maison pour PostgreSQL plutôt que d'utiliser `bitnami/postgresql` ?
> Identifiez les deux éléments de votre configuration Postgres actuelle qui rendraient la migration vers Bitnami coûteuse.

---

### Étape 2 — Values par environnement

`values.production.yaml` surcharge les valeurs par défaut avec des valeurs de production. Avant d'aller plus loin, observez ce fichier.

> Des valeurs sensibles (mot de passe, token JWT...) sont présentes dans ce fichier, vous avez un problème : ce fichier est versionné dans Git — même dans un repo privé.

---

#### Réflexion théorique — Répondez dans votre `REPORT.md`

> 1. Comment déployer avec des valeurs sensibles sans les commiter ? Sortez les valeurs sensibles des fichiers commités
>
> 2. Expliquez pourquoi la solution que vous venez de trouver est plus sûre que de mettre les valeurs dans `values.production.yaml`, même si ce fichier est dans un dépôt privé.
>
> 3. `helm-secrets` est un plugin qui chiffre les fichiers de valeurs (via GPG ou AWS KMS) et les déchiffre à la volée au moment du `helm upgrade`.
> Quel problème résout-il que votre solution ne résout pas ? Dans quel contexte deviendrait-il nécessaire ?
>
> 4. Dans GitHub Actions, comment feriez-vous pour passer `$POSTGRES_PASSWORD` dans une commande `helm upgrade` sans qu'il apparaisse en clair dans les logs du workflow ?

---

### Étape 3 — Installation du chart

Avant toute installation ou mise à jour sur le cluster, générez le YAML final pour vérifier que tout est correct.

Générez le rendu complet, puis filtrez sur le template du task-service uniquement.

#### Réflexion théorique — Répondez dans votre `REPORT.md`

> 1. Que se passe-t-il si une variable référencée dans un template n'a pas de valeur correspondante dans values.yaml ? Vérifiez par vous-même en supprimant temporairement une valeur.
>
> 2. Comparez la sortie de helm template sur votre task-service avec le fichier k8s/base/task-service/deployment.yaml écrit en partie 1. Quelles différences structurelles observez-vous ? Pourquoi existent-elles ?

#### Installer

```bash
# Désinstaller ce qui tourne déjà en staging
kubectl delete namespace staging
kubectl create namespace staging

# Installer via Helm
helm upgrade --install taskflow ./helm/taskflow \
  --namespace staging \
  --values ./helm/taskflow/values.yaml
```

Vérifiez :

```bash
helm list -n staging
kubectl get all -n staging
```

---

### Étape 4 — Tester une mise à jour

Il existe un plugin Helm qui permet de visualiser l'impact d'un `helm upgrade` avant de l'appliquer.
* Trouvez-le, installez-le, et utilisez-le pour prévisualiser le changement avant de modifier.
* Effectuer la modification suivante : "Rajouter une instance au service de notification"

> 1. Montrez dans `REPORT.md` votre modification, la commande de prévisualisation et sa sortie.
>
> 2. Dans quel scénario cet outil est-il particulièrement critique — un changement de `replicaCount` ou un changement de `image.<service>.tag` ? Justifiez en vous appuyant sur ce que vous savez du rolling update Kubernetes.

#### Appliquer et observer

```bash
helm upgrade taskflow ./helm/taskflow \
  --namespace staging \
  --values ./helm/taskflow/values.yaml
```

Observez le rolling update dans une fenêtre avec `watch kubectl get pods -n staging -o wide`.

Testez le rollback :

```bash
helm rollback taskflow 1 -n staging
```

Consultez l'historique avec la commande : 

```bash
helm history taskflow -n staging
```

---

#### Réflexion théorique — Historique des déploiements

> Répondez dans votre `REPORT.md` :
> 1. Décrivez ce que vous avez vu avec `watch kubectl get pods -n staging -o wide`.
> 2. Quelle information présente dans `helm history` est absente de `kubectl rollout history` et pourquoi est-elle critique en production ?
> 3. `helm rollback taskflow 1` et `kubectl rollout undo deployment/task-service` semblent faire la même chose. Quelle est la différence fondamentale quand votre application déploie plusieurs ressources (Deployment, Service, ConfigMap) en même temps ?

---

## Livrable

**Chart TaskFlow**
- Dossier `helm/taskflow/` versionné avec chart complet
- `values.yaml` et `values.production.yaml` présents — aucun secret en clair

**REPORT.md**
- Réponses à toutes les questions théoriques encadrées