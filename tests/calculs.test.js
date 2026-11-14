// Tests des calculs (js/calculs.js). Lancer avec : node tests/calculs.test.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const lire = (f) => fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8');
const exportes = [
  'parseDate', 'parseLocalDate', 'joursEntre', 'parseNumber', 'splitCSV', 'parseCSV',
  'totalAssets', 'netOf', 'investedValue', 'capInvested', 'monthlyBreakdown', 'computeStats',
  'releveIlYA', 'xirr', 'rendementAnnualise', 'occurrencesCharge', 'chargesPayeesMontant',
  'chargesRestantesMontant', 'evaluerExpression', 'CHARGES', 'TOTAL_CHARGES',
];
const c = vm.runInNewContext(`${lire('config.js')}\n${lire('calculs.js')}\n;({ ${exportes.join(', ')} })`);

let reussis = 0;
function test(nom, fn) {
  try {
    fn();
    reussis++;
  } catch (e) {
    console.error(`✗ ${nom}\n  ${e.message}`);
    process.exitCode = 1;
  }
}
const proche = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} attendu ≈ ${b}, obtenu ${a}`);

const ENTETE = 'Date,Compte courant,Crypto,Crypto Investi,PEA,PEA Investi,CTO,CTO Investi,AV,AV Investi,PEE,PEE Investi,Dette,Revenu,Caution';
const ligne = (date, o = {}) => {
  const v = { liq: 1000, cr: 0, cri: 0, pea: 0, peai: 0, cto: 0, ctoi: 0, av: 0, avi: 0, pee: 0, peei: 0, dette: 0, rev: 2000, caution: 0, ...o };
  return [date, v.liq, v.cr, v.cri, v.pea, v.peai, v.cto, v.ctoi, v.av, v.avi, v.pee, v.peei, v.dette, v.rev, v.caution].join(',');
};

// ---------- Dates ----------
test('parseDate reconnaît les formats usuels', () => {
  assert.strictEqual(c.parseDate('2026-09-03'), '2026-09-03');
  assert.strictEqual(c.parseDate('03/09/2026'), '2026-09-03');
  assert.strictEqual(c.parseDate('3/9/26'), '2026-09-03');
  assert.strictEqual(c.parseDate('03-09-2026'), '2026-09-03');
  assert.strictEqual(c.parseDate('3 sept. 2026'), '2026-09-03');
  assert.strictEqual(c.parseDate('3 septembre 2026'), '2026-09-03');
  assert.strictEqual(c.parseDate('1 août 2025'), '2025-08-01');
  assert.strictEqual(c.parseDate('15 févr. 2026'), '2026-02-15');
  assert.strictEqual(c.parseDate('2 déc. 2025'), '2025-12-02');
  assert.strictEqual(c.parseDate('2026/09/03'), '2026-09-03');
  assert.strictEqual(c.parseDate('2026-09-03T00:00:00'), '2026-09-03');
  assert.strictEqual(c.parseDate('Sep 3, 2026'), '2026-09-03'); // format lu par le navigateur
});

test('parseDate rejette ce qui n’est pas une date', () => {
  assert.strictEqual(c.parseDate(''), '');
  assert.strictEqual(c.parseDate('Total'), '');
  assert.strictEqual(c.parseDate('31/02/2026'), '');
  assert.strictEqual(c.parseDate('12'), '');
  assert.strictEqual(c.parseDate('1645,50'), '');
  assert.strictEqual(c.parseDate(undefined), '');
});

test('parseLocalDate donne le bon jour quel que soit le fuseau', () => {
  const d = c.parseLocalDate('2026-09-03');
  assert.strictEqual(d.getDate(), 3);
  assert.strictEqual(d.getMonth(), 8);
  assert.strictEqual(c.parseLocalDate('pas une date'), null);
});

test('joursEntre ignore l’heure et le changement d’heure', () => {
  assert.strictEqual(c.joursEntre(new Date(2026, 8, 3, 23, 50), new Date(2026, 8, 10, 0, 5)), 7);
  assert.strictEqual(c.joursEntre(new Date(2026, 9, 20), new Date(2026, 9, 30)), 10); // passage à l'heure d'hiver
});

// ---------- Nombres ----------
test('parseNumber gère les formats français et anglais', () => {
  assert.strictEqual(c.parseNumber('1645'), 1645);
  assert.strictEqual(c.parseNumber('1 645,50'), 1645.5);
  assert.strictEqual(c.parseNumber('1 645,50 €'), 1645.5);
  assert.strictEqual(c.parseNumber('1.645,50'), 1645.5);
  assert.strictEqual(c.parseNumber('1,645.50'), 1645.5);
  assert.strictEqual(c.parseNumber('-35,2'), -35.2);
  assert.strictEqual(c.parseNumber('−35'), -35);
  assert.strictEqual(c.parseNumber('(120)'), -120);
  assert.strictEqual(c.parseNumber(''), 0);
  assert.strictEqual(c.parseNumber('n/a'), 0);
  assert.strictEqual(c.parseNumber(undefined), 0);
});

// ---------- CSV ----------
test('splitCSV respecte les guillemets', () => {
  const t = c.splitCSV('a,b,c\n1,"1 645,50","il a dit ""oui"""\n');
  assert.strictEqual(t.length, 2);
  assert.strictEqual(t[1][1], '1 645,50');
  assert.strictEqual(t[1][2], 'il a dit "oui"');
});

test('splitCSV détecte le point-virgule, ignore BOM et lignes vides', () => {
  const t = c.splitCSV('\uFEFFa;b\r\n1;2\r\n\r\n;\r\n3;4');
  assert.strictEqual(t.length, 3);
  assert.strictEqual(t[0][0], 'a');
  assert.strictEqual(t[2][1], '4');
});

test('parseCSV lit un export Google Sheets avec montants à virgule', () => {
  const csv = `${ENTETE}\n03/09/2026,"1 645,50",0,0,"10 000,00",9000,0,0,0,0,0,0,"5 000",2850,900\n`;
  const { rows, ignored } = c.parseCSV(csv);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(ignored.length, 0);
  assert.strictEqual(rows[0].Date, '2026-09-03');
  assert.strictEqual(rows[0].Liquidites, 1645.5);
  assert.strictEqual(rows[0].PEA, 10000);
  assert.strictEqual(rows[0].Dette, 5000);
  assert.strictEqual(rows[0].Caution, 900);
});

test('parseCSV trie par date et écarte lignes vides ou sans date', () => {
  const csv = [ENTETE, ligne('03/10/2026'), ligne('03/09/2026'), ligne('Total'), ligne('03/11/2026', { liq: 0, rev: 0 })].join('\n');
  const { rows, ignored } = c.parseCSV(csv);
  assert.deepStrictEqual(Array.from(rows, r => r.Date), ['2026-09-03', '2026-10-03']);
  assert.strictEqual(ignored.length, 2);
});

test('parseCSV accepte les colonnes facultatives absentes', () => {
  const csv = 'Date;Compte courant;Crypto;PEA;PEA Investi;CTO;CTO Investi;AV;AV Investi;PEE;PEE Investi;Prêt\n03/09/2026;1000;50;0;0;0;0;0;0;0;0;300';
  const { rows } = c.parseCSV(csv);
  assert.strictEqual(rows[0].Crypto_Invest, null);
  assert.strictEqual(rows[0].Revenu, null);
  assert.strictEqual(rows[0].Caution, 0);
  assert.strictEqual(rows[0].Dette, 300);
  assert.strictEqual(c.capInvested(rows[0]), 0);
});

test('parseCSV nomme les colonnes manquantes', () => {
  assert.throws(() => c.parseCSV('Date,Compte courant\n03/09/2026,1000'), /Colonnes manquantes.*PEA.*Dette/);
  assert.throws(() => c.parseCSV('Date\n'), /CSV vide/);
});

// ---------- Patrimoine ----------
const releves = c.parseCSV([
  ENTETE,
  ligne('03/01/2026', { liq: 2000, pea: 10000, peai: 9000, dette: 5000, caution: 900 }),
  ligne('03/02/2026', { liq: 2300, pea: 10700, peai: 9400, dette: 4800, caution: 900 }),
  ligne('03/03/2026', { liq: 2100, pea: 10900, peai: 9800, dette: 4600, caution: 900 }),
].join('\n')).rows;

test('totaux d’un relevé', () => {
  assert.strictEqual(c.totalAssets(releves[0]), 12900);
  assert.strictEqual(c.netOf(releves[0]), 7900);
  assert.strictEqual(c.investedValue(releves[0]), 10000);
  assert.strictEqual(c.capInvested(releves[0]), 9000);
});

test('monthlyBreakdown : effort + marché = variation totale', () => {
  const b = c.monthlyBreakdown(releves);
  assert.strictEqual(b[0].dTotal, null);
  // Février : net 7900 → 9100 ; plus-value 1000 → 1300
  assert.strictEqual(b[1].dTotal, 1200);
  assert.strictEqual(b[1].dMarche, 300);
  assert.strictEqual(b[1].dEffort, 900); // 400 versés + 300 de liquide + 200 de dette remboursée
  // Mars : la plus-value recule de 200
  assert.strictEqual(b[2].dMarche, -200);
  assert.strictEqual(b[2].dEffort + b[2].dMarche, b[2].dTotal);
});

test('computeStats : moyennes et meilleur mois', () => {
  const s = c.computeStats(releves, c.monthlyBreakdown(releves));
  assert.strictEqual(s.avgDelta, 700);        // (1200 + 200) / 2
  assert.strictEqual(s.avgEffort, 650);       // (900 + 400) / 2
  assert.strictEqual(s.avgMarket, 50);        // (300 − 200) / 2
  assert.strictEqual(s.avgVersements, 400);   // 400 puis 400
  assert.strictEqual(s.avgRev, 2000);
  assert.strictEqual(s.bestMonth.delta, 1200);
  assert.strictEqual(s.bestMonth.date, '2026-02-03'); // le mois où la hausse est constatée
});

test('computeStats avec un seul relevé ne plante pas', () => {
  const un = releves.slice(0, 1);
  const s = c.computeStats(un, c.monthlyBreakdown(un));
  assert.strictEqual(s.avgDelta, 0);
  assert.strictEqual(s.bestMonth, null);
});

test('releveIlYA retrouve le relevé d’il y a N mois', () => {
  const lignes = [ENTETE];
  for (let i = 0; i < 14; i++) lignes.push(ligne(`02/${String((i % 12) + 1).padStart(2, '0')}/${2025 + Math.floor(i / 12)}`));
  const rows = c.parseCSV(lignes.join('\n')).rows; // janv. 2025 → févr. 2026
  assert.strictEqual(c.releveIlYA(rows, 12).Date, '2025-02-02');
  assert.strictEqual(c.releveIlYA(rows, 24), null);
});

// ---------- Rendement annualisé ----------
test('xirr : 100 placés deviennent 110 en un an → 10 %', () => {
  proche(c.xirr([{ t: 0, montant: -100 }, { t: 1, montant: 110 }]), 0.10, 1e-6);
});

test('xirr : 100 placés deviennent 121 en deux ans → 10 %', () => {
  proche(c.xirr([{ t: 0, montant: -100 }, { t: 2, montant: 121 }]), 0.10, 1e-6);
});

test('xirr : perte', () => {
  proche(c.xirr([{ t: 0, montant: -100 }, { t: 1, montant: 80 }]), -0.20, 1e-6);
});

test('xirr sans solution renvoie null', () => {
  assert.strictEqual(c.xirr([{ t: 0, montant: -100 }, { t: 1, montant: -50 }]), null);
  assert.strictEqual(c.xirr([{ t: 0, montant: 0 }, { t: 1, montant: 0 }]), null);
});

test('rendementAnnualise retrouve un taux connu malgré les versements', () => {
  // Placement à 8 %/an exactement, 200 € versés au milieu de chaque mois.
  const taux = 0.08;
  const lignes = [ENTETE];
  const debut = new Date(2025, 0, 1);
  let valeur = 5000;
  let capital = 5000;
  let precedent = debut;
  for (let i = 0; i <= 18; i++) {
    const date = new Date(2025, i, 1);
    if (i > 0) {
      const jours = (date - precedent) / 86400000;
      const croissance = (j) => Math.pow(1 + taux, j / 365.25);
      valeur = valeur * croissance(jours) + 200 * croissance(jours / 2);
      capital += 200;
    }
    precedent = date;
    const jj = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    lignes.push(ligne(`${jj}/${mm}/${date.getFullYear()}`, { pea: valeur.toFixed(4), peai: capital }));
  }
  const rows = c.parseCSV(lignes.join('\n')).rows;
  proche(c.rendementAnnualise(rows, r => r.PEA, r => r.PEA_Invest), taux, 5e-4);
});

test('rendementAnnualise renvoie null avec trop peu de recul', () => {
  assert.strictEqual(c.rendementAnnualise(releves, c.investedValue, c.capInvested), null); // 2 mois
  assert.strictEqual(c.rendementAnnualise(releves.slice(0, 1), c.investedValue, c.capInvested), null);
});

// ---------- Charges fixes ----------
test('charges payées + restantes = total', () => {
  for (const jour of [1, 3, 10, 28, 31]) {
    proche(c.chargesPayeesMontant(jour) + c.chargesRestantesMontant(jour), c.TOTAL_CHARGES, 1e-9);
  }
  assert.strictEqual(c.chargesRestantesMontant(31), 0);
});

test('occurrencesCharge : début exclu, fin incluse', () => {
  const le8 = { jour: 8 };
  assert.strictEqual(c.occurrencesCharge(le8, new Date(2026, 8, 3), new Date(2026, 8, 10)), 1);
  assert.strictEqual(c.occurrencesCharge(le8, new Date(2026, 8, 8), new Date(2026, 8, 10)), 0); // déjà dans le solde du relevé
  assert.strictEqual(c.occurrencesCharge(le8, new Date(2026, 8, 3), new Date(2026, 8, 8, 9, 30)), 1);
  assert.strictEqual(c.occurrencesCharge(le8, new Date(2026, 8, 3), new Date(2026, 8, 7)), 0);
});

test('occurrencesCharge : période à cheval sur plusieurs mois', () => {
  assert.strictEqual(c.occurrencesCharge({ jour: 1 }, new Date(2026, 8, 3), new Date(2026, 9, 5)), 1);
  assert.strictEqual(c.occurrencesCharge({ jour: 28 }, new Date(2026, 8, 3), new Date(2026, 9, 5)), 1);
  assert.strictEqual(c.occurrencesCharge({ jour: 4 }, new Date(2026, 8, 3), new Date(2026, 9, 5)), 2);
  assert.strictEqual(c.occurrencesCharge({ jour: 31 }, new Date(2026, 1, 3), new Date(2026, 2, 5)), 1); // 31 → dernier jour de février
});

// ---------- Mini-calculatrice ----------
test('evaluerExpression', () => {
  assert.strictEqual(c.evaluerExpression('1200 + 350 - 80'), 1470);
  assert.strictEqual(c.evaluerExpression('1 200,50 + 0,5'), 1201);
  assert.strictEqual(c.evaluerExpression('(100 + 50) * 2'), 300);
  assert.strictEqual(c.evaluerExpression('-20 + 50'), 30);
  assert.strictEqual(c.evaluerExpression('   '), null);
  assert.strictEqual(c.evaluerExpression('12\u202f350 + 1\u00a0000'), 13350);
  assert.throws(() => c.evaluerExpression('1200 350'), /expression invalide/); // un + oublié ne doit pas donner 1 200 350
  assert.throws(() => c.evaluerExpression('1200 + abc'), /caractères invalides/);
  assert.throws(() => c.evaluerExpression('1200 +'), /nombre attendu/);
  assert.throws(() => c.evaluerExpression('(1200'), /parenthèse/);
  assert.throws(() => c.evaluerExpression('1/0'), /résultat invalide/);
});

console.log(process.exitCode ? 'Des tests ont échoué.' : `✓ ${reussis} tests réussis`);
