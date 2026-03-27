# TP3 — API Notes avec CI/CD

C'est une API pour gérer des notes (créer, lire, modifier, supprimer) avec une base PostgreSQL derrière. Le truc intéressant c'est surtout la partie CI/CD : on a mis en place des pipelines GitHub Actions pour que chaque push soit testé et que l'image Docker soit buildée et publiée automatiquement.

---

## Comment lancer le projet

Il faut Docker d'installé, c'est tout.

```bash
cp .env.template .env
docker compose up --build
```

L'API est dispo sur `http://localhost:3000`. La base de données se lance toute seule avec Docker Compose, pas besoin d'installer PostgreSQL.

Le fichier `.env` contient les variables de connexion à la base. Par défaut ça marche direct, t'as rien à changer.

---

## Ce que fait l'API

| Route | Méthode | Ce que ça fait |
|-------|---------|----------------|
| `/health` | GET | Vérifie que la DB répond |
| `/notes` | GET | Retourne toutes les notes |
| `/notes` | POST | Crée une note (title obligatoire) |
| `/notes/:id` | GET | Récupère une note par son id |
| `/notes/:id` | PUT | Modifie une note |
| `/notes/:id` | DELETE | Supprime une note |

---

## Les tests

Pour les tests on utilise **Vitest** avec **Supertest**. On a choisi Vitest et pas Jest parce que le projet est en ESM (`import/export`) et Jest + ESM c'est compliqué — il faut souvent rajouter Babel ou des flags expérimentaux pour que ça marche. Vitest lui il est fait pour ESM de base, ça fonctionne sans config.

Pour que les tests soient propres, l'app a été refactorisée : au lieu de créer la connexion à la base directement dans `app.js`, on la passe en paramètre. Du coup en test on donne un faux pool (un mock), et la vraie base n'est jamais contactée.

```bash
cd api
npm test
```

---

## Les pipelines CI/CD

On a trois workflows GitHub Actions :

### 1. CI sur `main`

Dès qu'on push sur `main`, le pipeline se lance. Il fait les tests, et si tout est vert il build l'image Docker et la pousse sur Docker Hub avec deux tags : `latest` et le SHA du commit. Si les tests ratent, l'image n'est pas publiée.

### 2. CI sur les Pull Requests

Quand on ouvre une PR vers `main`, un pipeline se déclenche et lance les tests. L'idée c'est de vérifier que ce qu'on veut merger ne casse rien avant de le merger. Pas de build d'image ici, juste les tests.

### 3. Release sur tag Git

Quand on veut sortir une version officielle, on crée un tag Git :

```bash
git tag v1.0.0
git push origin v1.0.0
```

Le pipeline détecte le tag et publie l'image sur Docker Hub avec ce tag de version. C'est cette image-là qu'on utilise en prod.

---

## Questions du TP

**Pourquoi `latest` c'est pas vraiment une version ?**

Parce que `latest` ça change à chaque build. Si tu déploies `latest` aujourd'hui et quelqu'un d'autre le fait dans un mois, vous n'avez probablement pas la même image. C'est pratique pour tester rapidement mais en prod c'est risqué parce qu'on sait pas exactement ce qu'on a déployé.

**Tag vs digest, c'est quoi la différence ?**

Un tag c'est un nom lisible (`v1.0.0`, `latest`) mais il peut être réécrit. Le digest c'est le hash SHA256 de l'image, lui il change jamais. Si on veux être sûr d'avoir exactement la même image, on utilises le digest.

**Pourquoi séparer staging et prod ?**

Pour tester dans un environnement proche de la prod avant d'y aller vraiment. Une migration ratée en staging c'est juste un problème à corriger mais aucun utilisateurs finales est impactés. La même chose en prod, c'est un incident avec des utilisateurs impactés.

**Pourquoi une version `vX.Y.Z` ne doit jamais être reconstruite ?**

Parce que si tu rebuildes `v1.0.0`, l'image change mais le tag reste le même. Deux personnes qui déploient `v1.0.0` à des moments différents n'auraient plus la même chose. Pour les bugs, les correctifs, on crée une nouvelle version (`v1.0.1`), on ne retouche jamais un tag existant.

**Les avantages d'une PR gate ?**

Ça force à passer par des branches, à faire relire le code, et ça bloque le merge si les tests ratent. Le code qui arrive sur `main` a toujours été validé, c'est plus propre et ça évite les surprises.

**Qu'est-ce qui garantit la traçabilité ?**

Le tag SHA sur l'image Docker. Chaque image correspond à un commit précis. Si un bug apparaît en prod, on regarde quel tag est déployé, on remonte au commit, on voit exactement ce qui a changé et pourquoi.

---

## Release Process

### En continu (push sur `main`)

À chaque merge sur `main`, l'image est buildée et publiée automatiquement avec `latest` et le SHA du commit. C'est toujours à jour.

### Pour une release officielle

On crée un tag depuis `main` :

```bash
git tag v1.0.0
git push origin v1.0.0
```

Le pipeline s'occupe du reste. L'image est publiée avec ce tag sur Docker Hub.

### Versionnement

On suit le Semantic Versioning :
- `v1.0.1` → correction de bug
- `v1.1.0` → nouvelle feature, rien de cassant
- `v2.0.0` → changement qui casse la compatibilité

Un tag de version c'est définitif. On ne le rebuild jamais.
