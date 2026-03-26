# TP1 - Docker & Docker Compose : API Notes

**Binome** : Dorian Joly & Timour Sayfoutdinov

## Description du projet

Application REST API de gestion de notes, conteneurisee avec Docker et orchestree via Docker Compose. Le projet comprend :

- **API** : serveur Node.js (Express 5) exposant un CRUD sur des notes
- **Base de donnees** : PostgreSQL 16 (Alpine) avec initialisation automatique du schema

L'ensemble est lance via un seul `docker compose up`, sans aucune installation locale requise (hormis Docker).

---

## Architecture

```
┌──────────────┐       ┌──────────────────┐
│   Client     │       │   api (Node.js)  │
│  (curl, etc.)├──────►│   Express :3000   │
└──────────────┘       │                  │
                       └───────┬──────────┘
                               │  pg (TCP)
                       ┌───────▼──────────┐
                       │  db (PostgreSQL)  │
                       │     :5432         │
                       │  volume: db_data  │
                       └──────────────────┘
```

Les deux services sont sur le reseau Docker par defaut cree par Compose. L'API se connecte a PostgreSQL via le hostname `db` (nom du service).

---

## Prerequis

- [Docker](https://docs.docker.com/get-docker/) (>= 20.x)
- [Docker Compose](https://docs.docker.com/compose/install/) (>= 2.x, inclus avec Docker Desktop)

Aucun autre outil n'est necessaire (Node.js, npm, PostgreSQL ne sont **pas** requis en local).

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

## Structure du projet

```
tp1/
├── api/
│   ├── Dockerfile          # Image Docker de l'API
│   ├── init.sql            # Script d'initialisation de la BDD
│   ├── package.json        # Dependances Node.js
│   ├── package-lock.json
│   └── src/
│       └── index.js        # Point d'entree de l'API Express
├── docker-compose.yml      # Orchestration des services
├── .env.template           # Template des variables d'environnement
├── .env                    # Variables d'environnement (non versionne)
├── .gitignore
└── README.md
```

---

## Details techniques

### Dockerfile (API)

- **Image de base** : `node:18-alpine` (legere, ~50 Mo)
- **Strategie de build** : copie de `package.json` et `package-lock.json` d'abord, puis `npm install`, puis copie du code source. Cela optimise le cache Docker : les dependances ne sont reinstallees que si elles changent.
- **Port expose** : 3000

### Docker Compose

| Service | Image | Role |
|---------|-------|------|
| `api` | Build depuis `./api` | Serveur Express, expose le port configurable via `PORT_API` |
| `db` | `postgres:16-alpine` | Base de donnees PostgreSQL |

**Points cles** :
- `depends_on: db` assure que PostgreSQL demarre avant l'API
- Le script `init.sql` est monte dans `/docker-entrypoint-initdb.d/` pour creer automatiquement la table `notes` au premier lancement
- Un volume nomme `db_data` persiste les donnees PostgreSQL entre les redemarrages
- Toutes les valeurs sensibles (credentials, ports) sont externalisees dans le `.env`

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

Dans le Dockerfile, on fait :

```dockerfile
COPY package.json package-lock.json ./
RUN npm install
COPY . .
```

Docker fonctionne par **couches (layers)** : chaque instruction cree une couche qui est mise en cache. Si une couche n'a pas change, Docker reutilise le cache au lieu de la reconstruire.

En separant les deux `COPY`, on tire parti de ce mecanisme :
- Si on modifie uniquement le code source (`index.js`), la couche `package.json` n'a pas change, donc `npm install` est **skipee** (cache reutilise). Seul le `COPY . .` est re-execute.
- Si on avait fait un seul `COPY . .` suivi de `npm install`, la moindre modification du code source invaliderait le cache et declencherait un `npm install` complet a chaque build.

**Resultat** : des builds beaucoup plus rapides en developpement (quelques secondes au lieu de 30+ secondes).

### 2. Pourquoi l'image Docker doit rester la meme entre dev et prod ? Pourquoi l'API se connecte a `db` et pas a `localhost` ? (Etape 4)

**Meme image dev/prod** : c'est le principe fondamental de Docker. L'image contient le code et ses dependances dans un etat fige. Si on utilise une image differente en prod, on perd la garantie que "ca marche pareil qu'en dev". Ce qui doit changer entre les environnements, c'est la **configuration** (variables d'environnement), pas l'image elle-meme. C'est pour ca qu'on externalise les parametres (ports, credentials) dans le `.env`.

**`db` et pas `localhost`** : dans Docker Compose, chaque service tourne dans son propre conteneur, avec sa propre interface reseau. `localhost` dans le conteneur API designe le conteneur API lui-meme, pas la base de donnees. Docker Compose cree automatiquement un reseau interne et un **DNS** : chaque service est accessible par les autres via son nom de service (`db`, `api`). C'est pourquoi on configure `PGHOST=db` — c'est le nom DNS du conteneur PostgreSQL sur le reseau Docker.

### 3. Pourquoi la table `notes` n'existe plus apres un `docker compose down` ? (Etape 5)

Par defaut (sans volume), les donnees de PostgreSQL sont stockees **dans le filesystem du conteneur**. Quand on fait `docker compose down`, les conteneurs sont detruits, et tout leur filesystem avec. Au prochain `docker compose up`, un nouveau conteneur PostgreSQL est cree a partir de l'image de base — c'est une base vierge. Le script `init.sql` recree la table, mais les donnees inserees precedemment sont perdues.

C'est la raison pour laquelle on ajoute un **volume** a l'etape 6.

### 4. Pourquoi ne met-on pas les donnees directement dans le conteneur ? Quel composant est stateful ? Lequel est stateless ? (Etape 6)

**Pourquoi pas dans le conteneur** : un conteneur est **ephemere** par conception. Il peut etre detruit, recree, mis a jour, scale horizontalement. Si les donnees sont a l'interieur, elles disparaissent avec lui. Un volume permet de decoupler le cycle de vie des donnees de celui du conteneur.

**Stateful vs stateless** :
- **`db` (PostgreSQL) est stateful** : il stocke des donnees qui doivent persister entre les redemarrages. Il a besoin d'un volume.
- **`api` (Node.js/Express) est stateless** : il ne conserve aucun etat entre les requetes. Toute l'information est en base de donnees. On peut detruire et recrer le conteneur API sans perte de donnees. C'est ce qui rend l'API facilement scalable (on pourrait en lancer plusieurs instances).

### 5. Pourquoi les secrets ne doivent-ils pas etre dans le code ni dans le depot Git ? (Etape 7)

- **Securite** : un depot Git (surtout sur GitHub) peut etre public ou le devenir. Meme sur un repo prive, tous les collaborateurs y ont acces. Un mot de passe ou une cle d'API commitee dans l'historique Git y reste **definitivement** (meme apres suppression du fichier, il reste dans l'historique des commits).
- **Separation des responsabilites** : le code decrit le *comportement*, la configuration decrit l'*environnement*. Un meme code doit pouvoir tourner en dev, staging et prod avec des credentials differents, sans modification.
- **Bonne pratique** : on utilise un `.env` (non versionne, present dans `.gitignore`) et un `.env.template` versionne qui documente les variables attendues sans contenir de valeurs sensibles.

---

## Observations et preuves

### Demarrage du projet

```
$ docker compose up --build
[+] Building 12.3s (9/9) FINISHED
 => [api] ...
[+] Running 3/3
 ✔ Network tp1_default  Created
 ✔ Container tp1-db-1   Created
 ✔ Container tp1-api-1  Created
tp1-db-1   | PostgreSQL init process complete; ready for start up.
tp1-api-1  | API running on port 3000
```

### Test du healthcheck

```
$ curl http://localhost:3000/health
{"status":"ok"}
```

### Creation et lecture d'une note

```
$ curl -s -X POST http://localhost:3000/notes \
  -H "Content-Type: application/json" \
  -d '{"title":"Test","content":"Hello"}' | jq
{
  "id": 1,
  "title": "Test",
  "content": "Hello",
  "created_at": "2026-03-26T10:00:00.000Z"
}

$ curl -s http://localhost:3000/notes | jq
[
  {
    "id": 1,
    "title": "Test",
    "content": "Hello",
    "created_at": "2026-03-26T10:00:00.000Z"
  }
]
```

### Persistance des donnees

Apres un `docker compose down` suivi d'un `docker compose up`, les notes sont toujours presentes grace au volume `db_data`. En revanche, `docker compose down -v` supprime le volume et reinitialise la base.

---

## Auteurs

- Dorian Joly
- [Nom du binome]
