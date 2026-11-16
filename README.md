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

La base de données locale (PGlite, un Postgres embarqué) est créée automatiquement dans `data/` avec des **données d'exemple** au premier lancement.

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
3. Relance `npm run dev` (modèle par défaut : `gemini-flash-lite-latest`, rapide ; `gemini-flash-latest` sert de secours si le premier est saturé)

Sans clé, l'onglet Quiz affiche « Quiz pas encore activé » et rien ne casse.

## Ce que fait l'appli

- **Aujourd'hui** (élève) : indicateurs en premier (J-x avant le prochain DS de spé, J-x avant le prochain bac blanc ou bac — rouge à J-3, tâches à faire ce soir, tâches en retard, devoirs à rendre sous 7 jours, % de la semaine), puis les tâches du soir à cocher et les devoirs à venir. Bouton + avec modèles (réviser un cours, bac de français texte n°X, refaire un DS, exercice, DS/bac blanc/bac/devoir).
- **Tâches automatiques**, générées chaque jour (au plus 5 par soir, réglable) :
  - « Revoir le cours de SES d'aujourd'hui » seulement les jours où il y a SES ;
  - révision quotidienne pendant les 6 jours avant un DS (12 avant un bac blanc) ;
  - « Finir : … » 2 jours avant un devoir à rendre (toujours ajouté) ;
  - le week-end : un texte du bac de français et un ancien DS à refaire (rotation entre spécialités).
  - Les tâches non faites sont reportées au lendemain 2 fois maximum, puis restent « en retard ».
- **Agenda** visuel : grille horaire (7 h – 23 h) avec les cours en fond, les DS/devoirs en haut de chaque jour et une zone « À placer ». On glisse une tâche (doigt ou souris) sur l'heure voulue, on la déplace de la même façon, ou on la remet dans « À placer ». Un jour à la fois sur téléphone, la semaine entière sur ordinateur. Toucher une tâche : cocher, durée, retirer l'heure.
- **Emploi du temps en photo** : bouton appareil photo dans l'Agenda (et onglet Emploi du temps des parents). On photographie l'emploi du temps papier ou une capture de Pronote ; Gemini lit les cours, les matières sont reconnues (MATHEMATIQUES → Maths, SC.ECONO.&SOCIALES → SES…), les heures qui se suivent sont regroupées, et on vérifie / corrige avant d'enregistrer. L'enregistrement remplace l'emploi du temps et recalcule les tâches « revoir le cours » du jour.
- **Mode concentration « NO WORK, NO PORSCHE !! »** : bouton ▶ sur chaque tâche (et « Commencer » sur l'accueil). L'écran devient rouge et reste figé avec un chrono et l'objectif de durée : plein écran et écran allumé quand le téléphone le permet, bouton retour bloqué, reprise après rechargement, sorties de l'appli comptées. On en sort avec « C'est fait ! » (la tâche est cochée) ou en restant appuyé 3 s sur « Abandonner ». Le temps de concentration et les sorties s'affichent sur la tâche (visible par les parents).
- **Rendu** : un **rendu du jour** du lundi au vendredi (onglets Lun → Ven, rattrapage possible sur 2 semaines) et un **rendu du week-end** pour samedi + dimanche, envoyable à partir du dimanche (le soir). Chaque rendu reprend toutes les tâches prévues dans l'agenda : s'il en manque, le rendu part quand même mais les **parents reçoivent une alerte** (Bilan + pastille rouge). Un jour de semaine sans rendu ou un week-end non rendu crée aussi une alerte. Le rendu du week-end demande le quiz de la semaine réussi, puis la validation des parents (« Valider » ou « À revoir »).
- **Quiz de la semaine (obligatoire)** : pour envoyer le rendu du week-end, il doit réussir un quiz de 10 questions (70 % par défaut, réglable dans Réglages → Tâches). Les questions viennent de ce qu'il a travaillé : photos jointes aux tâches, questions de ses quiz de la semaine, et chapitres des DS en cours (via Gemini). Correction côté serveur, essais illimités, questions et réponses mélangées après un échec. Les parents voient le résultat dans le bilan.
- **Bilan** (parents) : % de la semaine, historique en graphique, photos, retards, validation du rendu de la semaine (« Valider » ou « À revoir » + commentaire), journées validées. Les parents peuvent aussi ajouter des tâches (marquées « parents », lui seul les coche), des DS et devoirs dans l'agenda, et modifier l'emploi du temps.
- **Récompenses** par paliers : X semaines de suite à Y %, +N points de moyenne dans une matière, ou objectif libre.
- **Notes** : toutes les matières (pas seulement les spés), courbe et moyenne par matière, et un onglet **Moyenne générale** (moyenne des moyennes de chaque matière) avec son évolution après chaque note.
- **Réglages** (admin) : éditeur d'emploi du temps, comptes, matières (spé / révision du soir), limites des tâches.

## Notifications

- **Martin** : rappel chaque jour à 18 h (tâches du soir et J-x avant le prochain DS ; le dimanche, rendu du week-end).
- **Parents** : notification immédiate quand un rendu est envoyé incomplet, et à 18 h si le rendu de la veille a été oublié.
- Activation : bouton « Activer les notifications » (accueil, bilan ou Mon compte). Sur iPhone, il faut d'abord ajouter le site à l'écran d'accueil (iOS 16.4 ou plus).
- Technique : Web Push (`web-push`, clés `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`) et tâche planifiée Vercel (`vercel.json` → `crons`, protégée par `CRON_SECRET`). Elle est déclenchée à 16 h et 17 h UTC pour couvrir l'heure d'été et d'hiver ; le serveur n'envoie qu'une fois, à partir de 18 h à Paris. Sur l'offre gratuite de Vercel, l'heure exacte varie entre 18 h 00 et 18 h 59.

## Mise en ligne (Supabase + Vercel, gratuit)

1. **Supabase** (https://supabase.com) : nouveau projet, région Paris. Remplir dans `.env` : `DATABASE_URL` (bouton Connect → Transaction pooler, port 6543), `SUPABASE_URL` et `SUPABASE_SECRET_KEY` (voir `.env.example`).
2. **Créer les tables et les comptes** depuis l'ordinateur : `npm run db:init`. Les mots de passe sont générés au hasard et écrits dans `identifiants.txt` (ignoré par Git). La commande refuse d'écraser une base déjà remplie.
3. **Vercel** (https://vercel.com) : « Add New → Project », importer le dépôt GitHub, puis dans *Environment Variables* ajouter `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `GEMINI_API_KEY` (et `GEMINI_MODEL` si besoin). Déployer : `vercel.json` s'occupe du reste (site statique + API dans une fonction).
4. Les photos sont stockées dans Supabase Storage (bucket privé `photos`, créé automatiquement) et réduites sur le téléphone avant l'envoi.

En local, pour travailler sur une base de test même quand `.env` contient `DATABASE_URL` : `DATABASE_URL= npm run dev`.

## Technique

- `server/` : API Express (`app.js`), base Postgres (Supabase en ligne, PGlite en local), sessions par cookie, photos dans Supabase Storage (ou `data/uploads/` en local). Heure de Paris côté serveur, limite de tentatives de connexion.
- `api/index.js` + `vercel.json` : déploiement Vercel.
- `client/` : React + Vite, mise à jour automatique des écrans toutes les 30 s et au retour sur l’appli, PWA (manifest + service worker), style manga noir et blanc défini dans `design.md` (rouge #A60321 = urgent, vert #90E098 = positif, toujours avec une icône et un libellé).
- Production locale : `npm run build && npm start` puis http://localhost:3001

### Pistes pour la suite

Mettre en ligne (Supabase pour la base, l'authentification et les photos ; Vercel pour le site), notifications le soir, import de l'emploi du temps depuis Pronote.
