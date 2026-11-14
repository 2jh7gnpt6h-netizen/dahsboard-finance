// ========== CALCULS ==========
// Lecture du CSV et calculs financiers. Aucune de ces fonctions ne touche à
// la page : elles sont vérifiées par tests/calculs.test.js (node).

// ---------- Dates ----------
// Les dates circulent sous la forme "AAAA-MM-JJ". Elles sont toujours
// converties en date locale : new Date("2026-09-03") serait lu en UTC et
// pourrait glisser d'un jour selon le fuseau.

const MOIS_FR = {
  janvier: 1, janv: 1, jan: 1,
  fevrier: 2, fevr: 2, fev: 2, feb: 2,
  mars: 3, mar: 3,
  avril: 4, avr: 4, apr: 4,
  mai: 5, may: 5,
  juin: 6, jun: 6,
  juillet: 7, juil: 7, jul: 7,
  aout: 8, aug: 8,
  septembre: 9, sept: 9, sep: 9,
  octobre: 10, oct: 10,
  novembre: 11, nov: 11,
  decembre: 12, dec: 12,
};

const sansAccents = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

function isoDate(annee, mois, jour) {
  const d = new Date(annee, mois - 1, jour);
  if (d.getFullYear() !== annee || d.getMonth() !== mois - 1 || d.getDate() !== jour) return '';
  return `${annee}-${String(mois).padStart(2, '0')}-${String(jour).padStart(2, '0')}`;
}

// Accepte "2026-09-03", "03/09/2026", "3/9/26", "3 sept. 2026", "3 septembre 2026".
// Renvoie "" si la date n'est pas reconnue.
function parseDate(brut) {
  const s = String(brut == null ? '' : brut).trim();
  let m = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/);
  if (m) return isoDate(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4}|\d{2})(?!\d)/);
  if (m) return isoDate(+m[3] < 100 ? 2000 + +m[3] : +m[3], +m[2], +m[1]);
  m = sansAccents(s.toLowerCase()).match(/^(\d{1,2})\s+([a-z]+)\.?\s+(\d{4})/);
  if (m && MOIS_FR[m[2]]) return isoDate(+m[3], MOIS_FR[m[2]], +m[1]);
  // Dernier recours : tout autre format daté que le navigateur sait lire
  // ("Sep 3, 2026"…). L'année sur 4 chiffres est exigée, sinon une cellule
  // comme "12" serait prise pour une date.
  if (/\d{4}/.test(s)) {
    const d = new Date(s);
    if (!isNaN(d)) return isoDate(d.getFullYear(), d.getMonth() + 1, d.getDate());
  }
  return '';
}

function parseLocalDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
}

const debutDuJour = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());

// Nombre de jours calendaires entre deux dates (insensible à l'heure et au
// changement d'heure été/hiver).
function joursEntre(debut, fin) {
  return Math.round((debutDuJour(fin) - debutDuJour(debut)) / 86400000);
}

// ---------- Nombres ----------
// Tolère "1 645,50 €", "1.645,50", "1,645.50", "(120)", "−35".
function parseNumber(brut) {
  let s = String(brut == null ? '' : brut).replace(/[\s€$%]/g, '').replace(/−/g, '-');
  if (s === '') return 0;
  let negatif = false;
  if (/^\(.*\)$/.test(s)) { negatif = true; s = s.slice(1, -1); }
  const virgule = s.lastIndexOf(',');
  const point = s.lastIndexOf('.');
  if (virgule > -1 && point > -1) {
    // Les deux séparateurs sont présents : le dernier est celui des décimales.
    s = virgule > point ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (virgule > -1) {
    s = s.split(',').length > 2 ? s.replace(/,/g, '') : s.replace(',', '.');
  }
  const n = parseFloat(s);
  if (!isFinite(n)) return 0;
  return negatif ? -n : n;
}

// ---------- CSV ----------
// Découpe un CSV en tableau de lignes/cellules en respectant les guillemets
// (Google Sheets met entre guillemets toute valeur contenant une virgule,
// par exemple un montant "1 645,50").
function splitCSV(texte) {
  const text = String(texte).replace(/^\uFEFF/, '');
  const entete = text.split(/\r?\n/, 1)[0];
  const compte = (c) => entete.split(c).length - 1;
  const sep = compte(';') > compte(',') ? ';' : (compte('\t') > compte(',') ? '\t' : ',');

  const lignes = [];
  let ligne = [];
  let cellule = '';
  let entreGuillemets = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (entreGuillemets) {
      if (c !== '"') cellule += c;
      else if (text[i + 1] === '"') { cellule += '"'; i++; }
      else entreGuillemets = false;
    } else if (c === '"' && cellule === '') {
      entreGuillemets = true;
    } else if (c === sep) {
      ligne.push(cellule); cellule = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      ligne.push(cellule); lignes.push(ligne);
      ligne = []; cellule = '';
    } else {
      cellule += c;
    }
  }
  if (cellule !== '' || ligne.length) { ligne.push(cellule); lignes.push(ligne); }
  return lignes.map(l => l.map(c => c.trim())).filter(l => l.some(c => c !== ''));
}

// Colonnes du Sheet. `motif` est testé sur l'en-tête en minuscules sans accents.
const COLONNES = [
  { champ: 'Date',          nom: 'Date',           motif: /^date$/,                 requis: true },
  { champ: 'Liquidites',    nom: 'Compte courant', motif: /compte.*courant|livret/, requis: true },
  { champ: 'Crypto',        nom: 'Crypto',         motif: /^crypto$/,               requis: true },
  { champ: 'Crypto_Invest', nom: 'Crypto Investi', motif: /crypto.*invest/ },
  { champ: 'PEA',           nom: 'PEA',            motif: /^pea$/,                  requis: true },
  { champ: 'PEA_Invest',    nom: 'PEA Investi',    motif: /pea.*invest/,            requis: true },
  { champ: 'CTO',           nom: 'CTO',            motif: /^cto$/,                  requis: true },
  { champ: 'CTO_Invest',    nom: 'CTO Investi',    motif: /cto.*invest/,            requis: true },
  { champ: 'AV',            nom: 'AV',             motif: /^av$/,                   requis: true },
  { champ: 'AV_Invest',     nom: 'AV Investi',     motif: /av.*invest/,             requis: true },
  { champ: 'PEE',           nom: 'PEE',            motif: /^pee$/,                  requis: true },
  { champ: 'PEE_Invest',    nom: 'PEE Investi',    motif: /pee.*invest/,            requis: true },
  { champ: 'Dette',         nom: 'Dette',          motif: /dette|pret/,             requis: true },
  { champ: 'Revenu',        nom: 'Revenu',         motif: /revenu/ },
  { champ: 'Caution',       nom: 'Caution',        motif: /caution/ },
];

// Renvoie { rows, ignored } : les relevés triés par date, et les lignes
// écartées (date illisible ou ligne vide) pour pouvoir le signaler.
function parseCSV(texte) {
  const table = splitCSV(texte);
  if (table.length < 2) throw new Error('CSV vide ou sans données.');

  const entetes = table[0].map(h => sansAccents(h.toLowerCase()));
  const index = {};
  const manquantes = [];
  COLONNES.forEach(col => {
    index[col.champ] = entetes.findIndex(h => col.motif.test(h));
    if (col.requis && index[col.champ] === -1) manquantes.push(col.nom);
  });
  if (manquantes.length) {
    throw new Error(`Colonne${manquantes.length > 1 ? 's' : ''} manquante${manquantes.length > 1 ? 's' : ''} dans le Sheet : ${manquantes.join(', ')}`);
  }

  const rows = [];
  const ignored = [];
  table.slice(1).forEach(cells => {
    const nombre = (champ) => (index[champ] >= 0 ? parseNumber(cells[index[champ]]) : null);
    const dateBrute = cells[index.Date] || '';
    const row = {
      Date: parseDate(dateBrute),
      Liquidites: nombre('Liquidites'),
      Crypto: nombre('Crypto'),
      Crypto_Invest: nombre('Crypto_Invest'),
      PEA: nombre('PEA'),
      PEA_Invest: nombre('PEA_Invest'),
      CTO: nombre('CTO'),
      CTO_Invest: nombre('CTO_Invest'),
      AV: nombre('AV'),
      AV_Invest: nombre('AV_Invest'),
      PEE: nombre('PEE'),
      PEE_Invest: nombre('PEE_Invest'),
      Dette: nombre('Dette'),
      Revenu: nombre('Revenu'),
      Caution: nombre('Caution') || 0,
    };
    if (!row.Date) {
      ignored.push(`date illisible « ${dateBrute} »`);
    } else if (totalAssets(row) === 0 && row.Dette === 0) {
      ignored.push(`ligne vide du ${dateBrute}`);
    } else {
      rows.push(row);
    }
  });

  if (rows.length === 0) throw new Error('Aucune ligne exploitable dans le Sheet.');
  rows.sort((a, b) => a.Date.localeCompare(b.Date));
  return { rows, ignored };
}

// ---------- Patrimoine ----------
const totalAssets = (r) => r.PEA + r.AV + r.PEE + r.CTO + r.Crypto + r.Liquidites + (r.Caution || 0);
const netOf = (r) => totalAssets(r) - r.Dette;
const investedValue = (r) => r.PEA + r.AV + r.PEE + r.CTO + r.Crypto;
const capInvested = (r) => r.PEA_Invest + r.AV_Invest + r.PEE_Invest + r.CTO_Invest + (r.Crypto_Invest || 0);
const pvLatente = (r) => investedValue(r) - capInvested(r);

// Pour chaque relevé : patrimoine net, plus-value latente et variation par
// rapport au relevé précédent, décomposée en deux parts :
//   marché = variation de la plus-value latente
//   effort = tout le reste (versements, épargne en liquide, dette remboursée)
// Les trois variations valent null pour le premier relevé.
function monthlyBreakdown(rows) {
  return rows.map((row, i) => {
    const net = netOf(row);
    const pv = pvLatente(row);
    if (i === 0) return { row, net, pv, dTotal: null, dMarche: null, dEffort: null };
    const prev = rows[i - 1];
    const dTotal = net - netOf(prev);
    const dMarche = pv - pvLatente(prev);
    return { row, net, pv, dTotal, dMarche, dEffort: dTotal - dMarche };
  });
}

const moyenne = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

function ecartType(xs) {
  if (xs.length < 2) return 0;
  const m = moyenne(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length);
}

// Indicateurs calculés sur les 12 dernières variations mensuelles.
function computeStats(rows, breakdown) {
  const recents = breakdown.slice(1).slice(-12);
  const revenus = rows.slice(-12).map(r => r.Revenu).filter(v => v > 0);

  let meilleur = null;
  recents.forEach(b => { if (!meilleur || b.dTotal > meilleur.dTotal) meilleur = b; });

  // Versements sur les placements uniquement (hors liquidités et dette).
  const versements = [];
  for (let i = Math.max(1, rows.length - 12); i < rows.length; i++) {
    versements.push(capInvested(rows[i]) - capInvested(rows[i - 1]));
  }

  return {
    avgDelta: moyenne(recents.map(b => b.dTotal)),
    avgEffort: moyenne(recents.map(b => b.dEffort)),
    avgMarket: moyenne(recents.map(b => b.dMarche)),
    avgVersements: moyenne(versements),
    avgRev: moyenne(revenus),
    volatility: ecartType(recents.map(b => b.dTotal)),
    bestMonth: meilleur ? { delta: meilleur.dTotal, date: meilleur.row.Date } : null,
    totalMonths: rows.length,
  };
}

// Relevé le plus proche de `mois` mois avant le dernier, s'il en existe un à
// moins de 20 jours de cette date (sinon null).
function releveIlYA(rows, mois) {
  const dernier = parseLocalDate(rows[rows.length - 1].Date);
  const cible = new Date(dernier.getFullYear(), dernier.getMonth() - mois, dernier.getDate());
  let meilleur = null;
  let ecartMin = Infinity;
  rows.forEach(r => {
    const ecart = Math.abs(joursEntre(cible, parseLocalDate(r.Date)));
    if (ecart < ecartMin) { ecartMin = ecart; meilleur = r; }
  });
  return ecartMin <= 20 ? meilleur : null;
}

// ---------- Rendement annualisé ----------
// Taux r tel que la somme des flux actualisés soit nulle (TRI). Chaque flux
// est { t: années depuis le début, montant } — négatif pour un versement,
// positif pour une valeur récupérée. Renvoie null s'il n'y a pas de solution.
function xirr(flux) {
  const van = (r) => flux.reduce((s, f) => s + f.montant / Math.pow(1 + r, f.t), 0);
  let bas = -0.99;
  let haut = 10;
  let vanBas = van(bas);
  const vanHaut = van(haut);
  if (!isFinite(vanBas) || !isFinite(vanHaut) || vanBas * vanHaut >= 0) return null;
  for (let i = 0; i < 100; i++) {
    const milieu = (bas + haut) / 2;
    const v = van(milieu);
    if (v * vanBas > 0) { bas = milieu; vanBas = v; } else { haut = milieu; }
  }
  return (bas + haut) / 2;
}

// Rendement annualisé d'un placement depuis le premier relevé, pondéré par
// les dates de versement : la valeur de départ compte comme un versement
// initial, chaque hausse du capital investi comme un versement fait à
// mi-chemin entre deux relevés. Renvoie null avec moins de 6 mois de recul
// (un taux annualisé sur quelques mois n'a pas de sens).
function rendementAnnualise(rows, valeur, capital) {
  if (rows.length < 2) return null;
  const debut = parseLocalDate(rows[0].Date);
  const annees = (iso) => joursEntre(debut, parseLocalDate(iso)) / 365.25;
  const duree = annees(rows[rows.length - 1].Date);
  if (duree < 0.5) return null;

  const flux = [{ t: 0, montant: -valeur(rows[0]) }];
  for (let i = 1; i < rows.length; i++) {
    const versement = capital(rows[i]) - capital(rows[i - 1]);
    if (versement !== 0) {
      flux.push({ t: (annees(rows[i - 1].Date) + annees(rows[i].Date)) / 2, montant: -versement });
    }
  }
  flux.push({ t: duree, montant: valeur(rows[rows.length - 1]) });
  return xirr(flux);
}

// ---------- Charges fixes (CHARGES est défini dans config.js) ----------
function chargesPayeesMontant(jour = new Date().getDate()) {
  return CHARGES.filter(c => c.jour <= jour).reduce((s, c) => s + c.montant, 0);
}

function chargesRestantesMontant(jour = new Date().getDate()) {
  return CHARGES.filter(c => c.jour > jour).reduce((s, c) => s + c.montant, 0);
}

function joursRestantsDansLeMois(date = new Date()) {
  const finMois = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  return finMois - date.getDate();
}

// Nombre de prélèvements d'une charge entre deux dates (début exclu, fin
// incluse). Vaut 0 ou 1 dans le cas courant, davantage si la période couvre
// plusieurs mois.
function occurrencesCharge(charge, debut, fin) {
  const d0 = debutDuJour(debut);
  const d1 = debutDuJour(fin);
  let n = 0;
  for (let mois = new Date(d0.getFullYear(), d0.getMonth(), 1); mois <= d1; mois = new Date(mois.getFullYear(), mois.getMonth() + 1, 1)) {
    const dernierJour = new Date(mois.getFullYear(), mois.getMonth() + 1, 0).getDate();
    const prelevement = new Date(mois.getFullYear(), mois.getMonth(), Math.min(charge.jour, dernierJour));
    if (prelevement > d0 && prelevement <= d1) n++;
  }
  return n;
}

// ---------- Mini-calculatrice ----------
// Évalue "1200 + 350 - 80" sans eval(), pour additionner plusieurs comptes.
// Renvoie null pour une saisie vide, lève une erreur si l'expression est invalide.
function evaluerExpression(expr) {
  const clean = String(expr).trim()
    .replace(/[\u00a0\u202f]/g, ' ')
    // "1 201,50" collé depuis une appli bancaire : on retire l'espace des
    // milliers, mais "1200 350" (un + oublié) doit rester une erreur.
    .replace(/\d[\d ]*\d/g, (groupe) => (/^\d{1,3}( \d{3})+$/.test(groupe) ? groupe.replace(/ /g, '') : groupe))
    .replace(/,/g, '.');
  if (clean === '') return null;
  if (!/^[0-9+\-*/().\s]+$/.test(clean)) throw new Error('caractères invalides');

  let pos = 0;
  const peek = () => clean[pos];
  const skipSpaces = () => { while (/\s/.test(clean[pos] || '')) pos++; };

  function parseNombre() {
    skipSpaces();
    const start = pos;
    while (pos < clean.length && /[0-9.]/.test(clean[pos])) pos++;
    if (pos === start) throw new Error('nombre attendu');
    return parseFloat(clean.slice(start, pos));
  }
  function parseFacteur() {
    skipSpaces();
    if (peek() === '(') {
      pos++;
      const v = parseSomme();
      skipSpaces();
      if (peek() !== ')') throw new Error('parenthèse manquante');
      pos++;
      return v;
    }
    if (peek() === '-') { pos++; return -parseFacteur(); }
    if (peek() === '+') { pos++; return parseFacteur(); }
    return parseNombre();
  }
  function parseProduit() {
    let v = parseFacteur();
    skipSpaces();
    while (peek() === '*' || peek() === '/') {
      const op = peek(); pos++;
      v = op === '*' ? v * parseFacteur() : v / parseFacteur();
      skipSpaces();
    }
    return v;
  }
  function parseSomme() {
    let v = parseProduit();
    skipSpaces();
    while (peek() === '+' || peek() === '-') {
      const op = peek(); pos++;
      v = op === '+' ? v + parseProduit() : v - parseProduit();
      skipSpaces();
    }
    return v;
  }

  const result = parseSomme();
  skipSpaces();
  if (pos !== clean.length) throw new Error('expression invalide');
  if (!isFinite(result)) throw new Error('résultat invalide');
  return result;
}
