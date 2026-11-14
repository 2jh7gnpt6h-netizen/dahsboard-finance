# Patrimoine — Dashboard

Tableau de bord financier personnel : suivi du patrimoine net, performance des
placements, charges fixes et projections, alimenté par un Google Sheet publié
en CSV.

## Structure du projet

```
index.html              Structure de la page (aucune donnée personnelle)
css/style.css           Tous les styles
js/config.js            Vos données personnelles : charges, seuils, URL du Sheet
js/calculs.js           Lecture du CSV et calculs (aucun accès à la page)
js/quotidien.js         Pilotage quotidien (compte courant, carte, ticket resto)
js/app.js               Affichage des sections, graphiques, chargement, exports
tests/calculs.test.js   Tests des calculs
icons/, manifest.webmanifest   Icône et réglages pour l'ajout à l'écran d'accueil
```

Le patrimoine (PEA, AV, PEE, CTO, crypto, liquidités, dette) provient
uniquement du **Google Sheet** — c'est la source de vérité. Le module
« Pilotage quotidien » est indépendant : il permet de saisir votre solde de
compte courant, de carte à débit différé et de Ticket Restaurant pour piloter
le budget entre deux relevés, sans jamais modifier le patrimoine affiché. Ces
valeurs sont stockées uniquement dans le navigateur (`localStorage`).

## Modifier vos données personnelles

Tout ce qui vous est propre est centralisé dans `js/config.js` :

- `CURRENT_AGE` — votre âge, utilisé pour les projections (à mettre à jour à
  chaque anniversaire).
- `SHEET_URL` — l'URL CSV publiée de votre Google Sheet
  (Fichier → Partager → Publier sur le Web → CSV).
- `JALONS` — les paliers de patrimoine net à suivre (ex. 30 000 €, 50 000 €…).
- `POSTES` — libellé, établissement et couleur de chaque enveloppe.
- `CHARGES` — vos charges fixes mensuelles (jour de prélèvement, libellé, montant).
- `REMBOURSEMENT_TGV`, `SEUIL_LIQUIDITE_ALERTE`, `SEUIL_LIQUIDITE_DANGER` —
  seuils d'alerte et remboursements spécifiques à votre situation.

**Après chaque modification d'un fichier `js/` ou `css/`**, augmentez le numéro
`?v=` des balises correspondantes dans `index.html` (`?v=2` → `?v=3`) : sans
cela, les navigateurs peuvent garder l'ancienne version en cache une dizaine
de minutes.

## Format du Google Sheet

Colonnes attendues (l'ordre n'importe pas, la détection se fait par nom) :

`Date`, `Compte courant`, `Crypto`, `Crypto Investi`, `PEA`, `PEA Investi`,
`CTO`, `CTO Investi`, `AV`, `AV Investi`, `PEE`, `PEE Investi`, `Dette`,
`Revenu` (optionnel), `Caution` (optionnel).

Une ligne sans date reconnaissable (« Total », par exemple) ou entièrement
vide est ignorée et signalée dans la barre d'état en haut de la page.

## Comment sont calculés les indicateurs

- **Variation mensuelle** = effort + marché. Le *marché* est la variation de
  la plus-value latente ; l'*effort* est tout le reste : versements sur les
  placements, épargne laissée en liquide, dette remboursée.
- **Effort d'épargne, taux d'épargne, mois de dépenses couverts** utilisent
  cet effort (moyenne des 12 dernières variations).
- **%/an** : rendement annualisé depuis le premier relevé, pondéré par les
  dates de versement (TRI). Affiché à partir de 6 mois d'historique.
- **Dépenses du pilotage quotidien** : solde du dernier relevé − solde saisi
  − carte à débit différé, dont on retire les charges fixes prélevées entre
  la date du relevé et la date de saisie (liste corrigeable à la main).

## Utilisation

Le dashboard est une page statique sans étape de build : ouvrez `index.html`
dans un navigateur, ou servez le dossier avec n'importe quel serveur statique
(GitHub Pages, `python3 -m http.server`, etc.).

Au chargement, les dernières données connues s'affichent immédiatement depuis
le cache du navigateur, puis sont remplacées dès que le Google Sheet répond.
Si le Sheet est inaccessible, vous pouvez charger un CSV local (bouton
**« Charger un CSV local »** ou glisser-déposer). **« Effacer le cache »**
vide le cache local du Sheet.

## Tests

```
node tests/calculs.test.js
```

Vérifie la lecture du CSV (dates, montants à virgule, guillemets), la
décomposition effort/marché, le rendement annualisé, les charges fixes et la
mini-calculatrice du solde.
