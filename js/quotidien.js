// ========== PILOTAGE QUOTIDIEN ==========
// Solde compte courant et Ticket Restaurant saisis manuellement, stockés
// uniquement dans ce navigateur (localStorage). Ne modifie jamais le
// patrimoine : le Google Sheet reste la seule source de vérité pour ça.
// Sert uniquement à piloter le budget du quotidien entre deux relevés.

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

function renderQuotidien() {
  const saved = loadQuotidien();
  const compteEl = document.getElementById('quotCompte');
  const ticketEl = document.getElementById('quotTicket');
  const resultEl = document.getElementById('quotResult');
  if (!compteEl || !ticketEl || !resultEl) return;

  if (document.activeElement !== compteEl && saved.compteCourant != null) compteEl.value = saved.compteCourant;
  if (document.activeElement !== ticketEl && saved.ticketResto != null) ticketEl.value = saved.ticketResto;

  if (saved.compteCourant == null) {
    resultEl.innerHTML = `<p class="quot-empty">Renseignez votre solde de compte courant pour estimer votre budget disponible jusqu'à la fin du mois.</p>`;
    return;
  }

  const today = new Date().getDate();
  const restantes = chargesRestantesMontant(today);
  const joursRestants = Math.max(joursRestantsDansLeMois(), 1);
  const soldeApresCharges = saved.compteCourant - restantes;
  const budgetJour = soldeApresCharges / joursRestants;
  const budgetCls = budgetJour > 20 ? 'pos' : budgetJour > 0 ? 'warn' : 'neg';

  resultEl.innerHTML = `
    <div class="quot-row">
      <div class="quot-label">Charges fixes restantes ce mois</div>
      <div class="quot-value neg">−${fmt(restantes)} €</div>
    </div>
    <div class="quot-row">
      <div class="quot-label">Solde prévisionnel après charges</div>
      <div class="quot-value ${soldeApresCharges >= 0 ? 'pos' : 'neg'}">${fmt(soldeApresCharges)} €</div>
    </div>
    <div class="quot-row">
      <div class="quot-label">Budget/jour (${joursRestants} j restants)</div>
      <div class="quot-value ${budgetCls}">${fmt(budgetJour)} €/j</div>
    </div>
    ${saved.ticketResto != null ? `
    <div class="quot-row">
      <div class="quot-label">Solde Ticket Restaurant</div>
      <div class="quot-value">${fmt(saved.ticketResto)} €</div>
    </div>` : ''}
    <div class="quot-updated">Mis à jour ${saved.updatedAt ? new Date(saved.updatedAt).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}</div>
  `;
}

function initQuotidien() {
  const form = document.getElementById('quotForm');
  const compteEl = document.getElementById('quotCompte');
  const ticketEl = document.getElementById('quotTicket');
  if (!form) return;

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    saveQuotidien({
      compteCourant: compteEl.value === '' ? null : parseFloat(compteEl.value),
      ticketResto: ticketEl.value === '' ? null : parseFloat(ticketEl.value),
      updatedAt: new Date().toISOString(),
    });
    renderQuotidien();
  });

  renderQuotidien();
}

initQuotidien();
