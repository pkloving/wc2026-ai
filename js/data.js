// Vite glob：构建时把 data/results/<mid>.json 全部打包进来（per-mid 单一来源）
// 用 import.meta.glob + eager 保证同步可用，无需 async 加载
const resultModules = import.meta.glob('../data/results/*.json', { eager: true });
const resultsData = Object.values(resultModules)
  .map((m) => m.default || m)
  .sort((a, b) => String(a.matchId).localeCompare(String(b.matchId)));

import matchesData from '../data/matches.json';
import predictionsData from '../data/predictions.json';
import teamsData from '../data/teams.json';
import groupsData from '../data/groups.json';
import championData from '../data/champion.json';
import betsData from '../data/bets.json';

export const matches = matchesData;
export const results = resultsData;
export const predictions = predictionsData;
export const teams = teamsData;
export const groups = groupsData;
export const champion = championData;
export const bets = betsData;

export async function getMatches() { return matchesData; }
export async function getResults() { return resultsData; }
export async function getPredictions() { return predictionsData; }
export async function getTeams() { return teamsData; }
export async function getGroups() { return groupsData; }
export async function getChampion() { return championData; }
export async function getBets() { return betsData; }

export function resultsIndex(resultsArr = results) {
  const m = new Map();
  for (const r of resultsArr) m.set(r.matchId, r);
  return m;
}

export function predictionsIndex(preds = predictions) {
  const m = new Map();
  for (const p of preds) m.set(p.matchId, p);
  return m;
}

export function teamMap(teamsArr = teams) {
  const m = new Map();
  for (const t of teamsArr) m.set(t.code, t);
  return m;
}

export function getMatchById(id) {
  const m = matchesData.find((x) => x.id === id);
  if (!m) return null;
  const r = resultsData.find((x) => x.matchId === id) || null;
  const p = predictionsData.find((x) => x.matchId === id) || null;
  return { match: m, result: r, prediction: p };
}
