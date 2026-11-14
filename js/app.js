// ========== APPLICATION ==========
// Affichage du dashboard à partir des relevés du Google Sheet.
// Les calculs sont dans calculs.js, les données personnelles dans config.js.

const state = {
  model: null,              // dernier jeu de données affiché
  sourceLabel: '',          // d'où il vient ("cache du …", "fichier …")
  charts: {},               // graphiques Chart.js, par id de <canvas>
  chartRange: 0,            // nombre de mois affichés dans les graphiques (0 = tout)
  projectionTouched: false, // l'apport mensuel a été réglé à la main
  loadSeq: 0,               // numéro du dernier chargement lancé
};

// Dernier relevé Google Sheet, lu par quotidien.js comme point de référence
// pour estimer les dépenses. Reste null tant qu'aucune donnée n'est chargée.
let sheetReference = null;

const CHART_RANGE_KEY = 'patrimoine_chart_range';

// ---------- Outils d'affichage ----------
const $ = (id) => document.getElementById(id);

const nf0 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const vraiMoins = (s) => s.replace('-', '−');

// Math.round peut donner -0, que Intl afficherait "-0".
const fmt = (n) => vraiMoins(nf0.format(Math.round(n) || 0));
const fmt2 = (n) => vraiMoins(nf2.format(n));
const fmtSigned = (n) => (Math.round(n) >= 0 ? '+' : '') + fmt(n);
const fmtK = (n) => (Math.abs(n) >= 1000 ? dec(n / 1000) + ' k' : fmt(n));

// Nombre décimal à la française ("12,5"), sans "-0,0".
function dec(n, decimales = 1) {
  const s = n.toFixed(decimales);
  return vraiMoins(parseFloat(s) === 0 ? s.replace('-', '') : s).replace('.', ',');
}
const signedDec = (n, decimales = 1) => (parseFloat(n.toFixed(decimales)) >= 0 ? '+' : '') + dec(n, decimales);

const formatDate = (iso, options) => {
  const d = parseLocalDate(iso);
  return d ? d.toLocaleDateString('fr-FR', options) : iso;
};
const monthLabel = (iso) => formatDate(iso, { month: 'short', year: '2-digit' });
const moisAnnee = (iso) => formatDate(iso, { month: 'long', year: 'numeric' });
const dateLongue = (iso) => formatDate(iso, { day: 'numeric', month: 'long', year: 'numeric' });
const dateHeure = (date) => date.toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const signe = (n) => (n >= 0 ? 'pos' : 'neg');
const pluriel = (n, mot) => `${n} ${mot}${n > 1 ? 's' : ''}`;

function setStatus(text, cls = '') {
  const el = $('status');
  el.textContent = text;
  el.className = 'status ' + cls;
}

// ---------- Modèle ----------
// Tout ce que les sections affichent, calculé une seule fois par chargement.
function buildModel(rows) {
  const breakdown = monthlyBreakdown(rows);
  const latest = rows[rows.length - 1];
  const capital = capInvested(latest);
  const pv = pvLatente(latest);
  const recul = (key) => rendementAnnualise(rows, r => r[key] || 0, r => r[key + '_Invest'] || 0);

  const postes = POSTES.map(p => {
    const valeur = latest[p.key] || 0;
    const investi = latest[p.key + '_Invest'] || 0;
    const suivi = investi > 0;
    return {
      ...p, valeur, investi, suivi,
      pv: suivi ? valeur - investi : null,
      pvPct: suivi ? (valeur - investi) / investi * 100 : null,
      tri: suivi ? recul(p.key) : null,
    };
  });

  return {
    rows, breakdown, latest, postes,
    first: rows[0],
    previous: rows.length > 1 ? rows[rows.length - 2] : null,
    stats: computeStats(rows, breakdown),
    total: totalAssets(latest),
    net: netOf(latest),
    investi: investedValue(latest),
    capital, pv,
    pvPct: capital > 0 ? pv / capital * 100 : 0,
    tri: rendementAnnualise(rows, investedValue, capInvested),
  };
}

// ---------- Rendu ----------
const SECTIONS = [
  ['En-tête', renderHeader],
  ['Patrimoine net', renderHero],
  ['Jalons', renderJalons],
  ['Budget du mois', renderBudgetRestant],
  ['Performance', renderPerformance],
  ['Détail par poste', renderPostes],
  ['Indicateurs', renderKpis],
  ['Analyse avancée', renderStatsAvancees],
  ['Variation mensuelle', renderDelta],
  ['Graphiques', renderCharts],
  ['Projections', setupProjections],
  ['Allocation', renderAllocation],
  ['Historique', renderHistoryTable],
  ['Pilotage quotidien', () => renderQuotidien()],
];

// Affiche le dashboard. Chaque section est isolée : si l'une échoue, les
// autres s'affichent quand même. Renvoie le nom des sections en échec.
function renderDashboard(rows) {
  const m = buildModel(rows);
  state.model = m;
  sheetReference = { liquidites: m.latest.Liquidites, date: m.latest.Date };

  const echecs = [];
  SECTIONS.forEach(([nom, render]) => {
    try {
      render(m);
    } catch (err) {
      console.error(`Section « ${nom} » :`, err);
      echecs.push(nom);
    }
  });

  $('helpBox').classList.add('hidden');
  $('dashboard').classList.remove('hidden');
  $('sectionNav').classList.remove('hidden');
  updateNav();
  return echecs;
}

function renderHeader(m) {
  $('lastUpdate').textContent = moisAnnee(m.latest.Date);
  $('userAge').textContent = CURRENT_AGE;
  $('avgRev').textContent = fmt(m.stats.avgRev);
}

function renderHero(m) {
  $('net-worth').textContent = fmt(m.net);
  $('heroSub').textContent = `Relevé du ${dateLongue(m.latest.Date)}`;
  $('assets-total').textContent = fmt(m.total) + ' €';
  $('debt-total').textContent = '− ' + fmt(m.latest.Dette) + ' €';
  $('invested-total').textContent = fmt(m.investi) + ' €';
  $('liquid-total').textContent = fmt(m.latest.Liquidites) + ' €';
  $('caution-total').textContent = fmt(m.latest.Caution) + ' €';
  $('caution-total').closest('.item').hidden = !(m.latest.Caution > 0);

  const evolution = (ancien, libelle) => {
    const base = netOf(ancien);
    const delta = m.net - base;
    const pct = base !== 0 ? dec(delta / Math.abs(base) * 100) : '—';
    return `<div class="hero-delta ${delta >= 0 ? 'up' : 'down'}">${delta >= 0 ? '↑' : '↓'} ${fmtSigned(delta)} € · ${pct} % ${libelle}</div>`;
  };
  const ilYAUnAn = releveIlYA(m.rows, 12);
  $('heroDeltas').innerHTML =
    (m.previous ? evolution(m.previous, 'sur 1 mois') : '') +
    (ilYAUnAn ? evolution(ilYAUnAn, 'sur 12 mois') : '');
}

function renderJalons(m) {
  const { avgDelta } = m.stats;
  const cibleFinale = JALONS[JALONS.length - 1];
  const pctFinal = Math.max(0, Math.min(m.net / cibleFinale * 100, 100));

  // Nombre de mois pour atteindre une cible au rythme actuel, ou null si le
  // patrimoine ne progresse pas.
  const moisPour = (cible) => (avgDelta > 0 ? Math.ceil((cible - m.net) / avgDelta) : null);
  const dateEstimee = (mois) => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth() + mois, 1).toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' });
  };

  let estimation;
  if (m.net >= cibleFinale) {
    estimation = '<span class="jalon-ok">✓ Objectif atteint !</span>';
  } else if (moisPour(cibleFinale)) {
    estimation = `<span>Estimé <strong>${dateEstimee(moisPour(cibleFinale))}</strong> (dans ${moisPour(cibleFinale)} mois)</span>`;
  } else {
    estimation = '<span>Pas d’estimation : le patrimoine ne progresse pas en ce moment</span>';
  }

  const prochain = JALONS.find(cible => m.net < cible);
  const cartes = JALONS.map(cible => {
    if (m.net >= cible) {
      const franchi = m.breakdown.find(b => b.net >= cible);
      return `
        <div class="jalon-card done">
          <div class="jalon-done-badge">✓ atteint</div>
          <div class="jalon-card-label">— Jalon</div>
          <div class="jalon-card-value">${fmt(cible)} €</div>
          <div class="jalon-card-sub">Franchi en ${monthLabel(franchi.row.Date)}</div>
        </div>`;
    }
    const mois = moisPour(cible);
    return `
      <div class="jalon-card${cible === prochain ? ' next' : ''}">
        <div class="jalon-card-label">— ${cible === prochain ? 'Prochain jalon' : 'Jalon'}</div>
        <div class="jalon-card-value">${fmt(cible)} €</div>
        <div class="jalon-card-sub">${mois ? `~${mois} mois · ${dateEstimee(mois)}` : 'Hors de portée au rythme actuel'}</div>
      </div>`;
  }).join('');

  $('jalonsSection').innerHTML = `
    <div class="jalon-100k">
      <div class="jalon-100k-content">
        <div class="jalon-top">
          <div class="jalon-title">— Progression vers ${fmt(cibleFinale)} €</div>
          <div class="jalon-pct">${dec(pctFinal)} <small>%</small></div>
        </div>
        <div class="jalon-bar-track">
          <div class="jalon-bar-fill" style="width:${pctFinal}%"></div>
        </div>
        <div class="jalon-meta">
          <span>${fmt(m.net)} € <strong>actuels</strong></span>
          <span>Reste <strong>${fmt(Math.max(cibleFinale - m.net, 0))} €</strong></span>
          ${estimation}
          <span>Rythme <strong>${fmtSigned(avgDelta)} €/mois</strong></span>
        </div>
      </div>
    </div>
    <div class="jalons-row" style="--jalons:${JALONS.length}">${cartes}</div>
  `;
}

function renderBudgetRestant(m) {
  const el = $('budgetRestant');
  const revenu = m.latest.Revenu || 0;
  el.hidden = revenu === 0;
  if (revenu === 0) return;

  const jour = new Date().getDate();
  const disponible = revenu - (TOTAL_CHARGES - REMBOURSEMENT_TGV);
  const cls = disponible > 800 ? 'pos' : disponible > 300 ? 'warn' : 'neg';

  el.innerHTML = `
    <div>
      <div class="budget-label">Revenu du mois</div>
      <div class="budget-value">${fmt(revenu)} €</div>
    </div>
    <div>
      <div class="budget-label">Charges déjà passées</div>
      <div class="budget-value neg">−${fmt(chargesPayeesMontant(jour))} €</div>
    </div>
    <div>
      <div class="budget-label">Reste à imputer</div>
      <div class="budget-value warn">−${fmt(chargesRestantesMontant(jour))} €</div>
    </div>
    <div>
      <div class="budget-label">Disponible net (après Circana)</div>
      <div class="budget-value ${cls}">${fmt(disponible)} €</div>
    </div>
  `;
}

function renderPerformance(m) {
  $('capInvested').textContent = fmt(m.capital);
  $('capCurrent').textContent = fmt(m.investi);
  $('pvAbs').textContent = fmtSigned(m.pv);
  $('pvPct').textContent = signedDec(m.pvPct);
  $('pvCell').classList.toggle('negative', m.pv < 0);
}

function renderPostes(m) {
  const echelle = Math.max(1, ...m.postes.map(p => Math.max(p.valeur, p.investi)));
  const largeur = (v) => (v / echelle) * 100;

  $('posteList').innerHTML = m.postes.map(p => {
    const nom = `
      <div class="poste-name">
        <span class="poste-dot" style="background:${p.color}"></span>
        <span>${esc(p.label)}</span>
      </div>`;
    const barreValeur = `<div class="poste-bar-value" style="width:${largeur(p.valeur)}%; background:${p.color}; opacity:0.85;"></div>`;

    if (!p.suivi) {
      return `
        <div class="poste-row">
          ${nom}
          <div class="poste-bar-cell">${barreValeur}</div>
          <div class="poste-amount-wrap"><div class="poste-amount">${fmt(p.valeur)} €</div></div>
          <div class="poste-amount dim">—</div>
          <div class="poste-pv poste-nonsuivi">non suivi</div>
          <div class="poste-perf">—</div>
        </div>`;
    }

    const cls = signe(p.pv);
    const annuel = p.tri != null ? `${signedDec(p.tri * 100)} %/an` : '';
    return `
      <div class="poste-row">
        ${nom}
        <div class="poste-bar-cell">
          <div class="poste-bar-invest" style="width:${largeur(p.investi)}%"></div>
          ${barreValeur}
        </div>
        <div class="poste-amount-wrap">
          <div class="poste-amount poste-valeur">${fmt(p.valeur)} €</div>
          <div class="poste-pv-inline ${cls}">${fmtSigned(p.pv)} € · ${signedDec(p.pvPct)} %</div>
          ${annuel ? `<div class="poste-pv-inline poste-an">${annuel}</div>` : ''}
        </div>
        <div class="poste-amount dim">${fmt(p.investi)} €</div>
        <div class="poste-pv ${cls}">${fmtSigned(p.pv)} €</div>
        <div class="poste-perf">
          <span class="poste-pct ${cls}">${signedDec(p.pvPct)} %</span>
          ${annuel ? `<span class="poste-an">${annuel}</span>` : ''}
        </div>
      </div>`;
  }).join('');

  $('posteNote').hidden = !m.postes.some(p => p.tri != null);
}

function renderKpis(m) {
  const s = m.stats;
  const petit = (unite) => `<small>${unite}</small>`;
  const couleur = (n) => `color:var(--${n >= 0 ? 'positive' : 'danger'})`;

  // Ligne 1
  $('kpiPerf').innerHTML = signedDec(m.pvPct) + petit('%');
  $('kpiPerfSub').textContent = `${fmtSigned(m.pv)} € de plus-value` + (m.tri != null ? ` · ${signedDec(m.tri * 100)} %/an` : '');

  const suivis = m.postes.filter(p => p.suivi).sort((a, b) => b.pvPct - a.pvPct);
  if (suivis.length) {
    const meilleur = suivis[0];
    const pire = suivis[suivis.length - 1];
    $('kpiBest').textContent = `${meilleur.label} / ${pire.label}`;
    $('kpiBestSub').innerHTML =
      `<span style="${couleur(meilleur.pvPct)}">${signedDec(meilleur.pvPct)} %</span> / ` +
      `<span style="${couleur(pire.pvPct)}">${signedDec(pire.pvPct)} %</span>`;
  }

  $('kpiDelta').innerHTML = fmt(s.avgDelta) + petit(' €');
  $('kpiDeltaSub').textContent = 'Moyenne sur 12 derniers mois';

  $('kpiEffort').innerHTML = fmt(s.avgEffort) + petit(' €');
  $('kpiEffortSub').textContent = `Hors marché · dont ${fmt(s.avgVersements)} € investis`;

  // Ligne 2
  const tauxEpargne = s.avgRev > 0 ? s.avgEffort / s.avgRev * 100 : null;
  const epargneSub = $('kpiSaveRateSub');
  if (tauxEpargne == null) {
    $('kpiSaveRate').textContent = '—';
    epargneSub.className = 'kpi-note';
    epargneSub.textContent = 'Revenu non renseigné';
  } else {
    $('kpiSaveRate').innerHTML = dec(tauxEpargne, 0) + petit('%');
    epargneSub.className = 'kpi-note' + (tauxEpargne >= 30 ? ' pos' : tauxEpargne >= 15 ? '' : ' neg');
    epargneSub.textContent = tauxEpargne >= 30 ? 'Excellent · > 30 %' : tauxEpargne >= 15 ? 'Bien · 15-30 %' : 'À améliorer';
  }

  $('kpiMarket').innerHTML = fmtSigned(s.avgMarket) + petit(' €');
  $('kpiMarketSub').textContent = s.avgMarket < 0
    ? 'Marché négatif en moyenne'
    : `Le marché ajoute ${dec(s.avgEffort > 0 ? s.avgMarket / s.avgEffort * 100 : 0, 0)} % à votre épargne`;

  $('kpiRatio').innerHTML = dec(m.total > 0 ? m.investi / m.total * 100 : 0, 0) + petit('%');
  $('kpiRatioSub').textContent = `${fmt(m.investi)} € investis / ${fmt(m.total)} € actifs`;

  // Dépenses estimées = revenu − épargne réelle (plancher à 500 €).
  if (s.avgRev > 0) {
    const depenses = Math.max(s.avgRev - s.avgEffort, 500);
    $('kpiRunway').innerHTML = dec(m.latest.Liquidites / depenses) + petit(' mois');
    $('kpiRunwaySub').textContent = `Liquide dispo / ${fmt(depenses)} € est. (caution exclue)`;
  } else {
    $('kpiRunway').textContent = '—';
    $('kpiRunwaySub').textContent = 'Revenu non renseigné';
  }

  // Ligne 3
  const detteInitiale = m.first.Dette;
  $('kpiDebt').innerHTML = fmt(m.latest.Dette) + petit(' €');
  $('kpiDebtSub').textContent = detteInitiale > 0
    ? `Sur ${fmt(detteInitiale)} € initiaux · ${Math.round((detteInitiale - m.latest.Dette) / detteInitiale * 100)} % remboursés`
    : 'Aucune dette suivie';

  $('kpiMonths').innerHTML = s.totalMonths + petit(' mois');
  $('kpiMonthsSub').textContent = `Depuis ${monthLabel(m.first.Date)}`;

  if (s.bestMonth) {
    $('kpiBestMonth').innerHTML = fmtSigned(s.bestMonth.delta) + petit(' €');
    $('kpiBestMonthSub').textContent = `En ${monthLabel(s.bestMonth.date)}`;
  }

  $('kpiVol').innerHTML = '±' + fmt(s.volatility) + petit(' €');
  $('kpiVolSub').textContent = 'Écart-type des variations mensuelles';
}

function renderStatsAvancees(m) {
  const el = $('statsAvancees');
  if (m.rows.length < 3) { el.innerHTML = ''; return; }

  const ligne = (label, valeur, cls = '') => `
    <div class="stat-row">
      <div class="stat-row-label">${label}</div>
      <div class="stat-row-value ${cls}">${valeur}</div>
    </div>`;
  const carte = (titre, contenu) => `<div class="stat-card"><div class="stat-card-title">${titre}</div>${contenu}</div>`;

  const variations = m.breakdown.slice(1);

  // Carte 1 : plus longues séries de mois en hausse / en baisse.
  const series = { pos: { max: 0, debut: '' }, neg: { max: 0, debut: '' } };
  let longueur = 0;
  let debut = '';
  let sens = null;
  variations.forEach(b => {
    const s = b.dTotal >= 0 ? 'pos' : 'neg';
    if (s !== sens) { sens = s; longueur = 0; debut = monthLabel(b.row.Date); }
    longueur++;
    if (longueur > series[s].max) series[s] = { max: longueur, debut };
  });
  const positifs = variations.filter(b => b.dTotal > 0).length;

  const carteSeries = carte('📈 Séquences de performance',
    ligne('Meilleure série positive', `${series.pos.max} mois consécutifs`, 'pos') +
    ligne('Débutée en', series.pos.debut || '—') +
    ligne('Pire série négative', `${series.neg.max} mois consécutifs`, 'neg') +
    ligne('Débutée en', series.neg.debut || '—') +
    ligne(`Mois positifs sur ${variations.length}`, `${positifs} mois (${Math.round(positifs / variations.length * 100)} %)`, 'pos'));

  // Carte 2 : un mois "prime" est un mois dont le revenu dépasse de 20 % le
  // revenu médian.
  const revenus = m.rows.map(r => r.Revenu).filter(v => v > 0).sort((a, b) => a - b);
  let cartePrimes = '';
  let revenuNormal = 0;
  if (revenus.length) {
    const seuil = revenus[Math.floor(revenus.length / 2)] * 1.2;
    const normaux = m.breakdown.filter(b => b.row.Revenu > 0 && b.row.Revenu <= seuil);
    const primes = m.breakdown.filter(b => b.row.Revenu > seuil);
    const hausseMoyenne = (groupe) => moyenne(groupe.map(b => b.dTotal || 0));
    const moyNormal = hausseMoyenne(normaux);
    const moyPrime = hausseMoyenne(primes);
    revenuNormal = moyenne(normaux.map(b => b.row.Revenu));

    cartePrimes = carte('🎯 Mois normaux vs mois primes',
      ligne('Seuil "prime" estimé', `> ${fmt(seuil)} €/mois`) +
      ligne(`Mois normaux (${normaux.length})`, `${fmtSigned(moyNormal)} €/mois`, signe(moyNormal)) +
      ligne(`Mois primes (${primes.length})`, primes.length ? `${fmtSigned(moyPrime)} €/mois` : '—', primes.length ? signe(moyPrime) : '') +
      ligne('Écart mois prime vs normal', primes.length ? `${fmtSigned(moyPrime - moyNormal)} €` : '—', primes.length ? signe(moyPrime - moyNormal) : '') +
      ligne('Primes par an (observé)', `~${dec(primes.length / (m.rows.length / 12))} mois`));
  }

  // Carte 3 : tendance des liquidités sur les 6 derniers relevés.
  const liquidites = m.rows.slice(-6).map(r => r.Liquidites);
  const tendance = (liquidites[liquidites.length - 1] - liquidites[0]) / (liquidites.length - 1);
  const actuelles = m.latest.Liquidites;
  const moisAvantSeuil = tendance < 0 ? Math.floor((actuelles - SEUIL_LIQUIDITE_ALERTE) / -tendance) : Infinity;

  let alerte = 'ok';
  let message = `✓ Liquidités saines · tendance ${fmtSigned(tendance)} €/mois (6 derniers mois).`;
  if (actuelles < SEUIL_LIQUIDITE_DANGER) {
    alerte = 'danger';
    message = `⚠ Niveau critique — sous ${fmt(SEUIL_LIQUIDITE_DANGER)} €. Pensez à renflouer.`;
  } else if (actuelles < SEUIL_LIQUIDITE_ALERTE) {
    alerte = 'warn';
    message = `⚡ Niveau bas — sous ${fmt(SEUIL_LIQUIDITE_ALERTE)} €. Gardez un œil.`;
  } else if (tendance < -200 && moisAvantSeuil < 6) {
    alerte = 'warn';
    message = `📉 Tendance baissière — seuil d'alerte dans ~${moisAvantSeuil} mois à ce rythme.`;
  }

  const carteLiquidites = carte('💧 Tendance liquidités',
    ligne('Liquidités actuelles', `${fmt(actuelles)} €`, actuelles < SEUIL_LIQUIDITE_ALERTE ? 'warn' : '') +
    ligne('Tendance 6 derniers mois', `${fmtSigned(tendance)} €/mois`, tendance >= 0 ? 'pos' : 'warn') +
    ligne("Seuil d'alerte", `${fmt(SEUIL_LIQUIDITE_ALERTE)} €`) +
    ligne('Min historique', `${fmt(Math.min(...m.rows.map(r => r.Liquidites)))} €`, 'warn') +
    `<div class="liq-alert ${alerte}">${message}</div>`);

  // Carte 4 : poids des charges fixes avant / après remboursement du TGV Max.
  const tgv = CHARGES.find(c => /tgv/i.test(c.nom));
  let carteTgv = '';
  if (tgv && REMBOURSEMENT_TGV > 0) {
    const taux = (charges) => (revenuNormal > 0 ? `${dec(charges / revenuNormal * 100)} % du revenu` : '—');
    carteTgv = carte('🚄 Impact remboursement TGV Max',
      ligne('Coût brut TGV Max', `−${fmt(tgv.montant)} €/mois`, 'neg') +
      ligne('Remboursement Circana', `+${fmt(REMBOURSEMENT_TGV)} €/mois`, 'pos') +
      ligne('Coût net réel', `${fmt(tgv.montant - REMBOURSEMENT_TGV)} €/mois`) +
      ligne('Taux charges brut', taux(TOTAL_CHARGES), 'warn') +
      ligne('Taux charges net (après remb.)', taux(TOTAL_CHARGES - REMBOURSEMENT_TGV), 'pos') +
      ligne('Économie annuelle Circana', `+${fmt(REMBOURSEMENT_TGV * 12)} €/an`, 'pos'));
  }

  el.innerHTML = carteSeries + cartePrimes + carteLiquidites + carteTgv;
}

// Variation du dernier mois : total = effort + marché.
function renderDelta(m) {
  const dernier = m.breakdown[m.breakdown.length - 1];
  if (dernier.dTotal == null) return;

  const afficher = (id, valeur) => {
    $(id).textContent = fmtSigned(valeur) + ' €';
    $(id).className = 'delta-value mono ' + signe(valeur);
  };
  afficher('deltaTotal', dernier.dTotal);
  afficher('deltaEpargne', dernier.dEffort);
  afficher('deltaMarche', dernier.dMarche);
  $('deltaTotalSub').textContent = `${monthLabel(m.previous.Date)} → ${monthLabel(m.latest.Date)}`;
  $('deltaEpargneSub').textContent = 'Apports + dette remboursée · hors marché';
  $('deltaMarcheSub').textContent = dernier.dMarche >= 0 ? 'Marchés favorables ce mois' : 'Marchés défavorables ce mois';
}

// ---------- Graphiques ----------
const POLICE_MONO = 'JetBrains Mono';
const VERT = '61, 107, 69';
const ROUGE = '147, 58, 42';
const OR = '139, 107, 47';

// Crée (ou recrée) un graphique. Si Chart.js n'a pas pu être chargé, le
// reste du dashboard doit rester utilisable : on affiche un simple message.
function makeChart(id, config) {
  if (state.charts[id]) { state.charts[id].destroy(); delete state.charts[id]; }
  const canvas = $(id);
  const boite = canvas.parentElement;
  let message = boite.querySelector('.chart-missing');

  if (typeof Chart === 'undefined') {
    if (!message) {
      message = document.createElement('p');
      message.className = 'chart-missing';
      message.textContent = 'Graphique indisponible : la bibliothèque Chart.js n’a pas pu être chargée. Vérifiez votre connexion puis actualisez la page.';
      boite.appendChild(message);
    }
    canvas.hidden = true;
    return;
  }
  if (message) message.remove();
  canvas.hidden = false;
  state.charts[id] = new Chart(canvas, config);
}

function chartBaseOpts(unit) {
  const ticks = { font: { family: POLICE_MONO, size: 10 }, color: '#857e72' };
  return {
    responsive: true, maintainAspectRatio: false,
    interaction: { intersect: false, mode: 'index' },
    plugins: {
      legend: { position: 'top', align: 'end', labels: { font: { family: POLICE_MONO, size: 11 }, color: '#4a4640', usePointStyle: true, padding: 16 } },
      tooltip: {
        backgroundColor: '#1a1815',
        titleFont: { family: 'Fraunces', size: 13, style: 'italic' },
        bodyFont: { family: POLICE_MONO, size: 12 }, padding: 12,
        callbacks: { label: (ctx) => ` ${ctx.dataset.label || 'Valeur'} : ${fmt(ctx.parsed.y)} ${unit}` },
      },
    },
    scales: {
      x: { grid: { color: '#d4cec0' }, ticks: { ...ticks, maxTicksLimit: 12, maxRotation: 0 } },
      y: { grid: { color: '#d4cec0' }, ticks: { ...ticks, callback: (v) => fmtK(v) + unit } },
    },
  };
}

// Périodes proposées pour les graphiques, selon la longueur de l'historique.
function chartRangeOptions(m) {
  return [12, 24].filter(n => m.rows.length > n).concat(0);
}

function renderChartTools(m) {
  const options = chartRangeOptions(m);
  if (!options.includes(state.chartRange)) state.chartRange = 0;
  const html = options.length < 2 ? '' : options.map(n =>
    `<button type="button" class="chart-range${n === state.chartRange ? ' active' : ''}" data-range="${n}">${n ? `${n} mois` : 'Tout'}</button>`
  ).join('');
  document.querySelectorAll('.chart-tools').forEach(el => { el.innerHTML = html; });
}

function renderCharts(m) {
  renderChartTools(m);

  const b = state.chartRange ? m.breakdown.slice(-state.chartRange) : m.breakdown;
  const labels = b.map(x => monthLabel(x.row.Date));
  const efforts = b.map(x => x.dEffort || 0);
  const marches = b.map(x => x.dMarche || 0);
  const valeurs = b.map(x => investedValue(x.row));
  const plusValues = b.map(x => x.pv);
  const base = chartBaseOpts('€');
  const selonSigne = (xs, positif, negatif) => xs.map(v => (v >= 0 ? positif : negatif));
  const courbe = (label, data, extra) => ({ label, data, tension: 0.35, pointRadius: 2, pointHoverRadius: 5, backgroundColor: 'transparent', ...extra });

  makeChart('deltaChart', {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Votre effort (épargne)', data: efforts, stack: 'stack', borderWidth: 1, borderRadius: 2,
          backgroundColor: selonSigne(efforts, `rgba(${VERT}, 0.80)`, `rgba(${ROUGE}, 0.80)`),
          borderColor: selonSigne(efforts, `rgb(${VERT})`, `rgb(${ROUGE})`),
        },
        {
          label: 'Contribution marché', data: marches, stack: 'stack', borderWidth: 1, borderRadius: 2,
          backgroundColor: selonSigne(marches, `rgba(${OR}, 0.60)`, `rgba(${ROUGE}, 0.40)`),
          borderColor: selonSigne(marches, `rgb(${OR})`, `rgb(${ROUGE})`),
        },
      ],
    },
    options: {
      ...base,
      plugins: {
        ...base.plugins,
        tooltip: {
          ...base.plugins.tooltip,
          callbacks: {
            label: (ctx) => ` ${ctx.dataset.label} : ${fmtSigned(ctx.parsed.y)} €`,
            afterBody: (items) => ['─────────', ` Total : ${fmtSigned(efforts[items[0].dataIndex] + marches[items[0].dataIndex])} €`],
          },
        },
      },
      scales: {
        x: { ...base.scales.x, stacked: true, grid: { display: false } },
        y: { ...base.scales.y, stacked: true, ticks: { ...base.scales.y.ticks, callback: (v) => fmtSigned(v) + '€' } },
      },
    },
  });

  makeChart('investVsValueChart', {
    type: 'line',
    data: {
      labels,
      datasets: [
        courbe('Valeur de marché', valeurs, { borderColor: '#1a1815', backgroundColor: 'rgba(26, 24, 21, 0.08)', borderWidth: 2.5, pointRadius: 2.5, pointHoverRadius: 6, fill: true }),
        courbe('Capital investi', b.map(x => capInvested(x.row)), { borderColor: `rgb(${OR})`, backgroundColor: `rgba(${OR}, 0.10)`, borderWidth: 2, borderDash: [6, 5], fill: '-1' }),
      ],
    },
    options: base,
  });

  makeChart('pvChart', {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data: plusValues, borderWidth: 1, borderRadius: 2,
        backgroundColor: selonSigne(plusValues, `rgba(${VERT}, 0.75)`, `rgba(${ROUGE}, 0.75)`),
        borderColor: selonSigne(plusValues, `rgb(${VERT})`, `rgb(${ROUGE})`),
      }],
    },
    options: { ...base, plugins: { ...base.plugins, legend: { display: false } } },
  });

  makeChart('historyChart', {
    type: 'line',
    data: {
      labels,
      datasets: [
        courbe('Patrimoine net', b.map(x => x.net), { borderColor: '#1a1815', backgroundColor: 'rgba(26, 24, 21, 0.08)', borderWidth: 2.5, pointRadius: 2.5, pointHoverRadius: 6, fill: true }),
        courbe('Investi (valeur)', valeurs, { borderColor: `rgb(${OR})`, borderWidth: 2, borderDash: [5, 4] }),
        courbe('Liquidités', b.map(x => x.row.Liquidites), { borderColor: '#857e72', borderWidth: 1.5, borderDash: [2, 3] }),
      ],
    },
    options: base,
  });
}

// ---------- Projections ----------
function setupProjections(m) {
  const apport = $('projApport');
  const taux = $('projRate');
  const annees = $('projYears');

  // Par défaut, l'apport mensuel est la moyenne des versements observés sur
  // les placements ; un réglage manuel est conservé d'une actualisation à l'autre.
  if (!state.projectionTouched) {
    apport.value = Math.max(0, Math.round(m.stats.avgVersements / 50) * 50);
  }

  const update = () => {
    const tauxPct = parseFloat(taux.value);
    $('projApportVal').textContent = fmt(parseFloat(apport.value));
    $('projRateVal').textContent = dec(tauxPct);
    $('projYearsVal').textContent = annees.value;
    renderProjection(m, parseFloat(apport.value), tauxPct / 100, parseInt(annees.value, 10));
  };
  apport.oninput = () => { state.projectionTouched = true; update(); };
  taux.oninput = update;
  annees.oninput = update;
  update();
}

function renderProjection(m, apportMensuel, tauxAnnuel, annees) {
  const depart = m.net;
  const scenarios = [
    { name: 'Pessimiste', rate: tauxAnnuel * 0.5, color: '#857e72' },
    { name: 'Central', rate: tauxAnnuel, color: `rgb(${OR})`, central: true },
    { name: 'Optimiste', rate: tauxAnnuel * 1.5, color: `rgb(${VERT})` },
  ];

  const trajectoire = (taux) => {
    const points = [depart];
    let capital = depart;
    for (let annee = 1; annee <= annees; annee++) {
      for (let mois = 0; mois < 12; mois++) capital = capital * (1 + taux / 12) + apportMensuel;
      points.push(capital);
    }
    return points;
  };
  const central = trajectoire(tauxAnnuel);
  const base = chartBaseOpts('€');

  makeChart('projChart', {
    type: 'line',
    data: {
      labels: central.map((_, annee) => `${CURRENT_AGE + annee} ans`),
      datasets: scenarios.map(sc => ({
        label: sc.name,
        data: sc.central ? central : trajectoire(sc.rate),
        borderColor: sc.color,
        backgroundColor: sc.central ? `rgba(${OR}, 0.10)` : 'transparent',
        borderWidth: sc.central ? 2.5 : 1.5,
        borderDash: sc.central ? [] : [4, 4],
        tension: 0.35, pointRadius: 0, pointHoverRadius: 5,
        fill: !!sc.central,
      })),
    },
    options: {
      ...base,
      plugins: {
        ...base.plugins,
        tooltip: { ...base.plugins.tooltip, callbacks: { label: (ctx) => ` ${ctx.dataset.label} : ${fmtK(ctx.parsed.y)}€` } },
      },
    },
  });

  // Jusqu'à 4 étapes : 5, 10, 20, 30 ans et l'horizon choisi.
  const etapes = [5, 10, 20, 30].filter(a => a < annees).concat(annees).slice(-4);
  $('projMilestones').innerHTML = etapes.map(a => {
    const valeur = central[a];
    const marche = valeur - depart - apportMensuel * 12 * a;
    return `
      <div class="milestone">
        <div class="milestone-age">${CURRENT_AGE + a} ans · dans ${a} ans</div>
        <div class="milestone-value">${fmtK(valeur)}€</div>
        <div class="milestone-sub">× ${depart > 0 ? dec(valeur / depart) : '—'} · dont ${fmtK(marche)}€ de marché</div>
      </div>`;
  }).join('');
}

// ---------- Allocation ----------
function renderAllocation(m) {
  const parts = [
    ...m.postes.map(p => ({ name: p.label, note: p.note, value: p.valeur, color: p.color })),
    { name: 'Liquidités', note: 'Courant + Livret', value: m.latest.Liquidites, color: '#857e72' },
    { name: 'Caution appart.', note: 'Bloqué · récupérable', value: m.latest.Caution || 0, color: '#4a7b8c' },
  ].filter(a => a.value > 0).sort((a, b) => b.value - a.value);

  const part = (v) => dec(v / m.total * 100);

  $('allocList').innerHTML = parts.map(a => `
    <div class="alloc-row">
      <span class="alloc-dot" style="background:${a.color}"></span>
      <div class="alloc-name">${esc(a.name)}<small>${esc(a.note)}</small></div>
      <span class="alloc-amount">${fmt(a.value)} €</span>
      <span class="alloc-pct">${part(a.value)} %</span>
    </div>`).join('');

  makeChart('allocChart', {
    type: 'doughnut',
    data: {
      labels: parts.map(a => a.name),
      datasets: [{
        data: parts.map(a => a.value),
        backgroundColor: parts.map(a => a.color),
        borderColor: '#f4f1ea', borderWidth: 3, hoverOffset: 12,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '68%',
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1a1815',
          titleFont: { family: 'Fraunces', size: 14, style: 'italic' },
          bodyFont: { family: POLICE_MONO, size: 12 }, padding: 12,
          callbacks: { label: (ctx) => ` ${fmt(ctx.parsed)} € · ${part(ctx.parsed)} %` },
        },
      },
    },
  });
}

// ---------- Historique ----------
function renderHistoryTable(m) {
  const variation = (v) => (v == null ? '<td class="vide">—</td>' : `<td class="delta-${signe(v)}">${fmtSigned(v)}</td>`);

  $('historyTable').innerHTML = [...m.breakdown].reverse().map(({ row: r, net, pv, dTotal, dEffort, dMarche }) => `
    <tr>
      <td>${monthLabel(r.Date)}</td>
      <td>${fmt(r.PEA)}</td>
      <td>${fmt(r.AV)}</td>
      <td>${fmt(r.PEE)}</td>
      <td>${fmt(r.CTO)}</td>
      <td>${fmt(r.Crypto)}</td>
      <td>${fmt(r.Liquidites)}</td>
      <td class="discret">${fmt(r.Dette)}</td>
      <td class="highlight">${fmt(net)}</td>
      ${variation(dTotal)}
      ${variation(dEffort)}
      ${variation(dMarche)}
      <td class="delta-${signe(pv)}">${fmtSigned(pv)}</td>
      ${r.Revenu > 0 ? `<td class="doux">${fmt(r.Revenu)} €</td>` : '<td class="vide">—</td>'}
    </tr>`).join('');
}

// ---------- Exports ----------
function historyData(m) {
  return [...m.breakdown].reverse().map(b => ({
    mois: monthLabel(b.row.Date),
    date: b.row.Date,
    PEA: b.row.PEA, AV: b.row.AV, PEE: b.row.PEE, CTO: b.row.CTO,
    Crypto: b.row.Crypto, Liquide: b.row.Liquidites,
    Dette: b.row.Dette, Net: b.net,
    dTotal: b.dTotal, dEffort: b.dEffort, dMarche: b.dMarche, pv: b.pv,
    Revenu: b.row.Revenu || 0,
  }));
}

function exportHistoryCSV() {
  if (!state.model) return;
  const entetes = ['Date', 'Mois', 'PEA', 'AV', 'PEE', 'CTO', 'Crypto', 'Liquide', 'Dette', 'Net', 'Δ Total', 'Δ Effort', 'Δ Marché', 'PV latente', 'Revenu'];
  const lignes = historyData(state.model).map(r => [
    r.date, r.mois, r.PEA, r.AV, r.PEE, r.CTO, r.Crypto, r.Liquide, r.Dette, r.Net,
    r.dTotal ?? '', r.dEffort ?? '', r.dMarche ?? '', r.pv, r.Revenu,
  ].join(','));
  // Le BOM permet à Excel de reconnaître l'UTF-8.
  download('\uFEFF' + [entetes.join(','), ...lignes].join('\n'), 'historique-patrimoine.csv', 'text/csv');
}

function buildMarkdown(m) {
  const montant = (n) => Math.round(n).toLocaleString('fr-FR') + ' €';
  const variation = (n) => (n == null ? '—' : (n >= 0 ? '+' : '') + montant(n));
  const r = m.latest;

  let md = '# Patrimoine — Historique mensuel\n\n';
  md += `**Dernière mise à jour :** ${moisAnnee(r.Date)}\n\n`;
  md += '## Résumé au dernier mois\n\n';
  md += '| Indicateur | Valeur |\n|---|---|\n';
  md += `| Patrimoine net | ${montant(m.net)} |\n`;
  md += `| Capital investi | ${montant(m.capital)} |\n`;
  md += `| Plus-value latente | ${variation(m.pv)} (${m.pvPct.toFixed(1)} %) |\n`;
  md += `| PEA | ${montant(r.PEA)} |\n`;
  md += `| Assurance-vie | ${montant(r.AV)} |\n`;
  md += `| PEE | ${montant(r.PEE)} |\n`;
  md += `| CTO | ${montant(r.CTO)} |\n`;
  md += `| Crypto | ${montant(r.Crypto)} |\n`;
  md += `| Liquidités | ${montant(r.Liquidites)} |\n`;
  md += `| Dette restante | ${montant(r.Dette)} |\n\n`;

  md += '## Historique complet\n\n';
  md += '| Mois | PEA | AV | PEE | CTO | Crypto | Liquide | Dette | **Net** | Δ Total | Δ Effort | Δ Marché | PV latente | Revenu |\n';
  md += '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|\n';
  historyData(m).forEach(h => {
    md += `| ${h.mois} | ${montant(h.PEA)} | ${montant(h.AV)} | ${montant(h.PEE)} | ${montant(h.CTO)} | ${montant(h.Crypto)} | ${montant(h.Liquide)} | ${montant(h.Dette)} | **${montant(h.Net)}** | ${variation(h.dTotal)} | ${variation(h.dEffort)} | ${variation(h.dMarche)} | ${variation(h.pv)} | ${h.Revenu ? montant(h.Revenu) : '—'} |\n`;
  });
  return md;
}

function exportHistoryMarkdown() {
  if (!state.model) return;
  download(buildMarkdown(state.model), 'historique-patrimoine.md', 'text/markdown');
}

async function copyHistoryMarkdown(bouton) {
  if (!state.model) return;
  try {
    await navigator.clipboard.writeText(buildMarkdown(state.model));
  } catch {
    exportHistoryMarkdown(); // presse-papiers refusé : on télécharge à la place
    return;
  }
  const libelle = bouton.textContent;
  bouton.textContent = '✓ Copié !';
  bouton.classList.add('copied');
  setTimeout(() => {
    bouton.textContent = libelle;
    bouton.classList.remove('copied');
  }, 2500);
}

function download(content, filename, type) {
  const url = URL.createObjectURL(new Blob([content], { type: type + ';charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------- Charges fixes (indépendant du Sheet) ----------
function renderCharges() {
  const jour = new Date().getDate();
  const payees = CHARGES.filter(c => c.jour <= jour);
  const restantes = CHARGES.filter(c => c.jour > jour);
  const prochaine = restantes[0];

  $('chargesTotalMensuel').textContent = fmt2(TOTAL_CHARGES);
  $('chargesPayees').innerHTML = fmt2(chargesPayeesMontant(jour)) + '<small> €</small>';
  $('chargesPayeesSub').textContent = `${pluriel(payees.length, 'charge')} prélevée${payees.length > 1 ? 's' : ''} (jours 1–${jour})`;
  $('chargesRestantes').innerHTML = fmt2(chargesRestantesMontant(jour)) + '<small> €</small>';
  $('chargesRestantesSub').textContent = `${pluriel(restantes.length, 'charge')} à venir ce mois`;

  let cumul = 0;
  const lignes = CHARGES.map(c => {
    cumul += c.montant;
    const etat = c.jour < jour ? 'done' : c.jour === jour ? 'today' : c === prochaine ? 'next' : '';
    const badge = {
      done: '<span class="tl-badge done-badge">✓ fait</span>',
      today: '<span class="tl-badge today-badge">aujourd\'hui</span>',
      next: '<span class="tl-badge next-badge">prochain</span>',
    }[etat] || '';
    return `
      <div class="timeline-row ${etat}">
        <div class="tl-day${etat === 'today' ? ' today-day' : ''}"><span class="day-num">${c.jour}</span>du mois</div>
        <div class="tl-name">${esc(c.nom)}${badge}</div>
        <div class="tl-amount">${fmt2(c.montant)} €</div>
        <div class="tl-cumul">${fmt2(cumul)} €</div>
      </div>`;
  }).join('');

  $('chargesTimeline').innerHTML = `
    <div class="timeline-header">
      <div>Jour</div>
      <div>Charge</div>
      <div class="droite">Montant</div>
      <div class="droite">Cumulé</div>
    </div>
    ${lignes}`;

  if (prochaine) {
    const attente = prochaine.jour - jour;
    $('chargesNext').innerHTML = `
      <span class="next-icon">⏳</span>
      <span>Prochaine charge : <strong>${esc(prochaine.nom)}</strong> — <strong>${fmt2(prochaine.montant)} €</strong> dans <strong>${pluriel(attente, 'jour')}</strong> (jour ${prochaine.jour})</span>`;
  } else {
    $('chargesNext').innerHTML = '<span class="next-icon">✅</span><span>Toutes les charges du mois ont été prélevées.</span>';
  }
}

// ---------- Chargement des données ----------
function readCache() {
  try {
    const text = localStorage.getItem(STORAGE_KEY);
    const date = localStorage.getItem(STORAGE_KEY + '_date');
    return text ? { text, date: date ? new Date(date) : null } : null;
  } catch {
    return null;
  }
}

function writeCache(text) {
  try {
    localStorage.setItem(STORAGE_KEY, text);
    localStorage.setItem(STORAGE_KEY + '_date', new Date().toISOString());
  } catch {}
}

async function fetchText(url, delaiMs) {
  const controller = new AbortController();
  const minuteur = setTimeout(() => controller.abort(), delaiMs);
  try {
    const res = await fetch(url, { redirect: 'follow', cache: 'no-store', signal: controller.signal });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(minuteur);
  }
}

// Lit le Sheet en direct puis, en dernier recours, via des relais CORS.
// Renvoie { text, parsed, source } ou { error } si rien d'exploitable.
async function fetchSheet() {
  const adresse = encodeURIComponent(SHEET_URL);
  const sources = [
    SHEET_URL,
    `https://api.allorigins.win/raw?url=${adresse}`,
    `https://corsproxy.io/?${adresse}`,
    `https://proxy.cors.sh/${SHEET_URL}`,
    `https://thingproxy.freeboard.io/fetch/${SHEET_URL}`,
  ];
  let error = null;
  for (const [i, url] of sources.entries()) {
    const text = await fetchText(url, i === 0 ? 20000 : 8000);
    if (!text) continue;
    try {
      return { text, parsed: parseCSV(text), source: i === 0 ? 'direct' : new URL(url).hostname };
    } catch (err) {
      error = err; // réponse reçue mais illisible : on tente la source suivante
    }
  }
  return { error };
}

// Affiche des relevés déjà lus et renvoie les remarques à signaler
// (lignes du Sheet écartées, sections en échec).
function showData(parsed, sourceLabel) {
  const echecs = renderDashboard(parsed.rows);
  state.sourceLabel = sourceLabel;
  const remarques = [];
  if (parsed.ignored.length) {
    remarques.push(`${pluriel(parsed.ignored.length, 'ligne')} ignorée${parsed.ignored.length > 1 ? 's' : ''} (${parsed.ignored.join(', ')})`);
  }
  if (echecs.length) remarques.push(`section${echecs.length > 1 ? 's' : ''} en erreur : ${echecs.join(', ')}`);
  return remarques;
}

function showStatus(prefixe, parsed, remarques) {
  const texte = [prefixe, `${parsed.rows.length} mois`, ...remarques].join(' · ');
  setStatus((remarques.length ? '⚠ ' : '✓ ') + texte, remarques.length ? 'warn' : 'ok');
}

async function loadFromSheet() {
  const seq = ++state.loadSeq;

  // Le cache s'affiche tout de suite ; le Sheet le remplace dès qu'il répond.
  const cache = readCache();
  if (!state.model && cache) {
    try {
      showData(parseCSV(cache.text), cache.date ? `cache du ${dateHeure(cache.date)}` : 'cache local');
    } catch {}
  }
  setStatus(state.model ? 'Actualisation depuis le Google Sheet…' : 'Connexion au Google Sheet…');

  const res = await fetchSheet();
  if (seq !== state.loadSeq) return; // un autre chargement a été lancé entre-temps

  if (res.parsed) {
    try {
      const remarques = showData(res.parsed, `Google Sheet lu le ${dateHeure(new Date())}`);
      writeCache(res.text);
      showStatus(`Google Sheet · via ${res.source}`, res.parsed, remarques);
    } catch (err) {
      console.error(err);
      setStatus(`✗ Affichage impossible : ${err.message}`, 'err');
    }
    return;
  }

  const raison = res.error ? `Google Sheet illisible : ${res.error.message}` : 'Google Sheet inaccessible';
  if (state.model) {
    setStatus(`⚠ ${raison} · affichage : ${state.sourceLabel}`, 'warn');
    return;
  }
  setStatus(`✗ ${raison}`, 'err');
  $('helpBox').classList.remove('hidden');
  $('helpBox').innerHTML = `
    <h3>Données indisponibles</h3>
    <p>${esc(raison)}.</p>
    <p>Vérifiez votre connexion puis cliquez sur <strong>« Actualiser »</strong>. Vous pouvez aussi exporter le Sheet
    (Fichier → Télécharger → CSV) et glisser le fichier sur cette page.</p>`;
}

async function handleFile(file) {
  state.loadSeq++; // un fichier choisi à la main prime sur un chargement du Sheet en cours
  try {
    const parsed = parseCSV(await file.text());
    const remarques = showData(parsed, `fichier ${file.name}`);
    showStatus(`${file.name} (local)`, parsed, remarques);
  } catch (err) {
    setStatus('✗ ' + err.message, 'err');
  }
}

function clearCache() {
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(STORAGE_KEY + '_date');
  } catch {}
  state.loadSeq++;
  state.model = null;
  sheetReference = null;
  $('dashboard').classList.add('hidden');
  $('sectionNav').classList.add('hidden');
  $('helpBox').classList.remove('hidden');
  $('helpBox').innerHTML = `
    <h3>Cache local effacé</h3>
    <p>Cliquez sur <strong>« Actualiser »</strong> pour recharger depuis Google Sheets, ou glissez un fichier CSV.</p>`;
  setStatus('Cache local effacé.');
  renderQuotidien();
}

// ---------- Navigation entre sections ----------
// Surligne dans la barre le lien de la section en cours de lecture : la
// dernière dont le titre est passé sous la barre.
let updateNav = () => {};

function initNav() {
  const nav = $('sectionNav');
  const liens = [...nav.querySelectorAll('a')];
  const cibles = liens.map(a => document.querySelector(a.getAttribute('href')));
  let actif = null;
  let enAttente = false;

  const actualiser = () => {
    enAttente = false;
    if (nav.classList.contains('hidden')) return;
    const seuil = nav.getBoundingClientRect().bottom + 24;
    let courant = liens[0];
    cibles.forEach((cible, i) => { if (cible.getBoundingClientRect().top <= seuil) courant = liens[i]; });
    if (courant === actif) return;
    actif = courant;
    liens.forEach(a => a.classList.toggle('active', a === actif));
    nav.scrollTo({ left: actif.offsetLeft - (nav.clientWidth - actif.clientWidth) / 2, behavior: 'smooth' });
  };
  const planifier = () => {
    if (enAttente) return;
    enAttente = true;
    requestAnimationFrame(actualiser);
  };
  window.addEventListener('scroll', planifier, { passive: true });
  window.addEventListener('resize', planifier);
  updateNav = planifier;
}

// ---------- Événements ----------
function initEvents() {
  $('refreshBtn').addEventListener('click', loadFromSheet);
  $('clearBtn').addEventListener('click', clearCache);
  $('loadBtn').addEventListener('click', () => $('fileInput').click());
  $('fileInput').addEventListener('change', (e) => {
    if (e.target.files[0]) handleFile(e.target.files[0]);
    e.target.value = ''; // permet de recharger le même fichier
  });

  $('exportCsvBtn').addEventListener('click', exportHistoryCSV);
  $('exportMdBtn').addEventListener('click', exportHistoryMarkdown);
  $('copyMdBtn').addEventListener('click', (e) => copyHistoryMarkdown(e.currentTarget));

  // Choix de la période des graphiques (un jeu de boutons par graphique).
  document.addEventListener('click', (e) => {
    const bouton = e.target.closest('.chart-range');
    if (!bouton || !state.model) return;
    state.chartRange = parseInt(bouton.dataset.range, 10);
    try { localStorage.setItem(CHART_RANGE_KEY, state.chartRange); } catch {}
    renderCharts(state.model);
  });

  // Glisser-déposer d'un CSV n'importe où sur la page.
  const barre = $('dataBar');
  let profondeur = 0;
  document.addEventListener('dragenter', (e) => { e.preventDefault(); profondeur++; barre.classList.add('drag-over'); });
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('dragleave', () => { if (--profondeur <= 0) { profondeur = 0; barre.classList.remove('drag-over'); } });
  document.addEventListener('drop', (e) => {
    e.preventDefault();
    profondeur = 0;
    barre.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (!file) return;
    if (/\.csv$/i.test(file.name)) handleFile(file);
    else setStatus('✗ Glissez un fichier .csv', 'err');
  });
}

// ---------- Démarrage ----------
try { state.chartRange = parseInt(localStorage.getItem(CHART_RANGE_KEY), 10) || 0; } catch {}
initEvents();
initNav();
renderCharges();
initQuotidien();
loadFromSheet();
