import { getMatches, getResults, getTeams, getPredictions, getResultForMatch } from '../data.js';
import { stageLabel, hitBadge, teamChip, teamDisplayName } from '../util.js';
import { t, getLocale } from '../i18n.js';
import { boot } from '../page-boot.js';

boot(async () => {
  // Chart.js 仅在统计页使用，动态 import 不会拖累其它页面
  const { Chart, registerables } = await import('chart.js');
  Chart.register(...registerables);

  const [matches, results, teams, predictions] = await Promise.all([
    getMatches(), getResults(), getTeams(), getPredictions(),
  ]);
  const resultFor = (m) => getResultForMatch(m, results);
  const teamMap = new Map(teams.map((t) => [t.code, t]));

  // 速览（只统计世界杯正赛：results 里可能混入国际赛/热身赛等其它赛事，按 matches.json 的 id/mid 过滤）
  const matchByResultId = new Map();
  for (const m of matches) {
    if (m.mid) matchByResultId.set(String(m.mid), m);
    if (m.id) matchByResultId.set(String(m.id), m);
  }
  const wcResults = results.filter((r) => matchByResultId.has(String(r.matchId)));
  const finished = wcResults.length;
  const resultMap = new Map(wcResults.map((r) => [r.matchId, r]));
  const predictedMatchIds = new Set(predictions.map((p) => p.matchId));
  const finishedPredicted = [...predictedMatchIds].filter((id) => {
    const m = matches.find((x) => x.id === id);
    return m ? !!resultFor(m) : false;
  });
  let totalPreds = 0, totalWinner = 0;
  for (const p of predictions) {
    const m = matches.find((x) => x.id === p.matchId);
    if (!m) continue;
    const r = resultFor(m);
    if (!r) continue;
    for (const m of p.models) {
      totalPreds += 1;
      const ph = m.predictedHome, pa = m.predictedAway;
      if (ph === r.homeScore && pa === r.awayScore) {
        totalWinner += 1; // 比分一致也算胜负一致
      } else {
        const pw = ph > pa ? 'home' : ph < pa ? 'away' : 'draw';
        const rw = r.homeScore > r.awayScore ? 'home' : r.homeScore < r.awayScore ? 'away' : 'draw';
        if (pw === rw) totalWinner += 1;
      }
    }
  }
  document.getElementById('stat-finished').textContent = finished;
  document.getElementById('stat-predicted').textContent = predictions.length;
  document.getElementById('stat-total-preds').textContent = totalPreds;
  document.getElementById('stat-overall').textContent = totalPreds > 0
    ? Math.round((totalWinner / totalPreds) * 100) + '%' : '—';

  // 1. AI 模型准确率榜
  const modelStats = new Map();
  for (const p of predictions) {
    const m = matches.find((x) => x.id === p.matchId);
    if (!m) continue;
    const r = resultFor(m);
    for (const m of p.models) {
      if (!modelStats.has(m.model)) modelStats.set(m.model, { scoreHit: 0, winnerHit: 0, total: 0, finished: 0 });
      const s = modelStats.get(m.model);
      s.total += 1;
      if (!r) continue;
      s.finished += 1;
      const ph = m.predictedHome, pa = m.predictedAway;
      if (ph === r.homeScore && pa === r.awayScore) { s.scoreHit += 1; s.winnerHit += 1; }
      else {
        const pw = ph > pa ? 'home' : ph < pa ? 'away' : 'draw';
        const rw = r.homeScore > r.awayScore ? 'home' : r.homeScore < r.awayScore ? 'away' : 'draw';
        if (pw === rw) s.winnerHit += 1;
      }
    }
  }
  const labels = [...modelStats.keys()];
  const scorePct = labels.map((k) => {
    const s = modelStats.get(k);
    return s.finished > 0 ? Math.round((s.scoreHit / s.finished) * 100) : 0;
  });
  const winnerPct = labels.map((k) => {
    const s = modelStats.get(k);
    return s.finished > 0 ? Math.round((s.winnerHit / s.finished) * 100) : 0;
  });
  const isEn = getLocale() === 'en-US';
  const fmtMonthDay = (iso) => {
    if (isEn) {
      return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: '2-digit' });
    }
    return new Date(iso).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
  };
  new Chart(document.getElementById('chart-accuracy'), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: t('stats.chart.scorePct'), data: scorePct, backgroundColor: '#0E7C3A' },
        { label: t('stats.chart.winnerPct'), data: winnerPct, backgroundColor: '#D4AF37' },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: { y: { beginAtZero: true, max: 100, ticks: { callback: (v) => v + '%' } } },
      plugins: {
        legend: { position: 'top' },
        tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${c.parsed.y}%（${modelStats.get(c.label).scoreHit}/${modelStats.get(c.label).finished}）` } },
      },
    },
  });

  // 2. 各阶段准确率
  const stages = ['group', 'r32', 'r16', 'qf', 'sf', 'final'];
  const stageStats = new Map(stages.map((s) => [s, { score: 0, winner: 0, total: 0 }]));
  for (const p of predictions) {
    const m = matches.find((x) => x.id === p.matchId);
    if (!m) continue;
    const r = resultFor(m);
    if (!r) continue;
    const s = stageStats.get(m.stage);
    if (!s) continue;
    for (const mm of p.models) {
      s.total += 1;
      const ph = mm.predictedHome, pa = mm.predictedAway;
      if (ph === r.homeScore && pa === r.awayScore) { s.score += 1; s.winner += 1; }
      else {
        const pw = ph > pa ? 'home' : ph < pa ? 'away' : 'draw';
        const rw = r.homeScore > r.awayScore ? 'home' : r.homeScore < r.awayScore ? 'away' : 'draw';
        if (pw === rw) s.winner += 1;
      }
    }
  }
  new Chart(document.getElementById('chart-stages'), {
    type: 'bar',
    data: {
      labels: stages.map((s) => stageLabel(s)),
      datasets: [
        { label: t('stats.chart.scorePct'), data: stages.map((s) => stageStats.get(s).total ? Math.round((stageStats.get(s).score / stageStats.get(s).total) * 100) : 0), backgroundColor: '#0E7C3A' },
        { label: t('stats.chart.winnerPct'), data: stages.map((s) => stageStats.get(s).total ? Math.round((stageStats.get(s).winner / stageStats.get(s).total) * 100) : 0), backgroundColor: '#D4AF37' },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: { y: { beginAtZero: true, max: 100, ticks: { callback: (v) => v + '%' } } },
      plugins: { legend: { position: 'top' } },
    },
  });

  // 3. 进展时间线
  const sorted = matches.filter((m) => !!resultFor(m)).sort((a, b) => new Date(a.date) - new Date(b.date));
  const cumStats = new Map();
  for (const m of sorted) {
    const p = predictions.find((x) => x.matchId === m.id);
    if (!p) continue;
    const r = resultFor(m);
    if (!r) continue;
    for (const mm of p.models) {
      if (!cumStats.has(mm.model)) cumStats.set(mm.model, { x: [], y: [], score: 0, winner: 0, total: 0 });
      const cs = cumStats.get(mm.model);
      const ph = mm.predictedHome, pa = mm.predictedAway;
      cs.total += 1;
      if (ph === r.homeScore && pa === r.awayScore) { cs.score += 1; cs.winner += 1; }
      else {
        const pw = ph > pa ? 'home' : ph < pa ? 'away' : 'draw';
        const rw = r.homeScore > r.awayScore ? 'home' : r.homeScore < r.awayScore ? 'away' : 'draw';
        if (pw === rw) cs.winner += 1;
      }
      cs.x.push(fmtMonthDay(m.date));
      cs.y.push(Math.round((cs.winner / cs.total) * 100));
    }
  }
  const palette = ['#0E7C3A', '#D4AF37', '#E63946', '#0B1F3A', '#888888', '#FF6F00', '#1976D2'];
  new Chart(document.getElementById('chart-timeline'), {
    type: 'line',
    data: {
      datasets: [...cumStats.entries()].map(([model, s], i) => ({
        label: `${model}${t('stats.chart.timelineSuffix')}`,
        data: s.x.map((x, j) => ({ x, y: s.y[j] })),
        borderColor: palette[i % palette.length],
        backgroundColor: palette[i % palette.length] + '20',
        tension: 0.2,
        fill: false,
      })),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: { y: { beginAtZero: true, max: 100, ticks: { callback: (v) => v + '%' } } },
      plugins: { legend: { position: 'top' } },
    },
  });

  // 4. 关键比赛回顾
  const keyStages = ['sf', 'third', 'final'];
  const keyList = sorted.filter((m) => keyStages.includes(m.stage));
  const el = document.getElementById('key-matches');
  if (keyList.length === 0) {
    el.innerHTML = `<div class="col-span-full text-slate-500 text-sm">${t('stats.keyMatches.empty')}</div>`;
  } else {
    el.innerHTML = keyList.map((m) => {
      const r = resultFor(m);
      const p = predictions.find((x) => x.matchId === m.id);
      const home = teamMap.get(m.home);
      const away = teamMap.get(m.away);
      const chips = p ? p.models.map((mm) => {
        const b = hitBadge(r, mm);
        return `<span class="badge ${b.tone}">${mm.model.split(' ')[0]} ${mm.predictedHome}-${mm.predictedAway}</span>`;
      }).join(' ') : '';
      return `
        <a href="/match.html?id=${m.id}" class="card p-5 hover:-translate-y-0.5 transition-transform block">
          <div class="text-xs text-slate-500 mb-2">${stageLabel(m.stage)}</div>
          <div class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-2 min-w-0">
              ${teamChip(home, 'sm')}
              <div class="font-semibold truncate">${teamDisplayName(home) || m.home}</div>
            </div>
            <div class="text-2xl font-black tabular-nums">${r ? `${r.homeScore} - ${r.awayScore}` : '—'}</div>
            <div class="flex items-center gap-2 min-w-0">
              <div class="font-semibold truncate">${teamDisplayName(away) || m.away}</div>
              ${teamChip(away, 'sm')}
            </div>
          </div>
          ${chips ? `<div class="mt-3 flex flex-wrap gap-1.5 text-xs">${chips}</div>` : ''}
        </a>
      `;
    }).join('');
  }
}, { errorTarget: 'stat-overall' });
