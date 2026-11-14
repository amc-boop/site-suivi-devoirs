# Suivi des révisions (V1)

Site mobile (installable sur le téléphone) pour suivre les révisions, devoirs, DS et bacs blancs d'un élève de 1ère générale (spécialités maths, SES, physique-chimie + bac de français).

## Lancer en local

Prérequis : Node.js 22.13 ou plus récent.

```bash
npm install
npm run dev
```

- Ordinateur : http://localhost:5173
- Téléphone sur le même Wi-Fi : l'adresse « Network » affichée par Vite (ex. `http://192.168.1.20:5173`)

La base de données (SQLite) est créée automatiquement dans `data/` avec des **données d'exemple** au premier lancement.

| Rôle | Identifiant | Mot de passe par défaut |
|---|---|---|
| Admin | `alexandre` | `admin123` |
| Élève | `martin` | `martin123` |
| Parents | `parents` | `parents123` |

Change les mots de passe dans **Réglages → Comptes** (ou via l'icône de profil).

### Repartir de zéro

```bash
npm run db:vide    # comptes + matières + emploi du temps d'exemple, sans historique
npm run db:reset   # tout réinitialiser avec 3 semaines de données d'exemple
```

### Quiz depuis une photo de cours (Gemini, gratuit)

1. Crée une clé sur https://aistudio.google.com/apikey
2. Copie `.env.example` en `.env` et remplis `GEMINI_API_KEY=...`
3. Relance `npm run dev`

Sans clé, l'onglet Quiz affiche « Quiz pas encore activé » et rien ne casse.

## Ce que fait l'appli

- **Aujourd'hui** (élève) : compte à rebours vers le prochain DS / bac blanc (rouge à J-3), tâches du soir à cocher avec compteur X/Y, tâches en retard, cours du jour, devoirs à venir, progression des récompenses. Bouton + avec modèles (réviser un cours, bac de français texte n°X, refaire un DS, exercice, DS/bac blanc/devoir).
- **Tâches automatiques**, générées chaque jour (au plus 5 par soir, réglable) :
  - « Revoir le cours de SES d'aujourd'hui » seulement les jours où il y a SES ;
  - révision quotidienne pendant les 6 jours avant un DS (12 avant un bac blanc) ;
  - « Finir : … » 2 jours avant un devoir à rendre (toujours ajouté) ;
  - le week-end : un texte du bac de français et un ancien DS à refaire (rotation entre spécialités).
  - Les tâches non faites sont reportées au lendemain 2 fois maximum, puis restent « en retard ».
- **Agenda** visuel : grille horaire (7 h – 23 h) avec les cours en fond, les DS/devoirs en haut de chaque jour et une zone « À placer ». On glisse une tâche (doigt ou souris) sur l'heure voulue, on la déplace de la même façon, ou on la remet dans « À placer ». Un jour à la fois sur téléphone, la semaine entière sur ordinateur. Toucher une tâche : cocher, durée, retirer l'heure.
- **Rendu** du week-end : liste de la semaine, cocher ou joindre une photo par tâche, mot pour les parents, « Valider ma semaine ».
- **Bilan** (parents) : % de la semaine, historique en graphique, photos, retards, bouton « Vu » + commentaire. Les parents peuvent aussi ajouter des tâches (marquées « parents », lui seul les coche), des DS et devoirs dans l'agenda, et modifier l'emploi du temps.
- **Récompenses** par paliers : X semaines de suite à Y %, +N points de moyenne dans une matière, ou objectif libre.
- **Notes** de DS avec courbe et moyenne par matière.
- **Réglages** (admin) : éditeur d'emploi du temps, comptes, matières (spé / révision du soir), limites des tâches.

## Technique

- `server/` : API Express + SQLite intégré à Node (`node:sqlite`), sessions par cookie, photos dans `data/uploads/`.
- `client/` : React + Vite, PWA (manifest + service worker), style manga noir et blanc défini dans `design.md` (rouge #A60321 = urgent, vert #90E098 = positif, toujours avec une icône et un libellé).
- Production locale : `npm run build && npm start` puis http://localhost:3001

### Pistes pour la suite

Mettre en ligne (Supabase pour la base, l'authentification et les photos ; Vercel pour le site), notifications le soir, import de l'emploi du temps depuis Pronote.
