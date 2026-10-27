# Déjà Vu

Retrouver tous les films et séries qu'on a vus depuis 1983, en swipant : à droite vu, à gauche pas vu, vers le haut à voir, vers le bas pas sûr, puis de 1 à 4 étoiles. La pile se réordonne selon les réponses : un Tarantino vu fait remonter les autres Tarantino.

Projet personnel, non commercial.

## Lancer en local

```
node scripts/serve.js
```

puis http://localhost:5178 (ajouter `?test` pour tester sans toucher à ses vraies réponses).

## Reconstruire le catalogue

```
node scripts/build-catalog.js
```

Les réponses sont enregistrées dans le navigateur de chaque appareil. Rien n'est envoyé nulle part.

## Sources des données

- Titres, dates, réalisateurs, acteurs, sagas, identifiants IMDb et TMDB : [Wikidata](https://www.wikidata.org)
- Affiches : images des articles de [Wikipédia en anglais](https://en.wikipedia.org), chargées depuis Wikimedia
