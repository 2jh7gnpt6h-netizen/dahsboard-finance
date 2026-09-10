// ===== CONFIGURATION PERSONNELLE =====
// Toutes les valeurs spécifiques à votre situation vivent ici.
// Le reste du code (app.js) ne contient plus aucune donnée personnelle.

// Âge actuel — utilisé dans l'en-tête et les projections.
const CURRENT_AGE = 29;

// URL du Google Sheet publié en CSV (Fichier → Partager → Publier sur le Web → CSV).
// Le Sheet reste la source de vérité pour le patrimoine : ne jamais la remplacer
// par une saisie manuelle, seulement par une nouvelle URL de publication.
const SHEET_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTLOf9bJmtlJeZ49jK47liS0jzMvUOu_GTF-eMuD_5QoNWIiukuGoUeqkjWXh-Meseo1ku1cxbb6I-6/pub?gid=0&single=true&output=csv';

// Clé de cache local du Sheet (changez-la si la structure des colonnes évolue,
// pour éviter de réafficher un cache obsolète et incompatible).
const STORAGE_KEY = 'patrimoine_sheet_cache_v14';

// Clé de cache local pour le pilotage quotidien (compte courant / ticket resto).
const QUOTIDIEN_STORAGE_KEY = 'patrimoine_quotidien_v1';

// Jalons de patrimoine net à suivre, en euros, ordre croissant.
// Le dernier jalon sert aussi de cible pour la barre de progression principale.
const JALONS = [30000, 50000, 75000, 100000];

// Charges fixes mensuelles : jour de prélèvement, libellé, montant en euros.
const CHARGES = [
  { jour: 1,  nom: 'Loyer',                  montant: 880.00 },
  { jour: 1,  nom: 'Assurance habitation',    montant: 9.26 },
  { jour: 3,  nom: 'Assurance auto (GMF)',    montant: 59.68 },
  { jour: 5,  nom: 'YouTube Premium',         montant: 5.00 },
  { jour: 6,  nom: 'Internet (Orange)',       montant: 19.59 },
  { jour: 8,  nom: 'TGV Max Actif',           montant: 455.00 },
  { jour: 8,  nom: 'Apple iCloud',            montant: 9.99 },
  { jour: 11, nom: 'Cinepass',                montant: 24.00 },
  { jour: 15, nom: 'Claude (via Apple)',      montant: 22.00 },
  { jour: 17, nom: 'Fitness Park',            montant: 25.00 },
  { jour: 22, nom: 'Disney+',                 montant: 4.00 },
  { jour: 23, nom: 'Frais N26',               montant: 16.90 },
  { jour: 25, nom: 'HBO Max (net Spliiit)',   montant: 3.99 },
  { jour: 27, nom: 'EDF',                     montant: 60.00 },
  { jour: 28, nom: 'Crunchyroll',             montant: 3.00 },
];
const TOTAL_CHARGES = CHARGES.reduce((s, c) => s + c.montant, 0);

// Remboursement partiel mensuel du forfait TGV Max (ex : prise en charge employeur).
const REMBOURSEMENT_TGV = 227.50;

// Seuils d'alerte sur les liquidités disponibles (hors caution appartement).
const SEUIL_LIQUIDITE_ALERTE = 3000;
const SEUIL_LIQUIDITE_DANGER = 1500;
