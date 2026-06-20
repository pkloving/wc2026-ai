import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const STATUS_PATH = path.join(DATA_DIR, 'matches_status.json');
const SETTLED_PATH = path.join(DATA_DIR, 'settled_matches.json');

const statusDoc = JSON.parse(fs.readFileSync(STATUS_PATH, 'utf8'));
const matches = [];

for (const m of statusDoc.matches) {
  const mid = m.mid;

  // Get result file
  let result = null;
  const resultFile = path.join(DATA_DIR, 'results', `${mid}.json`);
  if (fs.existsSync(resultFile)) {
    try {
      const r = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
      result = {
        home: r.homeScore,
        away: r.awayScore,
        half: r.halfTime,
        scorers_count: (r.scorers || []).length,
        wentToPenalties: r.wentToPenalties || false,
        penaltyScore: r.penaltyScore || null,
      };
    } catch (e) { /* ignore */ }
  }

  // Fallback: use matches_status final_score if no result file
  if (!result && m.final_score) {
    const parts = String(m.final_score).split(/[-:]/);
    if (parts.length === 2 && !isNaN(Number(parts[0])) && !isNaN(Number(parts[1]))) {
      result = {
        home: Number(parts[0]),
        away: Number(parts[1]),
        half: null,
        scorers_count: 0,
        wentToPenalties: false,
        penaltyScore: null,
      };
    }
  }

  // Get odds file
  let odds = null;
  const oddsFile = path.join(DATA_DIR, 'odds', `${mid}.json`);
  if (fs.existsSync(oddsFile)) {
    try {
      odds = JSON.parse(fs.readFileSync(oddsFile, 'utf8'));
    } catch (e) { /* ignore */ }
  }

  // Get history file
  let historyPoints = null;
  const histFile = path.join(DATA_DIR, 'odds_history', `${mid}.json`);
  if (fs.existsSync(histFile)) {
    try {
      const h = JSON.parse(fs.readFileSync(histFile, 'utf8'));
      historyPoints = {
        spf: (h.spf_history || []).length,
        rqspf: (h.rqspf_history || []).length,
        bf: (h.bf_history || []).length,
        zjq: (h.zjq_history || []).length,
        bqc: (h.bqc_history || []).length,
      };
    } catch (e) { /* ignore */ }
  }

  if (!result && !odds) continue;

  const match = {
    mid: mid,
    code: m.code,
    league: m.league,
    home: m.home,
    away: m.away,
    kickoff: m.kickoff,
    handicap: m.handicap || (odds && odds.odds && odds.odds.handicap),
    status: m.status,
  };

  // SPF
  if (odds && odds.odds && odds.odds.spf_latest) {
    const spfInitial = (odds.odds.spf_history && odds.odds.spf_history.length > 0)
      ? odds.odds.spf_history[0] : odds.odds.spf_latest;
    match.spf = {
      initial: { home: spfInitial.home, draw: spfInitial.draw, away: spfInitial.away },
      last: { home: odds.odds.spf_latest.home, draw: odds.odds.spf_latest.draw, away: odds.odds.spf_latest.away },
      result: null,
    };
    if (result && result.home !== null && result.away !== null) {
      if (result.home > result.away) match.spf.result = 'home';
      else if (result.home < result.away) match.spf.result = 'away';
      else match.spf.result = 'draw';
    }
  }

  // RQSPF
  if (odds && odds.odds && odds.odds.rqspf_latest) {
    const hc = match.handicap;
    const rqInitial = (odds.odds.rqspf_history && odds.odds.rqspf_history.length > 0)
      ? odds.odds.rqspf_history[0] : odds.odds.rqspf_latest;
    match.rqspf = {
      initial: { handicap: hc, home: rqInitial.home, draw: rqInitial.draw, away: rqInitial.away },
      last: { handicap: hc, home: odds.odds.rqspf_latest.home, draw: odds.odds.rqspf_latest.draw, away: odds.odds.rqspf_latest.away },
      result: null,
    };
    if (result && result.home !== null && result.away !== null) {
      const adjHome = result.home + (hc || 0);
      if (adjHome > result.away) match.rqspf.result = 'home';
      else if (adjHome < result.away) match.rqspf.result = 'away';
      else match.rqspf.result = 'draw';
    }
  }

  // BF
  if (odds && odds.odds && odds.odds.bf_latest) {
    const bfInitial = (odds.odds.bf_history && odds.odds.bf_history.length > 0)
      ? odds.odds.bf_history[0] : odds.odds.bf_latest;
    match.bf = {
      initial: { odds: bfInitial },
      last: { odds: odds.odds.bf_latest },
      result: null,
    };
    if (result && result.home !== null && result.away !== null) {
      match.bf.result = { score: `${result.home}:${result.away}`, other: null };
    }
  }

  // ZJQ
  if (odds && odds.odds && odds.odds.zjq_latest) {
    const zInitial = (odds.odds.zjq_history && odds.odds.zjq_history.length > 0)
      ? odds.odds.zjq_history[0] : odds.odds.zjq_latest;
    match.zjq = {
      initial: { odds: zInitial },
      last: { odds: odds.odds.zjq_latest },
      result: null,
    };
    if (result && result.home !== null && result.away !== null) {
      const total = result.home + result.away;
      match.zjq.result = total >= 7 ? '7+' : String(total);
    }
  }

  // BQC
  if (odds && odds.odds && odds.odds.bqc_latest) {
    const bqInitial = (odds.odds.bqc_history && odds.odds.bqc_history.length > 0)
      ? odds.odds.bqc_history[0] : odds.odds.bqc_latest;
    match.bqc = {
      initial: { odds: bqInitial },
      last: { odds: odds.odds.bqc_latest },
      result: null,
    };
    if (result && result.half && result.half.home !== null && result.home !== null) {
      let halfRes = result.half.home > result.half.away ? '胜' : result.half.home < result.half.away ? '负' : '平';
      let fullRes = result.home > result.away ? '胜' : result.home < result.away ? '负' : '平';
      match.bqc.result = halfRes + fullRes;
    }
  }

  match.result = result;
  match.meta = { history_points: historyPoints };

  matches.push(match);
}

const output = {
  generated_at: new Date().toISOString(),
  total_matches: matches.length,
  matches: matches,
};

fs.writeFileSync(SETTLED_PATH, JSON.stringify(output, null, 2), 'utf8');
console.log(`[build_settled] ${matches.length} matches assembled`);
console.log(`  with results: ${matches.filter(m => m.result).length}`);
