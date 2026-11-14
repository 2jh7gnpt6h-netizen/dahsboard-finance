// ========== PILOTAGE QUOTIDIEN ==========
// Solde compte(s) courant(s), carte à débit différé et Ticket Restaurant
// saisis manuellement, stockés uniquement dans ce navigateur (localStorage).
// Ne modifie jamais le patrimoine : le Google Sheet reste la seule source
// de vérité pour ça. Sert uniquement à piloter le budget du quotidien
// entre deux relevés.

// Le bloc des dépenses est régénéré à chaque rendu : on garde ici l'état
// ouvert/fermé de la liste des charges.
let quotChargesOpen = false;

const chargeKey = (c) => c.jour + '_' + c.nom;

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

// Charges cochées par défaut : celles prélevées après le relevé Sheet et
// jusqu'au jour de saisie du solde.
function chargesAutoDefault(debut, fin) {
  const selection = {};
  CHARGES.forEach(c => { selection[chargeKey(c)] = occurrencesCharge(c, debut, fin) > 0; });
  return selection;
}

function renderQuotResult(saved) {
  const el = $('quotResult');
  if (saved.compteCourant == null) {
    el.innerHTML = '<p class="quot-empty">Renseignez votre solde de compte courant pour estimer votre budget disponible jusqu\'à la fin du mois.</p>';
    return;
  }

  const restantes = chargesRestantesMontant();
  const joursRestants = Math.max(joursRestantsDansLeMois(), 1);
  const carteDiffere = saved.carteDiffere || 0; // toujours ≤ 0
  const ticketResto = saved.ticketResto || 0;
  const horsTR = saved.compteCourant - restantes + carteDiffere;
  const avecTR = horsTR + ticketResto;
  const budgetJour = avecTR / joursRestants;

  const ligne = (label, valeur, cls = '') => `
    <div class="quot-row">
      <div class="quot-label">${label}</div>
      <div class="quot-value ${cls}">${valeur}</div>
    </div>`;

  el.innerHTML =
    ligne('Total compte(s) courant(s)', `${fmt(saved.compteCourant)} €`) +
    ligne('Charges fixes restantes ce mois', `−${fmt(restantes)} €`, 'neg') +
    (carteDiffere !== 0 ? ligne('Carte à débit différé (mois prochain)', `${fmt(carteDiffere)} €`, 'neg') : '') +
    ligne('Solde disponible hors Ticket Resto', `${fmt(horsTR)} €`, signe(horsTR)) +
    (ticketResto !== 0
      ? ligne('Solde Ticket Restaurant', `+${fmt(ticketResto)} €`, 'pos') +
        ligne('Solde disponible avec Ticket Resto', `${fmt(avecTR)} €`, signe(avecTR))
      : '') +
    ligne(`Budget/jour (${joursRestants} j restants)`, `${fmt(budgetJour)} €/j`, budgetJour > 20 ? 'pos' : budgetJour > 0 ? 'warn' : 'neg') +
    `<div class="quot-updated">Mis à jour ${saved.updatedAt ? dateHeure(new Date(saved.updatedAt)) : '—'}</div>`;
}

// Dépenses depuis le dernier relevé Google Sheet : total, part des charges
// fixes, et reste ("hors charges fixes").
function renderQuotObjectif(saved) {
  const el = $('quotObjectif');
  const message = (texte) => { el.innerHTML = `<p class="quot-objectif-empty">${texte}</p>`; };

  if (saved.compteCourant == null) {
    return message('Renseignez votre solde de compte courant pour suivre vos dépenses depuis le dernier relevé.');
  }
  if (!sheetReference) {
    return message('Chargez vos données (Google Sheet ou CSV) pour activer le suivi des dépenses.');
  }

  // La période va du relevé Sheet au jour où le solde a été saisi — pas à
  // "aujourd'hui", pour rester juste si la page est simplement rouverte plus tard.
  const releve = parseLocalDate(sheetReference.date);
  const saisie = saved.updatedAt ? new Date(saved.updatedAt) : new Date();
  const jours = joursEntre(releve, saisie);
  if (jours < 0) {
    return message(`Le relevé Google Sheet du ${dateLongue(sheetReference.date)} est plus récent que votre dernier solde saisi (${dateHeure(saisie)}). Saisissez votre solde actuel pour suivre vos dépenses depuis ce relevé.`);
  }

  // La sélection des charges vaut pour un relevé donné : si le relevé de
  // référence a changé, on repart de la détection automatique.
  if (!saved.chargesManuelles || (saved.chargesRef && saved.chargesRef !== sheetReference.date)) {
    saved.chargesManuelles = chargesAutoDefault(releve, saisie);
  }
  if (saved.chargesRef !== sheetReference.date) {
    saved.chargesRef = sheetReference.date;
    saveQuotidien(saved);
  }

  // Dépense totale : écart entre le solde du relevé et le solde actuel. La
  // carte à débit différé est déjà dépensée même si elle n'est pas encore
  // débitée : elle compte. On retire ensuite les charges fixes cochées.
  const carteDiffere = saved.carteDiffere || 0; // toujours ≤ 0
  const depenseTotale = sheetReference.liquidites - (saved.compteCourant + carteDiffere);
  const charges = CHARGES.map(c => ({
    ...c,
    key: chargeKey(c),
    cochee: !!saved.chargesManuelles[chargeKey(c)],
    // Une charge cochée à la main hors période compte pour un prélèvement.
    fois: Math.max(occurrencesCharge(c, releve, saisie), 1),
  }));
  const cochees = charges.filter(c => c.cochee);
  const totalCharges = cochees.reduce((s, c) => s + c.montant * c.fois, 0);
  const depenseLibre = depenseTotale - totalCharges;

  const liste = charges.map(c => `
    <label class="quot-charge-row">
      <input type="checkbox" class="quot-charge-check" data-key="${esc(c.key)}" ${c.cochee ? 'checked' : ''} />
      <span class="quot-charge-day">${c.jour}</span>
      <span class="quot-charge-name">${esc(c.nom)}</span>
      <span class="quot-charge-amount">${fmt(c.montant)} €${c.fois > 1 ? ` × ${c.fois}` : ''}</span>
    </label>`).join('');

  el.innerHTML = `
    <div class="quot-objectif-head">
      <span class="quot-objectif-label">— Dépense totale (charges fixes comprises)</span>
      <span class="quot-objectif-value">${fmt(depenseTotale)} €</span>
    </div>
    <div class="quot-objectif-sub">
      Solde du ${dateLongue(sheetReference.date)} (${fmt(sheetReference.liquidites)} €) − solde du ${saisie.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })} (${fmt(saved.compteCourant)} €)${carteDiffere !== 0 ? ` + carte à débit différé à venir (${fmt(-carteDiffere)} €)` : ''}.
    </div>

    <div class="quot-objectif-row">
      <span class="quot-objectif-sublabel">Dont charges fixes prélevées entre les deux dates</span>
      <span class="quot-objectif-subvalue neg">−${fmt(totalCharges)} €</span>
    </div>

    <details class="quot-charges-details" id="quotChargesDetails" ${quotChargesOpen ? 'open' : ''}>
      <summary class="quot-charges-summary">Voir / corriger les charges prises en compte (${cochees.length}/${CHARGES.length})</summary>
      <div class="quot-charges-list">${liste}</div>
    </details>

    <div class="quot-objectif-head quot-objectif-final">
      <span class="quot-objectif-label">— Dépense hors charges fixes</span>
      <span class="quot-objectif-value">${fmt(depenseLibre)} €</span>
    </div>
    ${jours >= 1 ? `<div class="quot-objectif-sub">Soit ${fmt(depenseLibre / jours)} €/jour en moyenne depuis le relevé (${pluriel(jours, 'jour')}).</div>` : ''}
  `;

  $('quotChargesDetails').addEventListener('toggle', (e) => { quotChargesOpen = e.currentTarget.open; });
  el.querySelectorAll('.quot-charge-check').forEach(caseACocher => {
    caseACocher.addEventListener('change', () => {
      const actuel = loadQuotidien();
      actuel.chargesManuelles = { ...actuel.chargesManuelles, [caseACocher.dataset.key]: caseACocher.checked };
      saveQuotidien(actuel);
      renderQuotObjectif(actuel);
    });
  });
}

function renderQuotidien() {
  const saved = loadQuotidien();
  const champs = { quotCompte: saved.compteCourantExpr, quotCarteDiffere: saved.carteDiffere ? Math.abs(saved.carteDiffere) : null, quotTicket: saved.ticketResto };
  Object.entries(champs).forEach(([id, valeur]) => {
    // On ne touche pas à un champ en cours de saisie.
    if (valeur != null && document.activeElement !== $(id)) $(id).value = valeur;
  });
  renderQuotResult(saved);
  renderQuotObjectif(saved);
}

function initQuotidien() {
  const compte = $('quotCompte');
  const erreur = $('quotCompteError');

  $('quotForm').addEventListener('submit', (e) => {
    e.preventDefault();

    let compteCourant;
    try {
      compteCourant = evaluerExpression(compte.value);
    } catch (err) {
      compte.classList.add('invalid');
      erreur.textContent = `Expression invalide : ${err.message}`;
      return;
    }
    compte.classList.remove('invalid');
    erreur.textContent = '';

    // La carte à débit différé est toujours une sortie d'argent : le signe
    // négatif est appliqué d'office (le clavier mobile n'a pas de touche "-").
    const carte = Math.abs(parseNumber($('quotCarteDiffere').value));
    const ticket = $('quotTicket').value;
    const maintenant = new Date();

    const data = {
      compteCourant,
      compteCourantExpr: compte.value.trim(),
      carteDiffere: carte ? -carte : 0,
      ticketResto: ticket === '' ? null : parseFloat(ticket),
      updatedAt: maintenant.toISOString(),
    };
    // Nouveau solde = nouvelle période : la détection automatique des charges
    // repart de zéro (corrigeable ensuite dans la liste).
    if (sheetReference) {
      data.chargesManuelles = chargesAutoDefault(parseLocalDate(sheetReference.date), maintenant);
      data.chargesRef = sheetReference.date;
    }

    saveQuotidien(data);
    renderQuotidien();
  });

  renderQuotidien();
}
