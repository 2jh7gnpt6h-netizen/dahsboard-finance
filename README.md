# Patrimoine — Dashboard

Tableau de bord financier personnel : suivi du patrimoine net, performance des
placements, charges fixes et projections, alimenté par un Google Sheet publié
en CSV.

## Structure du projet

```
index.html          Structure de la page (aucune donnée personnelle)
css/style.css        Tous les styles
js/config.js          Vos données personnelles : charges, seuils, URL du Sheet
js/app.js              Logique de l'application (parsing, calculs, rendu, graphiques)
js/quotidien.js       Module de pilotage quotidien (compte courant / ticket resto)
```

Le patrimoine (PEA, AV, PEE, CTO, crypto, liquidités, dette) provient
uniquement du **Google Sheet** — c'est la source de vérité. Le module
"Pilotage quotidien" est indépendant : il permet de saisir votre solde de
compte courant et de Ticket Restaurant pour estimer votre budget jusqu'à la
fin du mois, sans jamais modifier le patrimoine affiché. Ces valeurs sont
stockées uniquement dans le navigateur (`localStorage`), pas sur le Sheet.

## Modifier vos données personnelles

Tout ce qui vous est propre est centralisé dans `js/config.js` :

- `CURRENT_AGE` — votre âge, utilisé pour les projections.
- `SHEET_URL` — l'URL CSV publiée de votre Google Sheet
  (Fichier → Partager → Publier sur le Web → CSV).
- `JALONS` — les paliers de patrimoine net à suivre (ex. 30 000 €, 50 000 €…).
- `CHARGES` — vos charges fixes mensuelles (jour de prélèvement, libellé, montant).
- `REMBOURSEMENT_TGV`, `SEUIL_LIQUIDITE_ALERTE`, `SEUIL_LIQUIDITE_DANGER` —
  seuils d'alerte et remboursements spécifiques à votre situation.

Aucune autre modification n'est nécessaire dans `app.js` pour adapter le
dashboard : le reste du code est générique.

## Format du Google Sheet

Colonnes attendues (l'ordre n'importe pas, la détection se fait par nom) :

`Date`, `Compte courant`, `Crypto`, `Crypto Investi`, `PEA`, `PEA Investi`,
`CTO`, `CTO Investi`, `AV`, `AV Investi`, `PEE`, `PEE Investi`, `Dette`,
`Revenu` (optionnel), `Caution` (optionnel).

## Utilisation

Le dashboard est une page statique sans dépendance de build : ouvrez
`index.html` dans un navigateur, ou servez le dossier avec n'importe quel
serveur statique (GitHub Pages, `python3 -m http.server`, etc.).

Si le Google Sheet est inaccessible (réseau, CORS), vous pouvez charger un
CSV local via le bouton **"Charger un CSV local"**, ou glisser-déposer le
fichier directement sur la page. Le bouton **"Effacer le cache"** vide le
cache local du Sheet en cas de données obsolètes.
