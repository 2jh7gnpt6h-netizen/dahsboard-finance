  let charts = {};
  let currentRows = null;

  // ========== UTILS ==========
  const fmt = (n) => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(Math.round(n));
  const fmtK = (n) => (Math.abs(n) >= 1000 ? (n/1000).toFixed(1).replace('.', ',') + ' k' : fmt(n));
  const fmtSigned = (n) => (n >= 0 ? '+' : '') + fmt(n);
  const monthLabel = (d) => {
    const dt = new Date(d);
    return isNaN(dt) ? d : dt.toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' });
  };
  const setStatus = (text, cls = '') => {
    const el = document.getElementById('status');
    el.textContent = text;
    el.className = 'status ' + cls;
  };

  // ========== DATE PARSING ==========
  const MOIS_FR = {
    'janvier':'01','janv':'01','jan':'01',
    'février':'02','fevrier':'02','févr':'02','fevr':'02','fev':'02','feb':'02',
    'mars':'03','mar':'03',
    'avril':'04','avr':'04','apr':'04',
    'mai':'05',
    'juin':'06','jun':'06',
    'juillet':'07','juil':'07','jul':'07',
    'août':'08','aout':'08',
    'septembre':'09','sept':'09','sep':'09',
    'octobre':'10','oct':'10',
    'novembre':'11','nov':'11',
    'décembre':'12','decembre':'12','déc':'12','dec':'12',
  };
  function parseDate(s) {
    if (!s) return '';
    s = String(s).trim();
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
    if (m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
    m = s.toLowerCase().match(/^(\d{1,2})\s+([a-zéèêû.]+)\s+(\d{4})/);
    if (m) {
      const day = m[1].padStart(2, '0');
      const mk = m[2].replace('.', '');
      const month = MOIS_FR[mk] || MOIS_FR[mk.replace(/é/g,'e').replace(/è/g,'e').replace(/ê/g,'e')];
      if (month) return `${m[3]}-${month}-${day}`;
    }
    return s;
  }

  // ========== CSV PARSING ==========
  function parseCSV(text) {
    const lines = text.trim().split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) throw new Error('CSV vide ou sans données.');

    // Détecter séparateur (; ou ,)
    const firstLine = lines[0];
    const sep = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';

    const rawHeaders = lines[0].split(sep).map(h => h.trim());
    const find = (re) => rawHeaders.findIndex(h => re.test(h));

    const colMap = {
      date: find(/^date$/i),
      cc: find(/compte.*courant|livret/i),
      crypto: rawHeaders.findIndex(h => /^crypto$/i.test(h)),
      cryptoInv: find(/crypto.*invest/i),
      pea: rawHeaders.findIndex(h => /^pea$/i.test(h)),
      peaInv: find(/pea.*invest/i),
      cto: rawHeaders.findIndex(h => /^cto$/i.test(h)),
      ctoInv: find(/cto.*invest/i),
      av: rawHeaders.findIndex(h => /^av$/i.test(h)),
      avInv: find(/av.*invest/i),
      pee: rawHeaders.findIndex(h => /^pee$/i.test(h)),
      peeInv: find(/pee.*invest/i),
      dette: find(/dette|pret/i),
      revenu: find(/revenu/i),
      caution: find(/caution/i),
    };

    const required = ['date', 'cc', 'crypto', 'pea', 'peaInv', 'cto', 'ctoInv', 'av', 'avInv', 'pee', 'peeInv', 'dette'];
    for (const k of required) {
      if (colMap[k] === -1) throw new Error(`Colonne manquante : ${k}`);
    }

    const parseNum = (s) => {
      if (!s || s.trim() === '') return 0;
      return parseFloat(s.replace(/\s/g, '').replace(',', '.')) || 0;
    };

    const rows = lines.slice(1).map(line => {
      const cells = line.split(sep).map(c => c.trim());
      return {
        Date: parseDate(cells[colMap.date]),
        Liquidites: parseNum(cells[colMap.cc]),
        Crypto: parseNum(cells[colMap.crypto]),
        Crypto_Invest: colMap.cryptoInv >= 0 ? parseNum(cells[colMap.cryptoInv]) : null,
        PEA: parseNum(cells[colMap.pea]),
        PEA_Invest: parseNum(cells[colMap.peaInv]),
        CTO: parseNum(cells[colMap.cto]),
        CTO_Invest: parseNum(cells[colMap.ctoInv]),
        AV: parseNum(cells[colMap.av]),
        AV_Invest: parseNum(cells[colMap.avInv]),
        PEE: parseNum(cells[colMap.pee]),
        PEE_Invest: parseNum(cells[colMap.peeInv]),
        Dette: parseNum(cells[colMap.dette]),
        Revenu: colMap.revenu >= 0 ? parseNum(cells[colMap.revenu]) : null,
        Caution: colMap.caution >= 0 ? parseNum(cells[colMap.caution]) : 0,
      };
    });

    rows.sort((a, b) => a.Date.localeCompare(b.Date));
    return rows;
  }

  // ========== CALCULATIONS ==========
  const totalAssets = r => r.PEA + r.AV + r.PEE + r.CTO + r.Crypto + r.Liquidites + (r.Caution || 0);
  const netOf = r => totalAssets(r) - r.Dette;
  const investedValue = r => r.PEA + r.AV + r.PEE + r.CTO + r.Crypto;
  const capInvested = r => r.PEA_Invest + r.AV_Invest + r.PEE_Invest + r.CTO_Invest + (r.Crypto_Invest || 0);

  function stats(rows) {
    const latest = rows[rows.length - 1];
    const first = rows[0];
    const previous = rows.length > 1 ? rows[rows.length - 2] : null;
    const last12 = rows.slice(-13); // on prend 13 points pour avoir 12 deltas

    // Deltas
    const deltasNet = [];
    const deltasCapInv = [];
    const deltasPV = [];
    for (let i = 1; i < last12.length; i++) {
      deltasNet.push(netOf(last12[i]) - netOf(last12[i-1]));
      deltasCapInv.push(capInvested(last12[i]) - capInvested(last12[i-1]));
      deltasPV.push((investedValue(last12[i]) - capInvested(last12[i])) - (investedValue(last12[i-1]) - capInvested(last12[i-1])));
    }
    const avg = arr => arr.length > 0 ? arr.reduce((a,b) => a+b, 0) / arr.length : 0;
    const std = arr => {
      if (arr.length < 2) return 0;
      const m = avg(arr);
      return Math.sqrt(arr.reduce((a,b) => a + (b-m)**2, 0) / arr.length);
    };

    // Revenu moyen
    const validRevs = rows.slice(-12).map(r => r.Revenu).filter(v => v && v > 0);
    const avgRev = validRevs.length > 0 ? avg(validRevs) : 0;

    // Meilleur mois
    let bestIdx = 0, worstIdx = 0;
    for (let i = 0; i < deltasNet.length; i++) {
      if (deltasNet[i] > deltasNet[bestIdx]) bestIdx = i;
      if (deltasNet[i] < deltasNet[worstIdx]) worstIdx = i;
    }
    // Note : on map sur rows.slice(-12) (pas last12 qui a 13 points)
    const recentRows = rows.slice(-12);

    return {
      latest, first, previous,
      avgDelta: avg(deltasNet),
      avgEffort: avg(deltasCapInv),
      avgMarket: avg(deltasPV),
      avgRev,
      volatility: std(deltasNet),
      bestMonth: { delta: deltasNet[bestIdx], date: recentRows[bestIdx]?.Date },
      worstMonth: { delta: deltasNet[worstIdx], date: recentRows[worstIdx]?.Date },
      totalMonths: rows.length,
      monthsSpan: (new Date(latest.Date) - new Date(first.Date)) / (1000 * 60 * 60 * 24 * 30.44),
    };
  }

  // ========== RENDER ==========
  function renderDashboard(rows) {
    currentRows = rows;
    const s = stats(rows);
    const { latest, first, previous, avgDelta, avgEffort, avgMarket, avgRev, volatility, bestMonth, worstMonth, totalMonths, monthsSpan } = s;

    const latestTotal = totalAssets(latest);
    const latestNet = netOf(latest);
    const latestInvVal = investedValue(latest);
    const latestCapInv = capInvested(latest);
    const latestPV = latestInvVal - latestCapInv;
    const latestPVPct = latestCapInv > 0 ? (latestPV / latestCapInv) * 100 : 0;

    // HEADER
    document.getElementById('lastUpdate').textContent = new Date(latest.Date).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
    document.getElementById('userAge').textContent = CURRENT_AGE;
    document.getElementById('avgRev').textContent = fmt(avgRev);

    // HERO
    document.getElementById('net-worth').textContent = fmt(latestNet);
    document.getElementById('assets-total').textContent = fmt(latestTotal) + ' €';
    document.getElementById('debt-total').textContent = '− ' + fmt(latest.Dette) + ' €';
    document.getElementById('invested-total').textContent = fmt(latestInvVal) + ' €';
    document.getElementById('liquid-total').textContent = fmt(latest.Liquidites) + ' €';
    const cautionEl = document.getElementById('caution-total');
    if (latest.Caution > 0) {
      cautionEl.textContent = fmt(latest.Caution) + ' €';
    } else {
      cautionEl.closest('.item').style.display = 'none';
    }

    if (previous) {
      const prevNet = netOf(previous);
      const delta = latestNet - prevNet;
      const pct = prevNet !== 0 ? ((delta / Math.abs(prevNet)) * 100).toFixed(1).replace('.', ',') : '—';
      const hd = document.getElementById('heroDelta');
      hd.className = 'hero-delta ' + (delta >= 0 ? 'up' : 'down');
      hd.innerHTML = `${delta >= 0 ? '↑' : '↓'} ${fmtSigned(delta)} € · ${pct} % sur 1 mois`;
    } else {
      document.getElementById('heroDelta').style.display = 'none';
    }

    // PERF HERO
    document.getElementById('capInvested').textContent = fmt(latestCapInv);
    document.getElementById('capCurrent').textContent = fmt(latestInvVal);
    document.getElementById('pvAbs').textContent = fmtSigned(latestPV);
    document.getElementById('pvPct').textContent = (latestPV >= 0 ? '+' : '') + latestPVPct.toFixed(1).replace('.', ',');
    document.getElementById('pvCell').classList.toggle('negative', latestPV < 0);

    // POSTE LIST
    const postes = [
      { key:'PEA',    invKey:'PEA_Invest',    color:'#1a1815', label:'PEA', note:'Bourso' },
      { key:'AV',     invKey:'AV_Invest',     color:'#5e4820', label:'Assurance-vie', note:'Mon Petit Placement' },
      { key:'PEE',    invKey:'PEE_Invest',    color:'#8b6b2f', label:'PEE', note:'Amundi' },
      { key:'CTO',    invKey:'CTO_Invest',    color:'#b08a42', label:'CTO', note:'Revolut + Bourso' },
      { key:'Crypto', invKey:'Crypto_Invest', color:'#a85a2a', label:'Crypto', note:'Coinbase + Rayn' },
    ];
    const maxV = Math.max(...postes.map(p => {
      const v = latest[p.key] || 0;
      const i = latest[p.invKey] || 0;
      return Math.max(v, i);
    }));
    const posteList = document.getElementById('posteList');
    posteList.innerHTML = '';
    const posteMetrics = [];
    postes.forEach(p => {
      const valeur = latest[p.key] || 0;
      const invest = latest[p.invKey];
      const hasInvest = invest !== null && invest !== undefined && invest > 0;
      const pv = hasInvest ? valeur - invest : null;
      const pvPctP = hasInvest ? (pv / invest) * 100 : null;
      posteMetrics.push({ ...p, valeur, invest: invest || 0, pv, pvPct: pvPctP });
      const valeurBarW = (valeur / maxV) * 100;
      const investBarW = hasInvest ? (invest / maxV) * 100 : 0;
      const row = document.createElement('div');
      row.className = 'poste-row';
      if (!hasInvest) {
        row.innerHTML = `
          <div class="poste-name">
            <span class="poste-dot" style="background:${p.color}"></span>
            <span>${p.label}</span>
          </div>
          <div class="poste-bar-cell">
            <div class="poste-bar-value" style="width:${valeurBarW}%; background:${p.color}; opacity:0.85;"></div>
          </div>
          <div class="poste-amount-wrap">
            <div class="poste-amount">${fmt(valeur)} €</div>
          </div>
          <div class="poste-amount dim">—</div>
          <div class="poste-pv" style="color:var(--ink-mute);font-style:italic;">non suivi</div>
          <div class="poste-pct" style="color:var(--ink-mute);background:transparent;">—</div>
        `;
      } else {
        const pvCls = pv >= 0 ? 'pos' : 'neg';
        const pvInline = (pv >= 0 ? '+' : '') + fmt(pv) + ' € · ' + (pv >= 0 ? '+' : '') + pvPctP.toFixed(1).replace('.', ',') + ' %';
        row.innerHTML = `
          <div class="poste-name">
            <span class="poste-dot" style="background:${p.color}"></span>
            <span>${p.label}</span>
          </div>
          <div class="poste-bar-cell">
            <div class="poste-bar-invest" style="width:${investBarW}%"></div>
            <div class="poste-bar-value" style="width:${valeurBarW}%; background:${p.color}; opacity:0.85;"></div>
          </div>
          <div class="poste-amount-wrap">
            <div class="poste-amount" style="font-size:13px;font-weight:600;">${fmt(valeur)} €</div>
            <div class="poste-pv-inline ${pvCls}">${pvInline}</div>
          </div>
          <div class="poste-amount dim">${fmt(invest)} €</div>
          <div class="poste-pv ${pvCls}">${fmtSigned(pv)} €</div>
          <div class="poste-pct ${pvCls}">${pv >= 0 ? '+' : ''}${pvPctP.toFixed(1).replace('.', ',')} %</div>
        `;
      }
      posteList.appendChild(row);
    });

    // KPIs — LIGNE 1
    document.getElementById('kpiPerf').innerHTML = (latestPV >= 0 ? '+' : '') + latestPVPct.toFixed(1).replace('.', ',') + '<small>%</small>';
    document.getElementById('kpiPerfSub').textContent = fmtSigned(latestPV) + ' € de plus-value';

    const tracked = posteMetrics.filter(p => p.pvPct !== null);
    const sorted = [...tracked].sort((a, b) => b.pvPct - a.pvPct);
    const best = sorted[0];
    const worst = sorted[sorted.length - 1];
    document.getElementById('kpiBest').textContent = `${best.label} / ${worst.label}`;
    document.getElementById('kpiBestSub').innerHTML = `<span style="color:var(--positive);">+${best.pvPct.toFixed(1).replace('.', ',')} %</span> / <span style="color:${worst.pvPct >= 0 ? 'var(--positive)' : 'var(--danger)'};">${worst.pvPct.toFixed(1).replace('.', ',')} %</span>`;

    document.getElementById('kpiDelta').innerHTML = fmt(avgDelta) + '<small> €</small>';
    document.getElementById('kpiDeltaSub').textContent = `Moyenne sur 12 derniers mois`;

    document.getElementById('kpiEffort').innerHTML = fmt(avgEffort) + '<small> €</small>';
    document.getElementById('kpiEffortSub').textContent = `Apports nets mensuels moyens`;

    // KPIs — LIGNE 2
    const saveRate = avgRev > 0 ? (avgEffort / avgRev) * 100 : 0;
    document.getElementById('kpiSaveRate').innerHTML = saveRate.toFixed(0) + '<small>%</small>';
    let saveRateClass = 'kpi-note';
    let saveRateText = '';
    if (saveRate >= 30) { saveRateClass = 'kpi-note pos'; saveRateText = 'Excellent · > 30 %'; }
    else if (saveRate >= 15) { saveRateText = 'Bien · 15-30 %'; }
    else { saveRateClass = 'kpi-note neg'; saveRateText = 'À améliorer'; }
    document.getElementById('kpiSaveRateSub').className = saveRateClass;
    document.getElementById('kpiSaveRateSub').textContent = saveRateText;

    document.getElementById('kpiMarket').innerHTML = (avgMarket >= 0 ? '+' : '') + fmt(avgMarket) + '<small> €</small>';
    const marketPct = avgEffort > 0 ? (avgMarket / avgEffort) * 100 : 0;
    document.getElementById('kpiMarketSub').textContent = avgMarket >= 0 ? `Le marché ajoute ${marketPct.toFixed(0)} % à vos apports` : 'Marché négatif en moyenne';

    const ratioInv = latestTotal > 0 ? (latestInvVal / latestTotal) * 100 : 0;
    document.getElementById('kpiRatio').innerHTML = ratioInv.toFixed(0) + '<small>%</small>';
    document.getElementById('kpiRatioSub').textContent = `${fmt(latestInvVal)} € investis / ${fmt(latestTotal)} € actifs`;

    // Runway : estimation dépenses = revenu - effort d'épargne
    const estDepenses = Math.max(avgRev - avgEffort, 500);
    const runway = estDepenses > 0 ? latest.Liquidites / estDepenses : 0;
    document.getElementById('kpiRunway').innerHTML = runway.toFixed(1).replace('.', ',') + '<small> mois</small>';
    document.getElementById('kpiRunwaySub').textContent = `Liquide dispo / ${fmt(estDepenses)} € est. (caution exclue)`;

    // KPIs — LIGNE 3
    document.getElementById('kpiDebt').innerHTML = fmt(latest.Dette) + '<small> €</small>';
    const firstDette = rows[0].Dette;
    document.getElementById('kpiDebtSub').textContent = `Sur ${fmt(firstDette)} € initiaux · ${Math.round((firstDette - latest.Dette) / firstDette * 100)} % remboursés`;

    document.getElementById('kpiMonths').innerHTML = totalMonths + '<small> mois</small>';
    document.getElementById('kpiMonthsSub').textContent = `Depuis ${monthLabel(first.Date)}`;

    document.getElementById('kpiBestMonth').innerHTML = fmtSigned(bestMonth.delta) + '<small> €</small>';
    document.getElementById('kpiBestMonthSub').textContent = bestMonth.date ? `En ${monthLabel(bestMonth.date)}` : '—';

    document.getElementById('kpiVol').innerHTML = '±' + fmt(volatility) + '<small> €</small>';
    document.getElementById('kpiVolSub').textContent = `Écart-type des variations mensuelles`;

    // ===== CHARTS =====
    Object.values(charts).forEach(c => c && c.destroy());
    charts = {};

    const histLabels = rows.map(r => monthLabel(r.Date));
    const histInvested = rows.map(capInvested);
    const histValue = rows.map(investedValue);

    // ===== DÉCOMPOSITION DELTA =====
    // Pour chaque mois M :
    //   PV latente M = investedValue(M) - capInvested(M)
    //   Δ marché = PV(M) - PV(M-1)  → ce que le marché a apporté
    //   Δ épargne = Δ(capInvested) + Δ(Liquidites) + Δ(Caution) - Δ(Dette) → votre effort réel
    //   Δ total = netOf(M) - netOf(M-1) = Δ épargne + Δ marché

    const pvLatente = rows.map(r => investedValue(r) - capInvested(r));

    if (previous) {
      const prevIdx = rows.length - 2;
      const pvM = pvLatente[rows.length - 1];
      const pvPrev = pvLatente[prevIdx];
      const deltaMarche = pvM - pvPrev;
      const deltaTotal = netOf(latest) - netOf(previous);
      const deltaEpargne = deltaTotal - deltaMarche;

      // Affichage hero delta
      const dtEl = document.getElementById('deltaTotal');
      dtEl.textContent = (deltaTotal >= 0 ? '+' : '') + fmt(deltaTotal) + ' €';
      dtEl.className = 'delta-value mono ' + (deltaTotal >= 0 ? 'pos' : 'neg');
      document.getElementById('deltaTotalSub').textContent =
        `${monthLabel(previous.Date)} → ${monthLabel(latest.Date)}`;

      const deEl = document.getElementById('deltaEpargne');
      deEl.textContent = (deltaEpargne >= 0 ? '+' : '') + fmt(deltaEpargne) + ' €';
      deEl.className = 'delta-value mono ' + (deltaEpargne >= 0 ? 'pos' : 'neg');
      document.getElementById('deltaEpargneSub').textContent =
        'Apports + dette remboursée · hors marché';

      const dmEl = document.getElementById('deltaMarche');
      dmEl.textContent = (deltaMarche >= 0 ? '+' : '') + fmt(deltaMarche) + ' €';
      dmEl.className = 'delta-value mono ' + (deltaMarche >= 0 ? 'pos' : 'neg');
      document.getElementById('deltaMarcheSub').textContent =
        deltaMarche >= 0 ? 'Marchés favorables ce mois' : 'Marchés défavorables ce mois';
    }

    // Graphique historique décomposé (barres empilées)
    const deltaEpargneHist = rows.map((r, i) => {
      if (i === 0) return 0;
      const prev = rows[i - 1];
      const dtotal = netOf(r) - netOf(prev);
      const dmarche = pvLatente[i] - pvLatente[i - 1];
      return dtotal - dmarche; // effort réel
    });
    const deltaMarcheHist = rows.map((r, i) => {
      if (i === 0) return 0;
      return pvLatente[i] - pvLatente[i - 1];
    });

    charts.delta = new Chart(document.getElementById('deltaChart'), {
      type: 'bar',
      data: {
        labels: histLabels,
        datasets: [
          {
            label: 'Votre effort (épargne)',
            data: deltaEpargneHist,
            backgroundColor: deltaEpargneHist.map(v => v >= 0 ? 'rgba(61, 107, 69, 0.80)' : 'rgba(147, 58, 42, 0.80)'),
            borderColor: deltaEpargneHist.map(v => v >= 0 ? '#3d6b45' : '#933a2a'),
            borderWidth: 1, borderRadius: 2, stack: 'stack',
          },
          {
            label: 'Contribution marché',
            data: deltaMarcheHist,
            backgroundColor: deltaMarcheHist.map(v => v >= 0 ? 'rgba(139, 107, 47, 0.60)' : 'rgba(147, 58, 42, 0.40)'),
            borderColor: deltaMarcheHist.map(v => v >= 0 ? '#8b6b2f' : '#933a2a'),
            borderWidth: 1, borderRadius: 2, stack: 'stack',
          }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { intersect: false, mode: 'index' },
        plugins: {
          legend: {
            position: 'top', align: 'end',
            labels: { font: { family: 'JetBrains Mono', size: 11 }, color: '#4a4640', usePointStyle: true, padding: 16 }
          },
          tooltip: {
            backgroundColor: '#1a1815',
            titleFont: { family: 'Fraunces', size: 13, style: 'italic' },
            bodyFont: { family: 'JetBrains Mono', size: 12 },
            padding: 12,
            callbacks: {
              afterBody: (items) => {
                const idx = items[0].dataIndex;
                const total = deltaEpargneHist[idx] + deltaMarcheHist[idx];
                return [`─────────`, ` Total : ${total >= 0 ? '+' : ''}${fmt(total)} €`];
              },
              label: (ctx) => {
                const v = ctx.parsed.y;
                return ` ${ctx.dataset.label} : ${v >= 0 ? '+' : ''}${fmt(v)} €`;
              }
            }
          }
        },
        scales: {
          x: { stacked: true, grid: { display: false }, ticks: { font: { family: 'JetBrains Mono', size: 10 }, color: '#857e72', maxTicksLimit: 12, maxRotation: 0 } },
          y: { stacked: true, grid: { color: '#d4cec0' }, ticks: { font: { family: 'JetBrains Mono', size: 10 }, color: '#857e72', callback: v => (v >= 0 ? '+' : '') + fmt(v) + '€' } }
        }
      }
    });

    charts.investVsValue = new Chart(document.getElementById('investVsValueChart'), {
      type: 'line',
      data: {
        labels: histLabels,
        datasets: [
          { label: 'Valeur de marché', data: histValue, borderColor: '#1a1815', backgroundColor: 'rgba(26, 24, 21, 0.08)', borderWidth: 2.5, tension: 0.35, pointRadius: 2.5, pointHoverRadius: 6, fill: true },
          { label: 'Capital investi', data: histInvested, borderColor: '#8b6b2f', backgroundColor: 'rgba(139, 107, 47, 0.10)', borderWidth: 2, borderDash: [6, 5], tension: 0.35, pointRadius: 2, pointHoverRadius: 5, fill: '-1' }
        ]
      },
      options: chartBaseOpts('€')
    });

    const histPV = rows.map(r => investedValue(r) - capInvested(r));
    charts.pv = new Chart(document.getElementById('pvChart'), {
      type: 'bar',
      data: {
        labels: histLabels,
        datasets: [{
          data: histPV,
          backgroundColor: histPV.map(v => v >= 0 ? 'rgba(61, 107, 69, 0.75)' : 'rgba(147, 58, 42, 0.75)'),
          borderColor: histPV.map(v => v >= 0 ? '#3d6b45' : '#933a2a'),
          borderWidth: 1, borderRadius: 2,
        }]
      },
      options: {
        ...chartBaseOpts('€'),
        plugins: {
          legend: { display: false },
          tooltip: chartBaseOpts('€').plugins.tooltip
        }
      }
    });

    const histNet = rows.map(netOf);
    const histLiquid = rows.map(r => r.Liquidites);
    charts.history = new Chart(document.getElementById('historyChart'), {
      type: 'line',
      data: {
        labels: histLabels,
        datasets: [
          { label: 'Patrimoine net', data: histNet, borderColor: '#1a1815', backgroundColor: 'rgba(26, 24, 21, 0.08)', borderWidth: 2.5, tension: 0.35, pointRadius: 2.5, pointHoverRadius: 6, fill: true },
          { label: 'Investi (valeur)', data: histValue, borderColor: '#8b6b2f', backgroundColor: 'transparent', borderWidth: 2, borderDash: [5, 4], tension: 0.35, pointRadius: 2, pointHoverRadius: 5 },
          { label: 'Liquidités', data: histLiquid, borderColor: '#857e72', backgroundColor: 'transparent', borderWidth: 1.5, borderDash: [2, 3], tension: 0.35, pointRadius: 2, pointHoverRadius: 5 }
        ]
      },
      options: chartBaseOpts('€')
    });

    // ===== ALLOCATION =====
    const allocData = [
      { name: 'PEA',              value: latest.PEA,           color: '#1a1815' },
      { name: 'Assurance-vie',    value: latest.AV,            color: '#5e4820' },
      { name: 'PEE',              value: latest.PEE,           color: '#8b6b2f' },
      { name: 'CTO',              value: latest.CTO,           color: '#b08a42' },
      { name: 'Crypto',           value: latest.Crypto,        color: '#a85a2a' },
      { name: 'Liquidités',       value: latest.Liquidites,    color: '#857e72' },
      { name: 'Caution appart.',  value: latest.Caution || 0,  color: '#4a7b8c' },
    ].filter(a => a.value > 0).sort((a, b) => b.value - a.value);

    const list = document.getElementById('allocList');
    list.innerHTML = '';
    const notes = {
      'PEA': 'Bourso', 'Assurance-vie': 'Mon Petit Placement', 'PEE': 'Amundi',
      'CTO': 'Revolut + Bourso', 'Crypto': 'Coinbase + Rayn',
      'Liquidités': 'Courant + Livret', 'Caution appart.': 'Bloqué · récupérable'
    };
    allocData.forEach(a => {
      const p = (a.value / latestTotal * 100).toFixed(1).replace('.', ',');
      const row = document.createElement('div');
      row.className = 'alloc-row';
      row.innerHTML = `
        <span class="alloc-dot" style="background:${a.color}"></span>
        <div class="alloc-name">${a.name}<small>${notes[a.name]}</small></div>
        <span class="alloc-amount">${fmt(a.value)} €</span>
        <span class="alloc-pct">${p} %</span>
      `;
      list.appendChild(row);
    });

    charts.alloc = new Chart(document.getElementById('allocChart'), {
      type: 'doughnut',
      data: {
        labels: allocData.map(a => a.name),
        datasets: [{
          data: allocData.map(a => a.value),
          backgroundColor: allocData.map(a => a.color),
          borderColor: '#f4f1ea', borderWidth: 3, hoverOffset: 12,
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '68%',
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#1a1815',
            titleFont: { family: 'Fraunces', size: 14, style: 'italic' },
            bodyFont: { family: 'JetBrains Mono', size: 12 }, padding: 12,
            callbacks: {
              label: (ctx) => ' ' + fmt(ctx.parsed) + ' € · ' + (ctx.parsed/latestTotal*100).toFixed(1) + ' %'
            }
          }
        }
      }
    });

    // ===== HISTORY TABLE =====
    const tbody = document.getElementById('historyTable');
    tbody.innerHTML = '';
    const displayRows = [...rows].reverse();
    // Pré-calculer les PV latentes dans l'ordre chronologique
    const pvByDate = {};
    rows.forEach(r => { pvByDate[r.Date] = investedValue(r) - capInvested(r); });

    displayRows.forEach((r, i) => {
      const net = netOf(r);
      const pvM = pvByDate[r.Date];
      const pvStr = (pvM >= 0 ? '+' : '') + fmt(pvM);
      const pvClass = pvM >= 0 ? 'delta-pos' : 'delta-neg';

      // Δ total, Δ effort, Δ marché
      let deltaTotalCell = '<td style="color:var(--ink-mute);">—</td>';
      let deltaEffortCell = '<td style="color:var(--ink-mute);">—</td>';
      let deltaMarcheCell = '<td style="color:var(--ink-mute);">—</td>';

      if (i + 1 < displayRows.length) {
        const prev = displayRows[i + 1];
        const pvPrev = pvByDate[prev.Date];
        const dTotal = net - netOf(prev);
        const dMarche = pvM - pvPrev;
        const dEffort = dTotal - dMarche;

        const cls = (v) => v >= 0 ? 'delta-pos' : 'delta-neg';
        deltaTotalCell  = `<td class="${cls(dTotal)}">${fmtSigned(dTotal)}</td>`;
        deltaEffortCell = `<td class="${cls(dEffort)}">${fmtSigned(dEffort)}</td>`;
        deltaMarcheCell = `<td class="${cls(dMarche)}">${fmtSigned(dMarche)}</td>`;
      }

      const revenu = r.Revenu > 0 ? fmt(r.Revenu) + ' €' : '<span style="color:var(--ink-mute);">—</span>';

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="text-align:left;">${monthLabel(r.Date)}</td>
        <td>${fmt(r.PEA)}</td>
        <td>${fmt(r.AV)}</td>
        <td>${fmt(r.PEE)}</td>
        <td>${fmt(r.CTO)}</td>
        <td>${fmt(r.Crypto)}</td>
        <td>${fmt(r.Liquidites)}</td>
        <td style="color:var(--ink-mute);">${fmt(r.Dette)}</td>
        <td class="highlight">${fmt(net)}</td>
        ${deltaTotalCell}
        ${deltaEffortCell}
        ${deltaMarcheCell}
        <td class="${pvClass}">${pvStr}</td>
        <td style="color:var(--ink-soft);">${revenu}</td>
      `;
      tbody.appendChild(tr);
    });

    // ===== PROJECTIONS =====
    // Set default apport = effort mensuel
    const apportSlider = document.getElementById('projApport');
    apportSlider.value = Math.max(0, Math.round(avgEffort / 50) * 50);
    setupProjections(rows);

    // Nouvelles sections
    renderJalons(rows);
    renderBudgetRestant(rows);
    renderStatsAvancees(rows);

    document.getElementById('helpBox').classList.add('hidden');
    document.getElementById('dashboard').classList.remove('hidden');
  }

  function chartBaseOpts(unit) {
    return {
      responsive: true, maintainAspectRatio: false,
      interaction: { intersect: false, mode: 'index' },
      plugins: {
        legend: { position: 'top', align: 'end', labels: { font: { family: 'JetBrains Mono', size: 11 }, color: '#4a4640', usePointStyle: true, padding: 16 } },
        tooltip: {
          backgroundColor: '#1a1815',
          titleFont: { family: 'Fraunces', size: 13, style: 'italic' },
          bodyFont: { family: 'JetBrains Mono', size: 12 }, padding: 12,
          callbacks: { label: (ctx) => ' ' + (ctx.dataset.label || 'Valeur') + ' : ' + fmt(ctx.parsed.y) + ' ' + unit }
        }
      },
      scales: {
        x: { grid: { color: '#d4cec0' }, ticks: { font: { family: 'JetBrains Mono', size: 10 }, color: '#857e72', maxTicksLimit: 12, maxRotation: 0 } },
        y: { grid: { color: '#d4cec0' }, ticks: { font: { family: 'JetBrains Mono', size: 10 }, color: '#857e72', callback: v => fmtK(v) + unit } }
      }
    };
  }

  // ===== PROJECTIONS =====
  function setupProjections(rows) {
    const apportInput = document.getElementById('projApport');
    const rateInput = document.getElementById('projRate');
    const yearsInput = document.getElementById('projYears');

    function update() {
      const apport = parseFloat(apportInput.value);
      const ratePct = parseFloat(rateInput.value);
      const rate = ratePct / 100;
      const years = parseInt(yearsInput.value);
      document.getElementById('projApportVal').textContent = fmt(apport);
      document.getElementById('projRateVal').textContent = ratePct.toFixed(1).replace('.', ',');
      document.getElementById('projYearsVal').textContent = years;

      renderProjection(rows, apport, rate, years);
    }

    apportInput.oninput = update;
    rateInput.oninput = update;
    yearsInput.oninput = update;
    update();
  }

  function renderProjection(rows, apportMonthly, rateAnnual, years) {
    const cap = netOf(rows[rows.length - 1]);

    // 3 scénarios : pessimiste, central, optimiste
    const scenarios = [
      { name: 'Pessimiste', rate: rateAnnual * 0.5, color: '#857e72', dash: [4, 4] },
      { name: 'Central', rate: rateAnnual, color: '#8b6b2f', dash: null },
      { name: 'Optimiste', rate: rateAnnual * 1.5, color: '#3d6b45', dash: [4, 4] },
    ];

    const datasets = [];
    const labels = [];
    for (let y = 0; y <= years; y++) labels.push(`${CURRENT_AGE + y} ans`);

    const centralPoints = [];

    scenarios.forEach(sc => {
      const mr = sc.rate / 12;
      const points = [cap];
      let capital = cap;
      for (let y = 1; y <= years; y++) {
        for (let m = 0; m < 12; m++) {
          capital = capital * (1 + mr) + apportMonthly;
        }
        points.push(capital);
      }
      if (sc.name === 'Central') {
        centralPoints.push(...points);
      }
      datasets.push({
        label: sc.name,
        data: points,
        borderColor: sc.color,
        backgroundColor: sc.name === 'Central' ? 'rgba(139, 107, 47, 0.10)' : 'transparent',
        borderWidth: sc.name === 'Central' ? 2.5 : 1.5,
        borderDash: sc.dash || [],
        tension: 0.35,
        pointRadius: 0,
        pointHoverRadius: 5,
        fill: sc.name === 'Central',
      });
    });

    if (charts.proj) charts.proj.destroy();
    charts.proj = new Chart(document.getElementById('projChart'), {
      type: 'line',
      data: { labels, datasets },
      options: {
        ...chartBaseOpts('€'),
        plugins: {
          ...chartBaseOpts('€').plugins,
          tooltip: {
            ...chartBaseOpts('€').plugins.tooltip,
            callbacks: {
              label: (ctx) => ' ' + ctx.dataset.label + ' : ' + fmtK(ctx.parsed.y) + '€'
            }
          }
        }
      }
    });

    // Milestones : 5, 10, 20, 30 ans (ou horizon max)
    const milestoneYears = [5, 10, 20, 30].filter(y => y <= years).concat(years > 30 ? [] : []);
    if (!milestoneYears.includes(years)) milestoneYears.push(years);
    const uniqueMs = [...new Set(milestoneYears)].sort((a,b) => a-b).slice(0, 4);

    const msCont = document.getElementById('projMilestones');
    msCont.innerHTML = '';
    uniqueMs.forEach(ms => {
      const val = centralPoints[ms];
      const pctVsCap = cap > 0 ? (val / cap).toFixed(1).replace('.', ',') : '—';
      const totalApports = apportMonthly * 12 * ms;
      const growth = val - cap - totalApports;
      const div = document.createElement('div');
      div.className = 'milestone';
      div.innerHTML = `
        <div class="milestone-age">${CURRENT_AGE + ms} ans · dans ${ms} ans</div>
        <div class="milestone-value">${fmtK(val)}€</div>
        <div class="milestone-sub">× ${pctVsCap} · dont ${fmtK(growth)}€ de marché</div>
      `;
      msCont.appendChild(div);
    });
  }

  // ========== GOOGLE SHEET SOURCE ==========
  // SHEET_URL et STORAGE_KEY sont définis dans config.js (source de vérité du patrimoine).
  async function loadFromSheet() {
    setStatus('Connexion au Google Sheet...', '');

    const DIRECT = SHEET_URL;
    const PROXIES = [
      `https://api.allorigins.win/raw?url=${encodeURIComponent(SHEET_URL)}`,
      `https://corsproxy.io/?${encodeURIComponent(SHEET_URL)}`,
      `https://proxy.cors.sh/${SHEET_URL}`,
      `https://thingproxy.freeboard.io/fetch/${SHEET_URL}`,
    ];

    let text = null;
    let source = '';

    // Tentative accès direct
    try {
      const res = await fetch(DIRECT, { redirect: 'follow', mode: 'cors' });
      if (res.ok) { text = await res.text(); source = 'direct'; }
    } catch {}

    // Tentative proxys en cascade
    if (!text) {
      for (const proxy of PROXIES) {
        try {
          const res = await fetch(proxy, { redirect: 'follow' });
          if (res.ok) {
            const t = await res.text();
            if (t && t.length > 50 && t.includes(',')) {
              text = t; source = new URL(proxy).hostname; break;
            }
          }
        } catch {}
      }
    }

    if (text) {
      try {
        const rows = parseCSV(text);
        if (rows.length === 0) throw new Error('Sheet vide ou mal formaté.');
        renderDashboard(rows);
        try { localStorage.setItem(STORAGE_KEY, text); } catch {}
        setStatus(`✓ Google Sheet · ${rows.length} mois · via ${source}`, 'ok');
        return;
      } catch (parseErr) {
        console.error('Parse error:', parseErr);
      }
    }

    // Fallback cache local
    const cached = localStorage.getItem(STORAGE_KEY);
    if (cached) {
      try {
        const rows = parseCSV(cached);
        renderDashboard(rows);
        setStatus(`⚠ Sheet inaccessible (CORS) · cache local · ${rows.length} mois`, '');
        return;
      } catch {}
    }

    // Échec total → invite à charger manuellement
    setStatus('✗ Impossible d\'accéder au sheet. Utilisez "Charger un CSV local" ou publiez le sheet via Fichier → Publier sur le Web.', 'err');
    document.getElementById('helpBox').classList.remove('hidden');
    document.getElementById('helpBox').innerHTML = `
      <h3>Chargement manuel requis</h3>
      <p>Le navigateur bloque l'accès direct au Google Sheet depuis un fichier local (restriction CORS).<br><br>
      <strong>Solution 1</strong> : Exportez votre Sheet en CSV (Fichier → Télécharger → CSV) et glissez-le ici.<br><br>
      <strong>Solution 2</strong> : Publiez le sheet via <strong>Fichier → Partager → Publier sur le Web → CSV</strong> et envoyez-moi l'URL — je l'intégrerai dans le dashboard.</p>
    `;
  }

  function clearCache() {
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
    currentRows = null;
    document.getElementById('dashboard').classList.add('hidden');
    document.getElementById('helpBox').classList.remove('hidden');
    document.getElementById('helpBox').innerHTML = `
      <h3>Cache local effacé</h3>
      <p>Cliquez sur <strong>"Actualiser"</strong> pour recharger depuis Google Sheets, ou glissez un fichier CSV.</p>
    `;
    setStatus('Cache local effacé.', '');
  }

  // ========== CSV LOCAL (fallback) ==========
  async function handleFile(file) {
    try {
      setStatus('Chargement fichier local...');
      const text = await file.text();
      const rows = parseCSV(text);
      if (rows.length === 0) throw new Error('Aucune donnée.');
      renderDashboard(rows);
      setStatus(`✓ ${file.name} · ${rows.length} mois (local)`, 'ok');
    } catch (err) {
      setStatus('✗ ' + err.message, 'err');
    }
  }

  // ========== EVENT LISTENERS ==========
  document.getElementById('loadBtn').addEventListener('click', () => {
    document.getElementById('fileInput').click();
  });
  document.getElementById('fileInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) handleFile(file);
  });

  // Drag & drop
  const dropZone = document.body;
  ['dragenter', 'dragover'].forEach(evt => {
    dropZone.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      document.getElementById('dataBar').classList.add('drag-over');
    });
  });
  ['dragleave', 'drop'].forEach(evt => {
    dropZone.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (evt === 'dragleave' && e.target !== dropZone && !dropZone.contains(e.relatedTarget)) return;
      document.getElementById('dataBar').classList.remove('drag-over');
    });
  });
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && file.name.endsWith('.csv')) handleFile(file);
    else setStatus('✗ Glissez un fichier .csv', 'err');
  });

  // ========== EXPORT HISTORIQUE ==========
  function buildHistoryData(rows) {
    const pvByDate = {};
    rows.forEach(r => { pvByDate[r.Date] = investedValue(r) - capInvested(r); });
    const displayRows = [...rows].reverse();

    return displayRows.map((r, i) => {
      const net = netOf(r);
      const pvM = pvByDate[r.Date];
      let dTotal = null, dEffort = null, dMarche = null;
      if (i + 1 < displayRows.length) {
        const prev = displayRows[i + 1];
        const pvPrev = pvByDate[prev.Date];
        dTotal  = net - netOf(prev);
        dMarche = pvM - pvPrev;
        dEffort = dTotal - dMarche;
      }
      return {
        mois: new Date(r.Date).toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' }),
        date: r.Date,
        PEA: r.PEA, AV: r.AV, PEE: r.PEE, CTO: r.CTO,
        Crypto: r.Crypto, Liquide: r.Liquidites,
        Dette: r.Dette, Net: net,
        dTotal, dEffort, dMarche, pv: pvM,
        Revenu: r.Revenu || 0,
      };
    });
  }

  function exportHistoryCSV() {
    if (!currentRows) return;
    const data = buildHistoryData(currentRows);
    const headers = ['Date','Mois','PEA','AV','PEE','CTO','Crypto','Liquide','Dette','Net','Δ Total','Δ Effort','Δ Marché','PV latente','Revenu'];
    const rows = data.map(r => [
      r.date, r.mois,
      r.PEA, r.AV, r.PEE, r.CTO, r.Crypto, r.Liquide, r.Dette, r.Net,
      r.dTotal ?? '', r.dEffort ?? '', r.dMarche ?? '', r.pv, r.Revenu
    ].join(','));
    const csv = [headers.join(','), ...rows].join('\n');
    download('﻿' + csv, 'historique-patrimoine.csv', 'text/csv');
  }

  function buildMarkdown(rows) {
    const data = buildHistoryData(rows);
    const latest = currentRows[currentRows.length - 1];
    const latestNet = netOf(latest);
    const latestCapInv = capInvested(latest);
    const latestPV = investedValue(latest) - latestCapInv;

    const fmtN = (n) => n == null ? '—' : (n >= 0 ? '+' : '') + Math.round(n).toLocaleString('fr-FR') + ' €';
    const fmtA = (n) => Math.round(n).toLocaleString('fr-FR') + ' €';

    let md = `# Patrimoine — Historique mensuel\n\n`;
    md += `**Dernière mise à jour :** ${new Date(latest.Date).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}\n\n`;
    md += `## Résumé au dernier mois\n\n`;
    md += `| Indicateur | Valeur |\n|---|---|\n`;
    md += `| Patrimoine net | ${fmtA(latestNet)} |\n`;
    md += `| Capital investi | ${fmtA(latestCapInv)} |\n`;
    md += `| Plus-value latente | ${fmtN(latestPV)} (${(latestPV / latestCapInv * 100).toFixed(1)} %) |\n`;
    md += `| PEA | ${fmtA(latest.PEA)} |\n`;
    md += `| Assurance-vie | ${fmtA(latest.AV)} |\n`;
    md += `| PEE | ${fmtA(latest.PEE)} |\n`;
    md += `| CTO | ${fmtA(latest.CTO)} |\n`;
    md += `| Crypto | ${fmtA(latest.Crypto)} |\n`;
    md += `| Liquidités | ${fmtA(latest.Liquidites)} |\n`;
    md += `| Dette restante | ${fmtA(latest.Dette)} |\n\n`;

    md += `## Historique complet\n\n`;
    md += `| Mois | PEA | AV | PEE | CTO | Crypto | Liquide | Dette | **Net** | Δ Total | Δ Effort | Δ Marché | PV latente | Revenu |\n`;
    md += `|---|---|---|---|---|---|---|---|---|---|---|---|---|---|\n`;
    data.forEach(r => {
      md += `| ${r.mois} | ${fmtA(r.PEA)} | ${fmtA(r.AV)} | ${fmtA(r.PEE)} | ${fmtA(r.CTO)} | ${fmtA(r.Crypto)} | ${fmtA(r.Liquide)} | ${fmtA(r.Dette)} | **${fmtA(r.Net)}** | ${fmtN(r.dTotal)} | ${fmtN(r.dEffort)} | ${fmtN(r.dMarche)} | ${fmtN(r.pv)} | ${r.Revenu ? fmtA(r.Revenu) : '—'} |\n`;
    });

    return md;
  }

  function exportHistoryMarkdown() {
    if (!currentRows) return;
    const md = buildMarkdown(currentRows);
    download(md, 'historique-patrimoine.md', 'text/markdown');
  }

  async function copyHistoryMarkdown() {
    if (!currentRows) return;
    const md = buildMarkdown(currentRows);
    try {
      await navigator.clipboard.writeText(md);
      const btn = event.target;
      btn.textContent = '✓ Copié !';
      btn.classList.add('copied');
      setTimeout(() => {
        btn.textContent = '⎘ Copier pour IA';
        btn.classList.remove('copied');
      }, 2500);
    } catch {
      exportHistoryMarkdown(); // fallback : télécharger
    }
  }

  function download(content, filename, type) {
    const blob = new Blob([content], { type: type + ';charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  }

  // ========== JALONS PATRIMONIAUX ==========
  function renderJalons(rows) {
    if (!rows || rows.length === 0) return;
    const latest = rows[rows.length - 1];
    const net = netOf(latest);
    const first = rows[0];
    const firstNet = netOf(first);

    // Delta moyen sur 12 derniers mois
    const last12 = rows.slice(-13);
    let deltas = [];
    for (let i = 1; i < last12.length; i++) {
      deltas.push(netOf(last12[i]) - netOf(last12[i-1]));
    }
    const avgDelta = deltas.reduce((a,b) => a+b, 0) / deltas.length;

    const cibleFinale = JALONS[JALONS.length - 1];
    const pctFinal = Math.min((net / cibleFinale) * 100, 100);
    const moisPourCibleFinale = net < cibleFinale && avgDelta > 0 ? Math.ceil((cibleFinale - net) / avgDelta) : 0;

    const dateEst = (mois) => {
      const d = new Date();
      d.setMonth(d.getMonth() + mois);
      return d.toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' });
    };

    const container = document.getElementById('jalonsSection');
    if (!container) return;

    // Barre 100k
    container.innerHTML = `
      <div class="jalon-100k">
        <div class="jalon-100k-content">
          <div class="jalon-top">
            <div class="jalon-title">— Progression vers ${fmt(cibleFinale)} €</div>
            <div class="jalon-pct">${pctFinal.toFixed(1).replace('.', ',')} <small>%</small></div>
          </div>
          <div class="jalon-bar-track">
            <div class="jalon-bar-fill" style="width:${pctFinal}%"></div>
          </div>
          <div class="jalon-meta">
            <span>${fmt(net)} € <strong>actuels</strong></span>
            <span>Reste <strong>${fmt(cibleFinale - net)} €</strong></span>
            ${moisPourCibleFinale > 0 ? `<span>Estimé <strong>${dateEst(moisPourCibleFinale)}</strong> (dans ${moisPourCibleFinale} mois)</span>` : '<span style="color:#7fb186">✓ Objectif atteint !</span>'}
            <span>Rythme <strong>+${fmt(avgDelta)} €/mois</strong></span>
          </div>
        </div>
      </div>
    `;

    // Jalons intermédiaires
    const jalons = JALONS.map(cible => ({ cible, label: `${fmt(cible)} €` }));

    const rowEl = document.createElement('div');
    rowEl.className = 'jalons-row';

    jalons.forEach(j => {
      const done = net >= j.cible;
      const moisJ = !done && avgDelta > 0 ? Math.ceil((j.cible - net) / avgDelta) : 0;
      const isNextJalon = !done && jalons.filter(x => net < x.cible)[0] === j;

      const card = document.createElement('div');
      card.className = 'jalon-card' + (done ? ' done' : isNextJalon ? ' next' : '');

      if (done) {
        // Trouver le mois où ce jalon a été franchi
        const franchi = rows.find(r => netOf(r) >= j.cible);
        const quand = franchi ? new Date(franchi.Date).toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' }) : '—';
        card.innerHTML = `
          <div class="jalon-done-badge">✓ atteint</div>
          <div class="jalon-card-label">— Jalon</div>
          <div class="jalon-card-value">${j.label}</div>
          <div class="jalon-card-sub">Franchi en ${quand}</div>
        `;
      } else {
        card.innerHTML = `
          <div class="jalon-card-label">— ${isNextJalon ? 'Prochain jalon' : 'Jalon'}</div>
          <div class="jalon-card-value">${j.label}</div>
          <div class="jalon-card-sub">${moisJ > 0 ? `~${moisJ} mois · ${dateEst(moisJ)}` : 'Calcul en attente'}</div>
        `;
      }
      rowEl.appendChild(card);
    });

    container.appendChild(rowEl);
  }

  // ========== BUDGET RESTANT DU MOIS ==========
  function renderBudgetRestant(rows) {
    const el = document.getElementById('budgetRestant');
    if (!el || !rows || rows.length === 0) return;

    const latest = rows[rows.length - 1];
    const revenu = latest.Revenu || 0;
    if (revenu === 0) { el.style.display = 'none'; return; }

    const today = new Date().getDate();
    const chargesPayees = chargesPayeesMontant(today);
    const chargesRestantes = chargesRestantesMontant(today);
    const chargesNettes = TOTAL_CHARGES - REMBOURSEMENT_TGV;
    const disponible = revenu - TOTAL_CHARGES;
    const cls = disponible > 800 ? 'pos' : disponible > 300 ? 'warn' : 'neg';
    const fmtB = (n) => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(Math.round(n));

    el.innerHTML = `
      <div>
        <div class="budget-label">Revenu du mois</div>
        <div class="budget-value">${fmtB(revenu)} €</div>
      </div>
      <div>
        <div class="budget-label">Charges déjà passées</div>
        <div class="budget-value neg">−${fmtB(chargesPayees)} €</div>
      </div>
      <div>
        <div class="budget-label">Reste à imputer</div>
        <div class="budget-value warn">−${fmtB(chargesRestantes)} €</div>
      </div>
      <div>
        <div class="budget-label">Disponible net (après Circana)</div>
        <div class="budget-value ${cls}">${fmtB(revenu - chargesNettes)} €</div>
      </div>
    `;
  }

  // ========== STATS AVANCÉES ==========
  function renderStatsAvancees(rows) {
    const el = document.getElementById('statsAvancees');
    if (!el || !rows || rows.length < 3) return;

    const latest = rows[rows.length - 1];
    const liqActuelle = latest.Liquidites;

    // ---- CARTE 1 : Séquences de performance ----
    const deltas = rows.map((r, i) => i === 0 ? 0 : netOf(r) - netOf(rows[i-1])).slice(1);
    let maxPos = 0, maxNeg = 0, curPos = 0, curNeg = 0;
    let posStart = '', negStart = '', maxPosStart = '', maxNegStart = '';
    deltas.forEach((d, i) => {
      if (d >= 0) {
        curPos++; curNeg = 0;
        if (curPos === 1) posStart = monthLabel(rows[i+1].Date);
        if (curPos > maxPos) { maxPos = curPos; maxPosStart = posStart; }
      } else {
        curNeg++; curPos = 0;
        if (curNeg === 1) negStart = monthLabel(rows[i+1].Date);
        if (curNeg > maxNeg) { maxNeg = curNeg; maxNegStart = negStart; }
      }
    });

    // ---- CARTE 2 : Mois normaux vs primes ----
    const revenus = rows.filter(r => r.Revenu > 0).map(r => r.Revenu);
    const medRevenu = revenus.sort((a,b) => a-b)[Math.floor(revenus.length/2)];
    const SEUIL_PRIME = medRevenu * 1.2;
    const moisPrimes = rows.filter(r => r.Revenu > SEUIL_PRIME);
    const moisNormaux = rows.filter(r => r.Revenu > 0 && r.Revenu <= SEUIL_PRIME);
    const deltasMois = rows.map((r,i) => i === 0 ? null : netOf(r) - netOf(rows[i-1]));

    const avgNormal = moisNormaux.reduce((s, r, i) => {
      const idx = rows.indexOf(r);
      return s + (deltasMois[idx] || 0);
    }, 0) / (moisNormaux.length || 1);

    const avgPrime = moisPrimes.reduce((s, r) => {
      const idx = rows.indexOf(r);
      return s + (deltasMois[idx] || 0);
    }, 0) / (moisPrimes.length || 1);

    // ---- CARTE 3 : Tendance liquidités ----
    const liqDeltas = rows.slice(-6).map((r,i,arr) => i === 0 ? 0 : r.Liquidites - arr[i-1].Liquidites).slice(1);
    const liqTendance = liqDeltas.reduce((a,b) => a+b, 0) / liqDeltas.length;
    const moisAvantSeuil = liqTendance < 0 ? Math.floor((liqActuelle - SEUIL_LIQUIDITE_ALERTE) / Math.abs(liqTendance)) : Infinity;

    // ---- CARTE 4 : Impact remboursement TGV ----
    const chargeTGV = CHARGES.find(c => /tgv/i.test(c.nom));
    const coutBrutTGV = chargeTGV ? chargeTGV.montant : 0;
    const coutNetTGV = coutBrutTGV - REMBOURSEMENT_TGV;
    const revMoy = rows.filter(r => r.Revenu > 0 && r.Revenu < medRevenu * 1.2).reduce((s,r) => s + r.Revenu, 0) / (moisNormaux.length || 1);
    const tauxAvecTGV = TOTAL_CHARGES / revMoy * 100;
    const tauxSansTGV = (TOTAL_CHARGES - REMBOURSEMENT_TGV) / revMoy * 100;
    const economieTGV = REMBOURSEMENT_TGV * 12;

    // Alert liquidités
    let liqAlertClass = 'ok', liqAlertMsg = '';
    if (liqActuelle < SEUIL_LIQUIDITE_DANGER) {
      liqAlertClass = 'danger';
      liqAlertMsg = `⚠ Niveau critique — sous ${fmt(SEUIL_LIQUIDITE_DANGER)} €. Pensez à renflouer.`;
    } else if (liqActuelle < SEUIL_LIQUIDITE_ALERTE) {
      liqAlertClass = 'warn';
      liqAlertMsg = `⚡ Niveau bas — sous ${fmt(SEUIL_LIQUIDITE_ALERTE)} €. Gardez un œil.`;
    } else if (liqTendance < -200 && moisAvantSeuil < 6) {
      liqAlertClass = 'warn';
      liqAlertMsg = `📉 Tendance baissière — seuil d'alerte dans ~${moisAvantSeuil} mois à ce rythme.`;
    } else {
      liqAlertMsg = `✓ Liquidités saines · tendance ${liqTendance >= 0 ? '+' : ''}${fmt(liqTendance)} €/mois (6 derniers mois).`;
    }

    el.innerHTML = `
      <div class="stat-card">
        <div class="stat-card-title">📈 Séquences de performance</div>
        <div class="stat-row">
          <div class="stat-row-label">Meilleure série positive</div>
          <div class="stat-row-value pos">${maxPos} mois consécutifs</div>
        </div>
        <div class="stat-row">
          <div class="stat-row-label">Depuis</div>
          <div class="stat-row-value">${maxPosStart}</div>
        </div>
        <div class="stat-row">
          <div class="stat-row-label">Pire série négative</div>
          <div class="stat-row-value neg">${maxNeg} mois consécutifs</div>
        </div>
        <div class="stat-row">
          <div class="stat-row-label">Depuis</div>
          <div class="stat-row-value">${maxNegStart || '—'}</div>
        </div>
        <div class="stat-row">
          <div class="stat-row-label">Mois positifs sur ${rows.length - 1}</div>
          <div class="stat-row-value pos">${deltas.filter(d => d > 0).length} mois (${Math.round(deltas.filter(d => d > 0).length / deltas.length * 100)} %)</div>
        </div>
      </div>

      <div class="stat-card">
        <div class="stat-card-title">🎯 Mois normaux vs mois primes</div>
        <div class="stat-row">
          <div class="stat-row-label">Seuil "prime" estimé</div>
          <div class="stat-row-value">> ${fmt(SEUIL_PRIME)} €/mois</div>
        </div>
        <div class="stat-row">
          <div class="stat-row-label">Mois normaux (${moisNormaux.length})</div>
          <div class="stat-row-value ${avgNormal > 0 ? 'pos' : 'neg'}">${fmtSigned(Math.round(avgNormal))} €/mois</div>
        </div>
        <div class="stat-row">
          <div class="stat-row-label">Mois primes (${moisPrimes.length})</div>
          <div class="stat-row-value pos">+${fmt(Math.round(avgPrime))} €/mois</div>
        </div>
        <div class="stat-row">
          <div class="stat-row-label">Écart mois prime vs normal</div>
          <div class="stat-row-value pos">+${fmt(Math.round(avgPrime - avgNormal))} €</div>
        </div>
        <div class="stat-row">
          <div class="stat-row-label">Primes attendues / an</div>
          <div class="stat-row-value">~${moisPrimes.length <= 12 ? Math.round(moisPrimes.length / (rows.length / 12)) : 2} mois</div>
        </div>
      </div>

      <div class="stat-card">
        <div class="stat-card-title">💧 Tendance liquidités</div>
        <div class="stat-row">
          <div class="stat-row-label">Liquidités actuelles</div>
          <div class="stat-row-value ${liqActuelle < SEUIL_LIQUIDITE_ALERTE ? 'warn' : ''}">${fmt(liqActuelle)} €</div>
        </div>
        <div class="stat-row">
          <div class="stat-row-label">Tendance 6 derniers mois</div>
          <div class="stat-row-value ${liqTendance >= 0 ? 'pos' : 'warn'}">${liqTendance >= 0 ? '+' : ''}${fmt(liqTendance)} €/mois</div>
        </div>
        <div class="stat-row">
          <div class="stat-row-label">Seuil d'alerte</div>
          <div class="stat-row-value">${fmt(SEUIL_LIQUIDITE_ALERTE)} €</div>
        </div>
        <div class="stat-row">
          <div class="stat-row-label">Min historique</div>
          <div class="stat-row-value warn">${fmt(Math.min(...rows.map(r => r.Liquidites)))} €</div>
        </div>
        <div class="liq-alert ${liqAlertClass}">${liqAlertMsg}</div>
      </div>

      <div class="stat-card">
        <div class="stat-card-title">🚄 Impact remboursement TGV Max</div>
        <div class="stat-row">
          <div class="stat-row-label">Coût brut TGV Max</div>
          <div class="stat-row-value neg">−${fmt(coutBrutTGV)} €/mois</div>
        </div>
        <div class="stat-row">
          <div class="stat-row-label">Remboursement Circana</div>
          <div class="stat-row-value pos">+${fmt(REMBOURSEMENT_TGV)} €/mois</div>
        </div>
        <div class="stat-row">
          <div class="stat-row-label">Coût net réel</div>
          <div class="stat-row-value">${fmt(coutNetTGV)} €/mois</div>
        </div>
        <div class="stat-row">
          <div class="stat-row-label">Taux charges brut</div>
          <div class="stat-row-value warn">${tauxAvecTGV.toFixed(1)} % du revenu</div>
        </div>
        <div class="stat-row">
          <div class="stat-row-label">Taux charges net (après remb.)</div>
          <div class="stat-row-value pos">${tauxSansTGV.toFixed(1)} % du revenu</div>
        </div>
        <div class="stat-row">
          <div class="stat-row-label">Économie annuelle Circana</div>
          <div class="stat-row-value pos">+${fmt(economieTGV)} €/an</div>
        </div>
      </div>
    `;
  }

  // ========== CHARGES FIXES ==========
  // CHARGES et TOTAL_CHARGES sont définis dans config.js.

  // Utilitaires partagés avec le module "Pilotage quotidien" (quotidien.js).
  function chargesPayeesMontant(today = new Date().getDate()) {
    return CHARGES.filter(c => c.jour <= today).reduce((s, c) => s + c.montant, 0);
  }
  function chargesRestantesMontant(today = new Date().getDate()) {
    return CHARGES.filter(c => c.jour > today).reduce((s, c) => s + c.montant, 0);
  }
  function joursRestantsDansLeMois(date = new Date()) {
    const finMois = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
    return finMois - date.getDate();
  }

  function renderCharges() {
    const now = new Date();
    const today = now.getDate();
    const fmt2 = (n) => new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

    document.getElementById('chargesTotalMensuel').textContent = fmt2(TOTAL_CHARGES);

    // Calcul payées / restantes
    const payees = CHARGES.filter(c => c.jour <= today);
    const restantes = CHARGES.filter(c => c.jour > today);
    const totalPayees = chargesPayeesMontant(today);
    const totalRestantes = chargesRestantesMontant(today);

    document.getElementById('chargesPayees').innerHTML = fmt2(totalPayees) + '<small> €</small>';
    document.getElementById('chargesPayeesSub').textContent = `${payees.length} charge${payees.length > 1 ? 's' : ''} prélevée${payees.length > 1 ? 's' : ''} (jours 1–${today})`;
    document.getElementById('chargesRestantes').innerHTML = fmt2(totalRestantes) + '<small> €</small>';
    document.getElementById('chargesRestantesSub').textContent = `${restantes.length} charge${restantes.length > 1 ? 's' : ''} à venir ce mois`;

    // Timeline
    let cumul = 0;
    const nextCharge = CHARGES.find(c => c.jour > today);
    const rows = CHARGES.map(c => {
      cumul += c.montant;
      const isDone = c.jour < today;
      const isToday = c.jour === today;
      const isNext = c === nextCharge;
      let rowClass = 'timeline-row';
      if (isDone) rowClass += ' done';
      if (isToday) rowClass += ' today';
      if (!isDone && !isToday && isNext) rowClass += ' next';

      let badge = '';
      if (isDone) badge = '<span class="tl-badge done-badge">✓ fait</span>';
      else if (isToday) badge = '<span class="tl-badge today-badge">aujourd\'hui</span>';
      else if (isNext) badge = '<span class="tl-badge next-badge">prochain</span>';

      const dayClass = isToday ? 'tl-day today-day' : 'tl-day';

      return `<div class="${rowClass}">
        <div class="${dayClass}"><span class="day-num">${c.jour}</span>du mois</div>
        <div class="tl-name">${c.nom}${badge}</div>
        <div class="tl-amount">${fmt2(c.montant)} €</div>
        <div class="tl-cumul">${fmt2(cumul)} €</div>
      </div>`;
    }).join('');

    document.getElementById('chargesTimeline').innerHTML = `
      <div class="timeline-header">
        <div>Jour</div>
        <div>Charge</div>
        <div style="text-align:right;">Montant</div>
        <div style="text-align:right;">Cumulé</div>
      </div>
      ${rows}
    `;

    // Prochaine charge
    const next = document.getElementById('chargesNext');
    if (nextCharge) {
      const daysLeft = nextCharge.jour - today;
      next.innerHTML = `
        <span class="next-icon">⏳</span>
        <span>Prochaine charge : <strong>${nextCharge.nom}</strong> — <strong>${fmt2(nextCharge.montant)} €</strong> dans <strong>${daysLeft} jour${daysLeft > 1 ? 's' : ''}</strong> (jour ${nextCharge.jour})</span>
      `;
    } else {
      next.innerHTML = `<span class="next-icon">✅</span><span>Toutes les charges du mois ont été prélevées.</span>`;
    }
  }

  // Init charges au chargement
  renderCharges();

  // Auto-load depuis le Google Sheet au démarrage
  loadFromSheet();
