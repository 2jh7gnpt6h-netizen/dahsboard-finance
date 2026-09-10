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
    ${ticketResto !== 0 ? `
    <div class="quot-row">
      <div class="quot-label">Solde Ticket Restaurant</div>
      <div class="quot-value pos">+${fmt(ticketResto)} €</div>
    </div>` : ''}
    <div class="quot-row">
      <div class="quot-label">Argent disponible (compte + TR)</div>
      <div class="quot-value ${argentDisponible >= 0 ? 'pos' : 'neg'}">${fmt(argentDisponible)} €</div>
    </div>
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

  // Calcul volontairement simple, sur demande : la différence brute entre le
  // solde du dernier relevé Google Sheet et le solde actuel saisi. Aucun
  // ajustement (charges, carte, revenu) — ces montants sont déjà pris en
  // compte par l'utilisateur dans le solde qu'il saisit.
  const depenses = sheetReference.liquidites - saved.compteCourant;
  const dateReference = new Date(sheetReference.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

  el.innerHTML = `
    <div class="quot-objectif-head">
      <span class="quot-objectif-label">— Dépensé depuis le relevé Google Sheet</span>
      <span class="quot-objectif-value">${fmt(depenses)} €</span>
    </div>
    <div class="quot-objectif-sub">
      Solde du ${dateReference} (${fmt(sheetReference.liquidites)} €) − solde actuel (${fmt(saved.compteCourant)} €).
    </div>
  `;
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

    saveQuotidien({
      compteCourant,
      compteCourantExpr: compteEl.value.trim(),
      carteDiffere,
      ticketResto: ticketEl.value === '' ? null : parseFloat(ticketEl.value),
      updatedAt: new Date().toISOString(),
    });
    renderQuotidien();
  });

  renderQuotidien();
}

initQuotidien();
