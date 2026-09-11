// ========== PILOTAGE QUOTIDIEN ==========
// Solde compte(s) courant(s), carte à débit différé et Ticket Restaurant
// saisis manuellement, stockés uniquement dans ce navigateur (localStorage).
// Ne modifie jamais le patrimoine : le Google Sheet reste la seule source
// de vérité pour ça. Sert uniquement à piloter le budget du quotidien
// entre deux relevés.

// Évalue une expression arithmétique simple ("1200 + 350 - 80") sans eval(),
// pour permettre d'additionner plusieurs comptes en toute sécurité.
function evaluerExpression(expr) {
  const clean = String(expr).trim().replace(/,/g, '.');
  if (clean === '') return null;
  if (!/^[0-9+\-*/().\s]+$/.test(clean)) throw new Error('caractères invalides');

  let pos = 0;
  const peek = () => clean[pos];
  const skipSpaces = () => { while (clean[pos] === ' ') pos++; };

  function parseNumber() {
    skipSpaces();
    const start = pos;
    while (pos < clean.length && /[0-9.]/.test(clean[pos])) pos++;
    if (pos === start) throw new Error('nombre attendu');
    return parseFloat(clean.slice(start, pos));
  }
  function parseFactor() {
    skipSpaces();
    if (peek() === '(') {
      pos++;
      const v = parseExpr();
      skipSpaces();
      if (peek() !== ')') throw new Error('parenthèse manquante');
      pos++;
      return v;
    }
    if (peek() === '-') { pos++; return -parseFactor(); }
    if (peek() === '+') { pos++; return parseFactor(); }
    return parseNumber();
  }
  function parseTerm() {
    let v = parseFactor();
    skipSpaces();
    while (peek() === '*' || peek() === '/') {
      const op = peek(); pos++;
      v = op === '*' ? v * parseFactor() : v / parseFactor();
      skipSpaces();
    }
    return v;
  }
  function parseExpr() {
    let v = parseTerm();
    skipSpaces();
    while (peek() === '+' || peek() === '-') {
      const op = peek(); pos++;
      v = op === '+' ? v + parseTerm() : v - parseTerm();
      skipSpaces();
    }
    return v;
  }

  const result = parseExpr();
  skipSpaces();
  if (pos !== clean.length) throw new Error('expression invalide');
  if (!isFinite(result)) throw new Error('résultat invalide');
  return result;
}

// Préserve l'état ouvert/fermé du détail des charges entre deux
// réaffichages (le innerHTML du bloc est régénéré à chaque rendu).
let quotChargesOpen = false;

function chargeKey(c) {
  return c.jour + '_' + c.nom;
}

// Sélection automatique par défaut : les charges dont le jour de
// prélèvement tombe strictement après le relevé Sheet et jusqu'à la date
// de saisie du solde actuel (mêmes mois dans le cas courant ; si le relevé
// date du mois précédent, on inclut aussi bien la fin de ce mois-là que le
// début du mois en cours — à affiner manuellement si besoin via la liste).
function chargesAutoDefault(sheetDate, entryDate) {
  const sheetDay = sheetDate.getDate();
  const entryDay = entryDate.getDate();
  const sameMonth = sheetDate.getFullYear() === entryDate.getFullYear() && sheetDate.getMonth() === entryDate.getMonth();
  const selection = {};
  CHARGES.forEach(c => {
    selection[chargeKey(c)] = sameMonth
      ? (c.jour > sheetDay && c.jour <= entryDay)
      : (c.jour > sheetDay || c.jour <= entryDay);
  });
  return selection;
}

function loadQuotidien() {
  try {
    return JSON.parse(localStorage.getItem(QUOTIDIEN_STORAGE_KEY)) || {};
  } catch {
    return {};
  }
}

function saveQuotidien(data) {
  try {
    localStorage.setItem(QUOTIDIEN_STORAGE_KEY, JSON.stringify(data));
  } catch {}
}

function renderQuotResult(saved) {
  const resultEl = document.getElementById('quotResult');
  if (!resultEl) return;

  if (saved.compteCourant == null) {
    resultEl.innerHTML = `<p class="quot-empty">Renseignez votre solde de compte courant pour estimer votre budget disponible jusqu'à la fin du mois.</p>`;
    return;
  }

  const today = new Date().getDate();
  const restantes = chargesRestantesMontant(today);
  const joursRestants = Math.max(joursRestantsDansLeMois(), 1);
  const carteDiffere = saved.carteDiffere || 0; // toujours ≤ 0
  const ticketResto = saved.ticketResto || 0;
  const soldeApresCharges = saved.compteCourant - restantes + carteDiffere;
  const argentDisponible = soldeApresCharges + ticketResto;
  const budgetJour = argentDisponible / joursRestants;
  const budgetCls = budgetJour > 20 ? 'pos' : budgetJour > 0 ? 'warn' : 'neg';

  resultEl.innerHTML = `
    <div class="quot-row">
      <div class="quot-label">Total compte(s) courant(s)</div>
      <div class="quot-value">${fmt(saved.compteCourant)} €</div>
    </div>
    <div class="quot-row">
      <div class="quot-label">Charges fixes restantes ce mois</div>
      <div class="quot-value neg">−${fmt(restantes)} €</div>
    </div>
    ${carteDiffere !== 0 ? `
    <div class="quot-row">
      <div class="quot-label">Carte à débit différé (mois prochain)</div>
      <div class="quot-value neg">${fmt(carteDiffere)} €</div>
    </div>` : ''}
    <div class="quot-row">
      <div class="quot-label">Solde disponible hors Ticket Resto</div>
      <div class="quot-value ${soldeApresCharges >= 0 ? 'pos' : 'neg'}">${fmt(soldeApresCharges)} €</div>
    </div>
    ${ticketResto !== 0 ? `
    <div class="quot-row">
      <div class="quot-label">Solde Ticket Restaurant</div>
      <div class="quot-value pos">+${fmt(ticketResto)} €</div>
    </div>
    <div class="quot-row">
      <div class="quot-label">Solde disponible avec Ticket Resto</div>
      <div class="quot-value ${argentDisponible >= 0 ? 'pos' : 'neg'}">${fmt(argentDisponible)} €</div>
    </div>` : ''}
    <div class="quot-row">
      <div class="quot-label">Budget/jour (${joursRestants} j restants)</div>
      <div class="quot-value ${budgetCls}">${fmt(budgetJour)} €/j</div>
    </div>
    <div class="quot-updated">Mis à jour ${saved.updatedAt ? new Date(saved.updatedAt).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}</div>
  `;
}

function renderQuotObjectif(saved) {
  const el = document.getElementById('quotObjectif');
  if (!el) return;

  if (saved.compteCourant == null) {
    el.innerHTML = `<p class="quot-objectif-empty">Renseignez votre solde de compte courant pour suivre vos dépenses depuis le dernier relevé.</p>`;
    return;
  }
  if (!sheetReference) {
    el.innerHTML = `<p class="quot-objectif-empty">Chargez vos données (Google Sheet ou CSV) pour activer le suivi des dépenses.</p>`;
    return;
  }

  // Date à laquelle le solde actuel a été saisi — c'est elle (pas "aujourd'hui")
  // qui sert de borne pour repérer les charges fixes tombées entre les deux
  // relevés, au cas où le dashboard est simplement rouvert plus tard.
  const entryDate = saved.updatedAt ? new Date(saved.updatedAt) : new Date();
  if (!saved.chargesManuelles) {
    saved.chargesManuelles = chargesAutoDefault(new Date(sheetReference.date), entryDate);
    saveQuotidien(saved);
  }

  // Dépense brute : différence entre le solde du relevé Sheet et le solde
  // actuel, carte à débit différé réintégrée (déjà dépensée, pas encore
  // débitée). On en retire ensuite les charges fixes cochées ci-dessous
  // pour isoler la dépense "libre".
  const carteDiffere = saved.carteDiffere || 0; // toujours ≤ 0
  const soldeActuelEffectif = saved.compteCourant + carteDiffere;
  const depenseBrute = sheetReference.liquidites - soldeActuelEffectif;
  const chargesSelectionnees = CHARGES.filter(c => saved.chargesManuelles[chargeKey(c)]);
  const totalCharges = chargesSelectionnees.reduce((s, c) => s + c.montant, 0);
  const depenseHorsCharges = depenseBrute - totalCharges;

  const dateReference = new Date(sheetReference.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  const dateEntree = entryDate.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

  const checklistRows = CHARGES.map(c => {
    const key = chargeKey(c);
    const checked = !!saved.chargesManuelles[key];
    return `
      <label class="quot-charge-row">
        <input type="checkbox" class="quot-charge-check" data-key="${key}" ${checked ? 'checked' : ''} />
        <span class="quot-charge-day">${c.jour}</span>
        <span class="quot-charge-name">${c.nom}</span>
        <span class="quot-charge-amount">${fmt(c.montant)} €</span>
      </label>`;
  }).join('');

  el.innerHTML = `
    <div class="quot-objectif-head">
      <span class="quot-objectif-label">— Dépense totale (charges fixes comprises)</span>
      <span class="quot-objectif-value">${fmt(depenseBrute)} €</span>
    </div>
    <div class="quot-objectif-sub">
      Solde du ${dateReference} (${fmt(sheetReference.liquidites)} €) − solde du ${dateEntree} (${fmt(saved.compteCourant)} €)${carteDiffere !== 0 ? ` + carte à débit différé à venir (${fmt(-carteDiffere)} €)` : ''}.
    </div>

    <div class="quot-objectif-row">
      <span class="quot-objectif-sublabel">Dont charges fixes prélevées entre les deux dates</span>
      <span class="quot-objectif-subvalue neg">−${fmt(totalCharges)} €</span>
    </div>

    <details class="quot-charges-details" id="quotChargesDetails" ${quotChargesOpen ? 'open' : ''}>
      <summary class="quot-charges-summary">Voir / corriger les charges prises en compte (${chargesSelectionnees.length}/${CHARGES.length})</summary>
      <div class="quot-charges-list">${checklistRows}</div>
    </details>

    <div class="quot-objectif-head quot-objectif-final">
      <span class="quot-objectif-label">— Dépense hors charges fixes</span>
      <span class="quot-objectif-value">${fmt(depenseHorsCharges)} €</span>
    </div>
  `;

  const details = document.getElementById('quotChargesDetails');
  if (details) details.addEventListener('toggle', () => { quotChargesOpen = details.open; });

  el.querySelectorAll('.quot-charge-check').forEach(cb => {
    cb.addEventListener('change', () => {
      const current = loadQuotidien();
      if (!current.chargesManuelles) current.chargesManuelles = {};
      current.chargesManuelles[cb.dataset.key] = cb.checked;
      saveQuotidien(current);
      renderQuotObjectif(current);
    });
  });
}

function renderQuotidien() {
  const saved = loadQuotidien();
  const compteEl = document.getElementById('quotCompte');
  const carteEl = document.getElementById('quotCarteDiffere');
  const ticketEl = document.getElementById('quotTicket');
  if (!compteEl || !carteEl || !ticketEl) return;

  if (document.activeElement !== compteEl && saved.compteCourantExpr != null) compteEl.value = saved.compteCourantExpr;
  if (document.activeElement !== carteEl && saved.carteDiffere) carteEl.value = Math.abs(saved.carteDiffere);
  if (document.activeElement !== ticketEl && saved.ticketResto != null) ticketEl.value = saved.ticketResto;

  renderQuotResult(saved);
  renderQuotObjectif(saved);
}

function initQuotidien() {
  const form = document.getElementById('quotForm');
  const compteEl = document.getElementById('quotCompte');
  const carteEl = document.getElementById('quotCarteDiffere');
  const ticketEl = document.getElementById('quotTicket');
  const compteErrorEl = document.getElementById('quotCompteError');
  if (!form) return;

  form.addEventListener('submit', (e) => {
    e.preventDefault();

    let compteCourant;
    try {
      compteCourant = evaluerExpression(compteEl.value);
    } catch (err) {
      compteEl.classList.add('invalid');
      compteErrorEl.textContent = `Expression invalide : ${err.message}`;
      return;
    }
    compteEl.classList.remove('invalid');
    compteErrorEl.textContent = '';

    // La carte à débit différé est toujours une sortie d'argent : on force
    // le signe négatif quel que soit ce qui a été saisi (le clavier mobile
    // ne propose pas toujours la touche "-").
    const carteBrut = carteEl.value === '' ? 0 : parseFloat(String(carteEl.value).replace(',', '.'));
    const carteDiffere = carteBrut ? -Math.abs(carteBrut) : 0;
    const updatedAt = new Date();

    const data = {
      compteCourant,
      compteCourantExpr: compteEl.value.trim(),
      carteDiffere,
      ticketResto: ticketEl.value === '' ? null : parseFloat(ticketEl.value),
      updatedAt: updatedAt.toISOString(),
    };
    // Nouvelle saisie de solde = nouvelle fenêtre de dates : on recalcule la
    // sélection automatique des charges fixes tombées entre les deux relevés
    // (l'utilisateur pourra la corriger manuellement juste après).
    if (sheetReference) {
      data.chargesManuelles = chargesAutoDefault(new Date(sheetReference.date), updatedAt);
    }

    saveQuotidien(data);
    renderQuotidien();
  });

  renderQuotidien();
}

initQuotidien();
