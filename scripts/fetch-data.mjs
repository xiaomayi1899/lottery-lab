#!/usr/bin/env node
/**
 * 抓取五个彩种的历史开奖，生成 data/history.json
 *   双色球、大乐透、福彩3D、快乐8、排列五
 * 数据源：
 *   - 中国福利彩票官网（双色球 / 3D / 快乐8）
 *   - 中国体育彩票官网（大乐透）
 *   - 500.com 走势图（备用；官方接口对 GitHub 海外服务器返回 403/567 时启用）
 * 用法：node scripts/fetch-data.mjs [--draws=400] [--source=500] [--out=path]
 */
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const argOut = process.argv.find((a) => a.startsWith('--out='));
const OUT = argOut ? resolve(ROOT, argOut.split('=')[1]) : resolve(ROOT, 'data/history.json');

const arg = process.argv.find((a) => a.startsWith('--draws='));
const TARGET = Math.max(120, Math.min(1200, Number(arg ? arg.split('=')[1] : 400) || 400));
const argSource = process.argv.find((a) => a.startsWith('--source='));
const SOURCE = argSource ? argSource.split('=')[1] : 'auto';

const UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

const GAMES = {
  ssq: {
    name: '双色球',
    ticketZones: ['front', 'back'],
    front: { min: 1, max: 33, pick: 6, label: '红球' },
    back: { min: 1, max: 16, pick: 1, label: '蓝球' },
  },
  dlt: {
    name: '大乐透',
    ticketZones: ['front', 'back'],
    front: { min: 1, max: 35, pick: 5, label: '前区' },
    back: { min: 1, max: 12, pick: 2, label: '后区' },
  },
  fc3d: {
    name: '福彩3D',
    ticketZones: ['hundreds', 'tens', 'units'],
    hundreds: { min: 0, max: 9, pick: 1, label: '百位' },
    tens: { min: 0, max: 9, pick: 1, label: '十位' },
    units: { min: 0, max: 9, pick: 1, label: '个位' },
  },
  kl8: {
    name: '快乐8',
    ticketZones: ['main'],
    main: { min: 1, max: 80, pick: 10, drawPick: 20, label: '号码' },
  },
  pl5: {
    name: '排列五',
    ticketZones: ['pos1', 'pos2', 'pos3', 'pos4', 'pos5'],
    pos1: { min: 0, max: 9, pick: 1, label: '万位' },
    pos2: { min: 0, max: 9, pick: 1, label: '千位' },
    pos3: { min: 0, max: 9, pick: 1, label: '百位' },
    pos4: { min: 0, max: 9, pick: 1, label: '十位' },
    pos5: { min: 0, max: 9, pick: 1, label: '个位' },
  },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nums = (str, sep = /[\s,]+/) =>
  String(str || '')
    .trim()
    .split(sep)
    .map((s) => Number(s))
    .filter((n) => Number.isInteger(n) && n >= 0);

async function getJSON(url, headers = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': UA,
          Accept: 'application/json, text/plain, */*',
          'Accept-Language': 'zh-CN,zh;q=0.9',
          ...headers,
        },
        signal: AbortSignal.timeout(25000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      lastErr = err;
      if (attempt < 3) await sleep(1500 * attempt);
    }
  }
  throw lastErr;
}

async function getText(url, headers = {}, encoding = 'utf-8') {
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': UA,
          Accept: 'text/html,text/plain,*/*',
          'Accept-Language': 'zh-CN,zh;q=0.9',
          ...headers,
        },
        signal: AbortSignal.timeout(25000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = await res.arrayBuffer();
      return new TextDecoder(encoding).decode(buf);
    } catch (err) {
      lastErr = err;
      if (attempt < 3) await sleep(1500 * attempt);
    }
  }
  throw lastErr;
}

function fmtDate(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}
function parseDate(str) {
  const d = new Date(String(str || '').replace(/-/g, '/'));
  return isNaN(d.getTime()) ? new Date() : d;
}
function addDays(date, days) {
  const d = new Date(date.getTime());
  d.setDate(d.getDate() + days);
  return d;
}
function sorted(list) {
  return list.slice().sort((a, b) => a - b);
}

/* ---------------- 官方接口 ---------------- */

function parseSSQ(item) {
  const front = nums(item.red);
  const back = nums(item.blue);
  if (front.length !== 6 || back.length !== 1) return null;
  return {
    issue: String(item.code || ''),
    date: String(item.date || '').slice(0, 10),
    front: sorted(front),
    back: sorted(back),
  };
}

function parse3D(item) {
  const digits = nums(item.red);
  if (digits.length !== 3 || digits.some((n) => n > 9)) return null;
  return {
    issue: String(item.code || ''),
    date: String(item.date || '').slice(0, 10),
    digits: digits.slice(),
    hundreds: [digits[0]],
    tens: [digits[1]],
    units: [digits[2]],
  };
}

function parseKL8(item) {
  const main = nums(item.red);
  if (main.length !== 20) return null;
  return {
    issue: String(item.code || ''),
    date: String(item.date || '').slice(0, 10),
    main: sorted(main),
  };
}

async function fetchCwl(name, label, parser) {
  const base = 'https://www.cwl.gov.cn/cwl_admin/front/cwlkj/search/kjxx/findDrawNotice';
  const headers = { Referer: 'https://www.cwl.gov.cn/ygkj/wqkjgg/' + name + '/' };
  const all = [];
  const collect = (list) => {
    (list || []).forEach((item) => {
      const d = parser(item);
      if (d) all.push(d);
    });
  };

  try {
    const url =
      `${base}?name=${name}&issueCount=${TARGET}&issueStart=&issueEnd=&dayStart=&dayEnd=` +
      `&pageNo=1&pageSize=${TARGET}&week=&systemType=PC`;
    const json = await getJSON(url, headers);
    collect(json && json.result);
  } catch (err) {
    console.warn(`[fetch] ${label}整包请求失败，回退分页：`, err.message);
  }

  if (all.length < TARGET) {
    const pageSize = 100;
    const pages = Math.ceil(TARGET / pageSize);
    for (let pageNo = 1; pageNo <= pages; pageNo++) {
      try {
        const url = `${base}?name=${name}&pageNo=${pageNo}&pageSize=${pageSize}&systemType=PC`;
        const json = await getJSON(url, headers);
        const list = (json && json.result) || [];
        if (!list.length) break;
        collect(list);
        if (list.length < pageSize) break;
      } catch (err) {
        console.warn(`[fetch] ${label}分页失败：`, err.message);
        break;
      }
      await sleep(450);
    }
  }
  return all;
}

function fetchSSQ() {
  return fetchCwl('ssq', '双色球', parseSSQ);
}
function fetchFC3D() {
  return fetchCwl('3d', '福彩3D', parse3D);
}
function fetchKL8() {
  return fetchCwl('kl8', '快乐8', parseKL8);
}

async function fetchDLT() {
  const pageSize = 100;
  const pages = Math.ceil(TARGET / pageSize);
  const all = [];
  for (let pageNo = 1; pageNo <= pages; pageNo++) {
    const url =
      'https://webapi.sporttery.cn/gateway/lottery/getHistoryPageListV1.qry' +
      `?gameNo=85&provinceId=0&pageSize=${pageSize}&isVerify=1&pageNo=${pageNo}`;
    const json = await getJSON(url, { Referer: 'https://static.sporttery.cn/' });
    const list = (json && json.value && json.value.list) || [];
    if (!list.length) break;
    for (const item of list) {
      const result = nums(item.lotteryDrawResult);
      if (result.length < 7) continue;
      all.push({
        issue: String(item.lotteryDrawNum || ''),
        date: String(item.lotteryDrawTime || '').slice(0, 10),
        front: sorted(result.slice(0, 5)),
        back: sorted(result.slice(5, 7)),
      });
    }
    if (list.length < pageSize) break;
    await sleep(450);
  }
  return all;
}

/* ---------------- 500.com 备用源 ---------------- */

const FIVE_HUNDRED = {
  ssq: 'https://datachart.500.com/ssq/history/newinc/history.php',
  dlt: 'https://datachart.500.com/dlt/history/newinc/history.php',
  fc3d: 'https://datachart.500.com/sd/history/inc/history.php',
  pl5: 'https://datachart.500.com/plw/history/inc/history.php',
};

async function fetch500(key) {
  if (key === 'kl8') return fetch500KL8();

  const base = FIVE_HUNDRED[key];
  if (!base) throw new Error('未知的备用彩种：' + key);
  const encoding = key === 'fc3d' || key === 'pl5' ? 'gbk' : 'utf-8';
  const html = await getText(
    `${base}?limit=${TARGET}&sort=0`,
    { Referer: 'https://datachart.500.com/' },
    encoding
  );
  const rows = [];
  const rowRe = /<tr[^>]*class="t_tr1"[^>]*>([\s\S]*?)<\/tr>/g;
  let match;

  const textNums = (row, cls) => {
    const re = new RegExp(`<td[^>]*class="[^"]*${cls}[^"]*"[^>]*>([\\s\\S]*?)</td>`, 'g');
    const out = [];
    let m;
    while ((m = re.exec(row))) {
      const txt = m[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, '').trim();
      txt.split(/\s+/).filter(Boolean).forEach((part) => {
        if (/^\d{1,2}$/.test(part)) out.push(Number(part));
      });
    }
    return out;
  };

  while ((match = rowRe.exec(html))) {
    const row = match[1].replace(/<!--[\s\S]*?-->/g, '');
    const cells = Array.from(row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)).map((x) =>
      x[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, '').trim()
    );
    if (!cells.length) continue;
    const rawIssue = cells[0];
    if (!/^\d{4,7}$/.test(rawIssue)) continue;
    const issue = key === 'ssq' && rawIssue.length === 5 ? '20' + rawIssue : rawIssue;
    const dateMatch = row.match(/\d{4}-\d{2}-\d{2}/);
    if (!dateMatch) continue;
    const date = dateMatch[0];

    if (key === 'ssq') {
      const front = textNums(row, 'cfont2');
      const back = textNums(row, 'cfont4');
      if (front.length !== 6 || back.length !== 1) continue;
      rows.push({ issue, date, front: sorted(front), back: sorted(back) });
    } else if (key === 'dlt') {
      const front = textNums(row, 'cfont2');
      const back = textNums(row, 'cfont4');
      if (front.length !== 5 || back.length !== 2) continue;
      rows.push({ issue, date, front: sorted(front), back: sorted(back) });
    } else if (key === 'fc3d') {
      const digits = textNums(row, 'cfont2');
      if (digits.length !== 3 || digits.some((n) => n > 9)) continue;
      rows.push({
        issue,
        date,
        digits: digits.slice(),
        hundreds: [digits[0]],
        tens: [digits[1]],
        units: [digits[2]],
      });
    } else if (key === 'pl5') {
      const digits = textNums(row, 'cfont2');
      if (digits.length !== 5 || digits.some((n) => n > 9)) continue;
      rows.push({
        issue,
        date,
        digits: digits.slice(),
        pos1: [digits[0]],
        pos2: [digits[1]],
        pos3: [digits[2]],
        pos4: [digits[3]],
        pos5: [digits[4]],
      });
    }
  }
  return rows;
}

async function fetch500KL8() {
  const html = await getText(
    `https://datachart.500.com/kl8/zoushi/newinc/jbzs_redblue.php?expect=${TARGET}`,
    { Referer: 'https://datachart.500.com/kl8/' },
    'utf-8'
  );
  const rows = [];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
  let match;
  while ((match = rowRe.exec(html))) {
    const row = match[1];
    const issueMatch = row.match(/<td[^>]*align="center"[^>]*>\s*(\d{7})\s*<\/td>/);
    if (!issueMatch) continue;
    const balls = Array.from(
      row.matchAll(/<td[^>]*class="chartBall01"[^>]*>\s*(\d{1,2})\s*<\/td>/g)
    ).map((x) => Number(x[1]));
    if (balls.length !== 20) continue;
    rows.push({ issue: issueMatch[1], main: sorted(balls) });
  }
  if (!rows.length) return rows;

  const descending = BigInt(rows[0].issue) > BigInt(rows[rows.length - 1].issue);
  const latestFirst = (descending ? rows.slice(0, TARGET) : rows.slice(-TARGET)).slice();
  if (!descending) latestFirst.reverse();

  const existing = readExisting();
  const anchor = existing.kl8 && existing.kl8.length ? existing.kl8[existing.kl8.length - 1] : null;
  let baseDate = new Date();
  if (
    anchor &&
    anchor.date &&
    /^\d{7}$/.test(anchor.issue) &&
    /^\d{7}$/.test(latestFirst[0].issue) &&
    anchor.issue.slice(0, 4) === latestFirst[0].issue.slice(0, 4)
  ) {
    const diff = Number(latestFirst[0].issue.slice(4)) - Number(anchor.issue.slice(4));
    if (diff >= 0 && diff <= 60) baseDate = addDays(parseDate(anchor.date), diff);
  }

  return latestFirst.map((row, i) => ({
    issue: row.issue,
    date: fmtDate(addDays(baseDate, -i)),
    main: row.main,
  }));
}

/* ---------------- 清洗与合并 ---------------- */

function validDraw(draw, cfg) {
  if (!draw || !draw.issue) return false;
  for (const zone of cfg.ticketZones) {
    const arr = draw[zone];
    const zoneCfg = cfg[zone];
    const need = zoneCfg.drawPick || zoneCfg.pick;
    if (!Array.isArray(arr) || arr.length !== need) return false;
    for (const n of arr) {
      if (!Number.isInteger(n) || n < zoneCfg.min || n > zoneCfg.max) return false;
    }
  }
  return true;
}

function clean(list, cfg) {
  const seen = new Set();
  return (list || [])
    .filter((d) => validDraw(d, cfg))
    .filter((d) => {
      if (seen.has(String(d.issue))) return false;
      seen.add(String(d.issue));
      return true;
    })
    .sort((a, b) => {
      const x = BigInt(a.issue);
      const y = BigInt(b.issue);
      return x < y ? -1 : x > y ? 1 : 0;
    })
    .slice(-TARGET);
}

function merge(existing, fresh, cfg) {
  const map = new Map();
  (existing || []).forEach((d) => map.set(String(d.issue), d));
  (fresh || []).forEach((d) => {
    const old = map.get(String(d.issue));
    map.set(String(d.issue), old && old.date ? Object.assign({}, d, { date: old.date }) : d);
  });
  return clean(Array.from(map.values()), cfg);
}

function readExisting() {
  const empty = { data: null, ssq: [], dlt: [], fc3d: [], kl8: [], pl5: [] };
  try {
    if (!existsSync(OUT)) return empty;
    const data = JSON.parse(readFileSync(OUT, 'utf8'));
    const out = { data };
    ['ssq', 'dlt', 'fc3d', 'kl8', 'pl5'].forEach((key) => {
      out[key] = (data[key] && data[key].draws) || [];
    });
    return out;
  } catch (err) {
    return empty;
  }
}

async function fetchGame(key) {
  const official = { ssq: fetchSSQ, dlt: fetchDLT, fc3d: fetchFC3D, kl8: fetchKL8 }[key];
  let raw = [];
  if (official && SOURCE !== '500') {
    try {
      raw = await official();
    } catch (err) {
      console.warn(`[fetch] ${GAMES[key].name}官网失败：`, err.message);
    }
  }
  if (raw.length < 30) {
    try {
      console.log(`[fetch] ${GAMES[key].name}切换 500.com 备用源…`);
      raw = await fetch500(key);
    } catch (err) {
      console.warn(`[fetch] ${GAMES[key].name} 500.com 失败：`, err.message);
    }
  }
  return raw;
}

async function main() {
  console.log(`[fetch] 目标期数：${TARGET}，数据源：${SOURCE}`);
  const existing = readExisting();
  const keys = ['ssq', 'dlt', 'fc3d', 'kl8', 'pl5'];
  const payload = {
    updatedAt: '',
    sources: [
      '中国福利彩票官网 cwl.gov.cn',
      '中国体育彩票官网 sporttery.cn',
      '500.com 走势图（备用）',
    ],
  };
  let changed = false;

  for (const key of keys) {
    const raw = await fetchGame(key);
    const fresh = clean(raw, GAMES[key]);
    const merged = merge(existing[key], fresh, GAMES[key]);
    if (merged.length < 30) {
      throw new Error(`${GAMES[key].name}数据不足：${merged.length} 期`);
    }
    payload[key] = Object.assign({}, GAMES[key], { draws: merged });

    const oldDraws = (existing.data && existing.data[key] && existing.data[key].draws) || [];
    if (JSON.stringify(oldDraws) !== JSON.stringify(merged)) changed = true;

    console.log(
      `  ${GAMES[key].name} ${merged.length} 期：${merged[0].issue} → ${
        merged[merged.length - 1].issue
      }（本次 ${fresh.length} 期）`
    );
  }

  payload.updatedAt =
    changed || !existing.data || !existing.data.updatedAt
      ? new Date().toISOString()
      : existing.data.updatedAt;

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(payload, null, 0), 'utf8');
  console.log(`[fetch] 已写入 ${OUT}`);
}

main().catch((err) => {
  console.error('[fetch] 失败：', err && err.message ? err.message : err);
  process.exitCode = 1;
});
