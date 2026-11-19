#!/usr/bin/env node
/**
 * 复盘：每期开奖前锁定推荐，开奖后自动对比，形成可追溯的战绩表。
 *
 * 流程：
 *   1. 读取 data/history.json（已开奖数据）
 *   2. 若 pending 对应的期号已经开奖 → 生成一条复盘记录（推荐 vs 实际 vs 命中）
 *   3. 用最新数据生成下一期推荐，写入 pending
 *   4. 写回 data/review.json
 *
 * 推荐逻辑与前端完全一致：同一个 core.js + formulas.js + 相同窗口。
 */
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const HISTORY = resolve(ROOT, 'data/history.json');
const REVIEW = resolve(ROOT, 'data/review.json');
const WINDOW = 40;
/* 各彩种最优频率窗口（与前端 FREQ_DEFAULT 保持一致） */
const FREQ_DEFAULT = { ssq: null, dlt: 30, fc3d: 0, kl8: 0, pl5: 0 };
const FREQ_OVERRIDE = process.env.FREQ_WINDOW !== undefined ? Number(process.env.FREQ_WINDOW) : undefined;
function freqWindowFor(key) {
  if (FREQ_OVERRIDE !== undefined) return FREQ_OVERRIDE;
  return FREQ_DEFAULT[key] === undefined ? 30 : FREQ_DEFAULT[key];
}
const MAX_RECORDS = 200;

globalThis.LotteryCore = require(resolve(ROOT, 'assets/core.js'));
const Core = globalThis.LotteryCore;
const F = require(resolve(ROOT, 'assets/formulas.js'));
const KL8 = require(resolve(ROOT, 'assets/formulas-kl8.js'));
const SSQ = require(resolve(ROOT, 'assets/formulas-ssq.js'));
const DLT = require(resolve(ROOT, 'assets/formulas-dlt.js'));
const DIGIT = require(resolve(ROOT, 'assets/formulas-digit.js'));
const SSQF = require(resolve(ROOT, 'assets/formulas-ssq-full.js'));
const EXTRA = require(resolve(ROOT, 'assets/formulas-extra.js'));
const DLTF = require(resolve(ROOT, 'assets/formulas-dlt-full.js'));

function readJson(p, fallback) {
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return fallback; }
}

/* 与前端 formulasFor 保持一致：每个彩种一份独立公式实例 */
const BLACKLIST = (() => { try { return JSON.parse(readFileSync(resolve(ROOT, 'data/formula-blacklist.json'), 'utf8')); } catch { return {}; } })();
function dropSet(key, zone) {
  const gb = BLACKLIST[key] || {};
  const ids = gb[zone] || [];
  const legacy = zone === 'front' ? (BLACKLIST.front || []) : (zone === 'back' ? (BLACKLIST.back || []) : []);
  return new Set([...ids, ...legacy]);
}

function formulasFor(key, zone) {
  let base = [], extra = [];
  if (key === 'kl8') {
    base = KL8.all;
  } else if (key === 'ssq') {
    base = (zone === 'front') ? SSQF.front.slice() : (zone === 'back' ? SSQF.back.slice() : F.digit.slice());
    if (zone === 'front') extra = SSQ.front;
    else if (zone === 'back') extra = SSQ.back;
    if (EXTRA && EXTRA.ssq) extra = extra.concat(zone === 'front' ? EXTRA.ssq.front : EXTRA.ssq.back);
  } else if (key === 'dlt') {
    base = (zone === 'front') ? DLTF.front.slice() : (zone === 'back' ? DLTF.back.slice() : F.digit.slice());
    if (zone === 'front') extra = DLT.front;
    else if (zone === 'back') extra = DLT.back;
    if (EXTRA && EXTRA.dlt) extra = extra.concat(zone === 'front' ? EXTRA.dlt.front : EXTRA.dlt.back);
  } else if (key === 'fc3d' || key === 'pl5') {
    const D = key === 'fc3d' ? DIGIT.fc3d : DIGIT.pl5;
    const bz = D && D.byZone ? D.byZone[zone] : null;
    base = bz && bz.length ? bz : F.digit.slice();
  } else {
    base = (zone === 'front' || zone === 'back') ? F[zone].slice() : F.digit.slice();
  }
  const drop = dropSet(key, zone);
  return base.concat(extra).filter((f) => !drop.has(f.id)).map((f) => ({
    id: key + '_' + f.id,
    baseId: f.id,
    zone: f.zone,
    cat: f.cat,
    name: f.name,
    desc: f.desc,
    run: f.run,
    game: key,
  }));
}

function recommendFor(key, data, zone) {
  const g = data[key];
  const game = Object.assign({}, Core.GAMES[key], { key, draws: g.draws });
  const res = Core.analyze(game, zone, formulasFor(key, zone), { window: WINDOW, freqWindow: freqWindowFor(key) });
  const cfg = Core.GAMES[key][zone];
  const numbers = res.ranking.slice(0, cfg.pick).map((r) => r.n).sort((a, b) => a - b);

  /* 备选一注：用 reweight 对主推降权并重排票数 */
  let altNumbers = [];
  try {
    const alt = Core.reweight(game, res, 1, numbers.slice());
    altNumbers = alt.ranking.slice(0, cfg.pick).map((r) => r.n).sort((a, b) => a - b);
  } catch (e) { altNumbers = []; }

  return {
    numbers,
    alt: altNumbers,
    pick: cfg.pick,
    label: cfg.label,
    formulaCount: formulasFor(key, zone).length,
    top: res.ranking.slice(0, 5).map((r) => ({ n: r.n, weight: Math.round(r.weight * 10) / 10, votes: r.votes })),
  };
}

function actualOf(draw, key, zone) {
  const g = Core.GAMES[key];
  const arr = draw[zone];
  if (Array.isArray(arr)) return arr.slice().sort((a, b) => a - b);
  return [];
}

function hitsOf(pick, actual) {
  let h = 0;
  for (const n of pick) if (actual.indexOf(n) !== -1) h++;
  return h;
}

function randomExpect(key) {
  const g = Core.GAMES[key];
  let e = 0;
  for (const z of g.ticketZones) {
    const cfg = g[z];
    e += key === 'kl8'
      ? cfg.pick * (cfg.drawPick || 20) / (cfg.max - cfg.min + 1)
      : cfg.pick * cfg.pick / (cfg.max - cfg.min + 1);
  }
  return e;
}

function nextIssue(key, issue) {
  const s = String(issue || '');
  const m = s.match(/^(\d+)$/);
  if (!m) return '';
  try {
    const n = BigInt(s) + 1n;
    let out = n.toString();
    while (out.length < s.length) out = '0' + out;
    return out;
  } catch {
    return '';
  }
}

function main() {
  const data = readJson(HISTORY, null);
  if (!data) {
    console.error('读不到 data/history.json');
    process.exit(1);
  }
  const review = readJson(REVIEW, { version: 1, updatedAt: '', games: {} });
  if (!review.games) review.games = {};

  const now = new Date().toISOString();
  const games = Object.keys(Core.GAMES);

  for (const key of games) {
    const g = data[key];
    if (!g || !g.draws || g.draws.length < WINDOW + 10) continue;
    const zoneKeys = Core.GAMES[key].ticketZones;
    const last = g.draws[g.draws.length - 1];
    const bucket = review.games[key] || { records: [], pending: null };

    /* 1) pending 对应的期已开奖 → 落成复盘记录 */
    if (bucket.pending && bucket.pending.issue === String(last.issue)) {
      const zones = {};
      let totalHits = 0;
      let totalPick = 0;
      for (const z of zoneKeys) {
        const pick = (bucket.pending.zones[z] || {}).numbers || [];
        const actual = actualOf(last, key, z);
        const hits = hitsOf(pick, actual);
        const cfg = Core.GAMES[key][z];
        zones[z] = {
          label: cfg.label,
          numbers: pick,
          actual,
          hits,
          pick: cfg.pick,
        };
        totalHits += hits;
        totalPick += cfg.pick;
      }
      bucket.records.unshift({
        issue: String(last.issue),
        date: last.date || '',
        zones,
        totalHits,
        totalPick,
        lockedAt: bucket.pending.lockedAt || '',
        recordedAt: now,
      });
      if (bucket.records.length > MAX_RECORDS) bucket.records.length = MAX_RECORDS;
      console.log(`  ✓ ${key} ${last.issue} 复盘：命中 ${totalHits}/${totalPick}`);
      bucket.pending = null;
    }

    /* 1.5) 首次运行或记录不足时，回补最近 BACKFILL 期，便于查看历史表现 */
    const BACKFILL = Number(process.env.BACKFILL || 30);
    if (bucket.records.length < BACKFILL) {
      const have = new Set(bucket.records.map((r) => r.issue));
      const start = Math.max(WINDOW + 5, g.draws.length - BACKFILL);
      for (let i = g.draws.length - 1; i >= start; i--) {
        const draw = g.draws[i];
        if (have.has(String(draw.issue))) continue;
        const hist = Object.assign({}, g, { draws: g.draws.slice(0, i) });
        const dataSlice = Object.assign({}, data, { [key]: hist });
        const zones = {};
        let totalHits = 0, totalPick = 0;
        for (const z of zoneKeys) {
          const rec = recommendFor(key, dataSlice, z);
          const actual = actualOf(draw, key, z);
          const hits = hitsOf(rec.numbers, actual);
          const altHits = rec.alt && rec.alt.length ? hitsOf(rec.alt, actual) : 0;
          const cfg = Core.GAMES[key][z];
          zones[z] = { label: cfg.label, numbers: rec.numbers, alt: rec.alt || [], actual, hits, altHits, pick: cfg.pick };
          totalHits += hits;
          totalPick += cfg.pick;
        }
        bucket.records.push({
          issue: String(draw.issue),
          date: draw.date || '',
          zones,
          totalHits,
          totalPick,
          backfilled: true,
          recordedAt: now,
        });
        have.add(String(draw.issue));
      }
      bucket.records.sort((a, b) => String(b.issue).localeCompare(String(a.issue)));
      if (bucket.records.length > MAX_RECORDS) bucket.records.length = MAX_RECORDS;
      console.log(`  · ${key} 回补 ${bucket.records.length} 期复盘`);
    }

    /* 2) 生成下一期推荐并锁定 */
    const zones = {};
    for (const z of zoneKeys) {
      zones[z] = recommendFor(key, data, z);
    }
    bucket.pending = {
      issue: nextIssue(key, last.issue),
      basedOn: String(last.issue),
      zones,
      lockedAt: now,
    };

    review.games[key] = bucket;
    const preview = zoneKeys.map((z) => zones[z].numbers.join(',')).join(' + ');
    console.log(`  · ${key} 下期 ${bucket.pending.issue} -> ${preview}`);
  }

  /* 统计显著性：实测命中 vs 随机期望 */
  for (const key of games) {
    const b = review.games[key];
    if (!b || !b.records.length) continue;
    const n = b.records.length;
    const hits = b.records.reduce((a, r) => a + r.totalHits, 0);
    const exp = randomExpect(key) * n;
    const sd = Math.sqrt(n * randomExpect(key) * 0.9 + 1e-9);
    b.stats = {
      n,
      avgHit: Math.round(hits / n * 1000) / 1000,
      randomExpect: Math.round(exp / n * 1000) / 1000,
      diff: Math.round((hits / n - exp / n) * 1000) / 1000,
      z: Math.round((hits - exp) / sd * 100) / 100,
      altAvg: Math.round((b.records.reduce((a, r) => a + Object.keys(r.zones).reduce((s2, z) => s2 + (r.zones[z].altHits || 0), 0), 0) / n) * 1000) / 1000,
    };
  }

  review.version = 1;
  review.updatedAt = now;
  mkdirSync(dirname(REVIEW), { recursive: true });
  writeFileSync(REVIEW, JSON.stringify(review, null, 1) + '\n', 'utf8');
  console.log('写入 data/review.json');

  /* 3) 统计 */
  for (const key of games) {
    const b = review.games[key];
    if (!b || !b.records.length) continue;
    const n = b.records.length;
    const hits = b.records.reduce((a, r) => a + r.totalHits, 0);
    const picks = b.records.reduce((a, r) => a + r.totalPick, 0);
    const st = b.stats || {};
    console.log(`  ${key}: ${n} 期复盘，平均命中 ${(hits / n).toFixed(3)}，随机 ${(st.randomExpect || 0).toFixed(3)}，z=${st.z}`);
  }
}

main();
