# TP1 - Docker & Docker Compose : API Notes

**Binome** : Dorian Joly & Timour Sayfoutdinov

## Description du projet

Application REST API de gestion de notes, conteneurisee avec Docker et orchestree via Docker Compose. Le projet comprend :

- **API** : serveur Node.js exposant un CRUD sur des notes
- **Base de donnees** : PostgreSQL 16 avec initialisation automatique du schema

L'ensemble est lance via un seul `docker compose up`, sans aucune installation locale requise (hormis Docker).

---

## Architecture

```
Client (Curl, POstman, ...) -> API (node.js) -> Base de données (POstgreSQL)
```

Les deux services sont sur le même réseau Docker. L'API parle à PostgreSQL en utilisant le hostname db (le nom du service dans le Compose).

---

## Prerequis

- [Docker](https://docs.docker.com/get-docker/)
- [Docker Compose](https://docs.docker.com/compose/install/)
---

## Installation et lancement

### 1. Cloner le repository

```bash
git clone <url-du-repo>
cd tp1
```

### 2. Configurer les variables d'environnement

Copier le template et renseigner les valeurs :

```bash
cp .env.template .env
```

Exemple de fichier `.env` :

```env
PORT_API=3000
PORT_DB=5432
PGUSER=postgres
PGPASSWORD=secret
PGDATABASE=notes
```

### 3. Lancer le projet

```bash
docker compose up --build
```

L'API est accessible sur `http://localhost:<PORT_API>` (par defaut `http://localhost:3000`).

Pour lancer en arriere-plan :

```bash
docker compose up --build -d
```

### 4. Arreter le projet

```bash
docker compose down
```

Pour supprimer egalement les donnees persistantes :

```bash
docker compose down -v
```

---

## Guide d'utilisation

### Verifier que l'API fonctionne

```bash
curl http://localhost:3000/health
```

Reponse attendue :

```json
{ "status": "ok" }
```

### Creer une note

```bash
curl -X POST http://localhost:3000/notes \
  -H "Content-Type: application/json" \
  -d '{"title": "Ma premiere note", "content": "Contenu de la note"}'
```

Reponse attendue (201 Created) :

```json
{
  "id": 1,
  "title": "Ma premiere note",
  "content": "Contenu de la note",
  "created_at": "2026-03-26T..."
}
```

### Lister toutes les notes

```bash
curl http://localhost:3000/notes
```

### Recuperer une note par ID

```bash
curl http://localhost:3000/notes/1
```

### Supprimer une note

```bash
curl -X DELETE http://localhost:3000/notes/1
```

Reponse attendue : `204 No Content`

### Cas d'erreur

- **Titre manquant** : `POST /notes` sans `title` renvoie `400`
- **Note inexistante** : `GET /notes/999` ou `DELETE /notes/999` renvoie `404`

---

## Details techniques

### Dockerfile (API)

Le Dockerfile de l'API utilise node:18-alpine (image légère). On copie d'abord package.json puis on fait npm install, et seulement après on copie le code. Comme ça Docker cache les dépendances et rebuild que le strict nécessaire.

Le depends_on fait démarrer PostgreSQL avant l'API. Le script init.sql est monté dans le dossier d'init de Postgres pour créer la table automatiquement au premier lancement. Un volume db_data garde les données entre les redémarrages.

### Schema de la base de donnees

```sql
CREATE TABLE IF NOT EXISTS notes (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
```

---

## Questions theoriques

### 1. Pourquoi separer l'installation des dependances et la copie du code ? (Etape 2)

Docker fonctionne par couches. Chaque instruction = une couche cachée. Si on changes juste notre index.js, Docker voit que package.json a pas bougé, donc il skip le npm install et réutilise le cache. Résultat : notre build prend quelques secondes au lieu de 30+. Si on faisais tout en un seul COPY, le moindre changement de code relancerait l'install complète des dépendances.

### 2. Pourquoi l'image Docker doit rester la meme entre dev et prod ? Pourquoi l'API se connecte a `db` et pas a `localhost` ? (Etape 4)

L'idée de Docker c'est justement que l'image est identique partout. Ce qui change entre dev et prod, c'est la config (les variables d'env), pas l'image. Si on changes l'image, on perds la garantie que ça marche pareil.

Pour localhost : dans Docker, chaque conteneur a son propre réseau. localhost dans le conteneur API, ça pointe vers le conteneur API lui-même. Pas vers la base. Docker Compose crée un DNS interne où chaque service est joignable par son nom. Donc db = le conteneur PostgreSQL.

### 3. Pourquoi la table `notes` n'existe plus apres un `docker compose down` ? (Etape 5)

Sans volume, les données vivent dans le filesystem du conteneur. Quand on détruis le conteneur, tout part avec. Au prochain up, c'est un conteneur tout neuf, base vierge. Le init.sql recrée la table mais les données d'avant sont perdues.

### 4. Pourquoi ne met-on pas les donnees directement dans le conteneur ? Quel composant est stateful ? Lequel est stateless ? (Etape 6)

Un conteneur c'est éphémère par default. Tu peux le détruire, le recréer, en lancer 10. Si nos données sont dedans, elles disparaissent avec lui. D'où le volume.

db est stateful : il stocke des données qui doivent survivre aux redémarrages. Il a besoin d'un volume.
api est stateless : il garde rien en mémoire entre les requêtes, tout est en base. On peux le détruire et le recréer sans perdre quoi que ce soit.

### 5. Pourquoi les secrets ne doivent-ils pas etre dans le code ni dans le depot Git ? (Etape 7)

Un repo Git peut être public, ou le devenir. Et même si on supprimes un fichier, il reste dans l'historique des commits pour toujours. En plus, le même code doit tourner en dev, staging et prod avec des credentials différents, donc on met ça dans un .env (qui est dans le .gitignore) et on fournit un .env.template pour documenter les variables attendues.

---

## Observations et preuves

Le projet démarre bien, le healthcheck répond ok, on peut créer et lire des notes. Après un docker compose down + up, les données sont toujours là grâce au volume. Avec down -v, la base repart de zéro.

---

## Auteurs

- Dorian Joly
- Timour Sayfoutdinov
