#!/usr/bin/env node
/**
 * 抓取双色球、大乐透历史开奖数据，生成 data/history.json
 * 数据源：
 *   - 中国福利彩票官网（双色球）
 *   - 中国体育彩票官网（大乐透）
 *   - 500.com 走势图（备用，GitHub Actions 海外服务器被官方接口拦截时使用）
 * 用法：node scripts/fetch-data.mjs [--draws=400] [--source=500] [--out=path]
 * GitHub Actions 中每日自动运行，见 .github/workflows/update-data.yml
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
    front: { min: 1, max: 33, pick: 6, label: '红球' },
    back: { min: 1, max: 16, pick: 1, label: '蓝球' },
  },
  dlt: {
    name: '大乐透',
    front: { min: 1, max: 35, pick: 5, label: '前区' },
    back: { min: 1, max: 12, pick: 2, label: '后区' },
  },
};

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
      if (attempt < 3) await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
  throw lastErr;
}

async function getText(url, headers = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': UA,
          Accept: 'text/html,application/xhtml+xml,text/plain,*/*',
          'Accept-Language': 'zh-CN,zh;q=0.9',
          ...headers,
        },
        signal: AbortSignal.timeout(25000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = await res.arrayBuffer();
      return new TextDecoder('utf-8').decode(buf);
    } catch (err) {
      lastErr = err;
      if (attempt < 3) await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
  throw lastErr;
}

const pad = (n) => String(n).padStart(2, '0');
const nums = (str, sep = /[\s,]+/) =>
  String(str || '')
    .trim()
    .split(sep)
    .map((s) => Number(s))
    .filter((n) => Number.isInteger(n) && n > 0);

async function fetchSSQ() {
  const all = [];
  const collect = (list) => {
    for (const item of list) {
      const front = nums(item.red);
      const back = nums(item.blue);
      if (front.length !== 6 || back.length !== 1) continue;
      all.push({
        issue: String(item.code || ''),
        date: String(item.date || '').slice(0, 10),
        front: front.slice().sort((a, b) => a - b),
        back: back.slice().sort((a, b) => a - b),
      });
    }
  };
  const base =
    'https://www.cwl.gov.cn/cwl_admin/front/cwlkj/search/kjxx/findDrawNotice';
  const headers = { Referer: 'https://www.cwl.gov.cn/ygkj/wqkjgg/ssq/' };

  // 福利彩票接口支持一次性返回全部期数（pageSize 上限实测 >= 400）
  try {
    const url = `${base}?name=ssq&issueCount=${TARGET}&issueStart=&issueEnd=&dayStart=&dayEnd=&pageNo=1&pageSize=${TARGET}&week=&systemType=PC`;
    const json = await getJSON(url, headers);
    collect((json && json.result) || []);
  } catch (err) {
    console.warn('[fetch] 双色球整包请求失败，回退分页：', err.message);
  }

  // 回退：不带 issueCount，逐页抓取
  if (all.length < TARGET) {
    const pageSize = 100;
    const pages = Math.ceil(TARGET / pageSize);
    for (let pageNo = 1; pageNo <= pages; pageNo++) {
      const url = `${base}?name=ssq&pageNo=${pageNo}&pageSize=${pageSize}&systemType=PC`;
      const json = await getJSON(url, headers);
      const list = (json && json.result) || [];
      if (!list.length) break;
      collect(list);
      if (list.length < pageSize) break;
      await new Promise((r) => setTimeout(r, 450));
    }
  }
  return all;
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
        front: result.slice(0, 5).sort((a, b) => a - b),
        back: result.slice(5, 7).sort((a, b) => a - b),
      });
    }
    if (list.length < pageSize) break;
    await new Promise((r) => setTimeout(r, 450));
  }
  return all;
}

function clean(list, cfg) {
  const seen = new Set();
  const out = list
    .filter((d) => d.issue && d.front.length === cfg.front.pick && d.back.length === cfg.back.pick)
    .filter((d) => {
      if (seen.has(d.issue)) return false;
      seen.add(d.issue);
      return true;
    })
    .sort((a, b) => (BigInt(a.issue) < BigInt(b.issue) ? -1 : BigInt(a.issue) > BigInt(b.issue) ? 1 : 0));
  return out.slice(-TARGET);
}

/* 备用数据源：500.com 走势图历史页，海外服务器也能访问 */
async function fetch500(key) {
  const cfg = GAMES[key];
  const limit = Math.min(1200, Math.max(30, TARGET));
  const url = `https://datachart.500.com/${key}/history/newinc/history.php?limit=${limit}&sort=0`;
  const html = await getText(url, { Referer: 'https://datachart.500.com/' });
  const rows = [];
  const rowRe = /<tr[^>]*class="t_tr1"[^>]*>([\s\S]*?)<\/tr>/g;
  let match;
  while ((match = rowRe.exec(html))) {
    const row = match[1].replace(/<!--[\s\S]*?-->/g, '');
    const cells = Array.from(row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)).map((x) =>
      x[1].replace(/<[^>]+>/g, '').replace(/&nbsp;|&#160;/g, '').trim()
    );
    if (cells.length < 8) continue;
    const issueRaw = cells[0];
    if (!/^\d{4,7}$/.test(issueRaw)) continue;
    const dateMatch = row.match(/\d{4}-\d{2}-\d{2}/);
    if (!dateMatch) continue;

    const grab = (cls) =>
      Array.from(
        row.matchAll(new RegExp(`<td[^>]*class="[^"]*${cls}[^"]*"[^>]*>\\s*(\\d{1,2})\\s*</td>`, 'g'))
      ).map((x) => Number(x[1]));
    const front = grab('cfont2');
    const back = grab('cfont4');
    if (front.length !== cfg.front.pick || back.length !== cfg.back.pick) continue;

    rows.push({
      issue: key === 'ssq' && issueRaw.length === 5 ? '20' + issueRaw : issueRaw,
      date: dateMatch[0],
      front: front.sort((a, b) => a - b),
      back: back.sort((a, b) => a - b),
    });
  }
  return rows;
}

function merge(existing, fresh, cfg) {
  return clean(fresh.concat(existing || []), cfg);
}

function readExisting() {
  try {
    if (!existsSync(OUT)) return { ssq: [], dlt: [] };
    const data = JSON.parse(readFileSync(OUT, 'utf8'));
    return {
      ssq: (data.ssq && data.ssq.draws) || [],
      dlt: (data.dlt && data.dlt.draws) || [],
    };
  } catch (err) {
    return { ssq: [], dlt: [] };
  }
}

async function main() {
  console.log(`[fetch] 目标期数：${TARGET}，数据源：${SOURCE}`);
  let ssqRaw = [];
  let dltRaw = [];
  let usedFallback = false;

  if (SOURCE === '500') {
    const results = await Promise.allSettled([fetch500('ssq'), fetch500('dlt')]);
    if (results[0].status === 'fulfilled') ssqRaw = results[0].value;
    else console.warn('[fetch] 500.com 双色球失败：', results[0].reason && results[0].reason.message);
    if (results[1].status === 'fulfilled') dltRaw = results[1].value;
    else console.warn('[fetch] 500.com 大乐透失败：', results[1].reason && results[1].reason.message);
    usedFallback = true;
  } else {
    const results = await Promise.allSettled([fetchSSQ(), fetchDLT()]);
    if (results[0].status === 'fulfilled') ssqRaw = results[0].value;
    else console.warn('[fetch] 双色球官网失败：', results[0].reason && results[0].reason.message);
    if (results[1].status === 'fulfilled') dltRaw = results[1].value;
    else console.warn('[fetch] 大乐透官网失败：', results[1].reason && results[1].reason.message);

    if (ssqRaw.length < 30) {
      try {
        console.log('[fetch] 双色球切换 500.com 备用源…');
        ssqRaw = await fetch500('ssq');
        usedFallback = true;
      } catch (err) {
        console.warn('[fetch] 500.com 双色球失败：', err.message);
      }
    }
    if (dltRaw.length < 30) {
      try {
        console.log('[fetch] 大乐透切换 500.com 备用源…');
        dltRaw = await fetch500('dlt');
        usedFallback = true;
      } catch (err) {
        console.warn('[fetch] 500.com 大乐透失败：', err.message);
      }
    }
  }

  const freshSsq = clean(ssqRaw, GAMES.ssq);
  const freshDlt = clean(dltRaw, GAMES.dlt);
  if (!freshSsq.length && !freshDlt.length) {
    throw new Error('所有数据源均失败，保留原数据');
  }

  const existing = readExisting();
  const ssq = merge(existing.ssq, freshSsq, GAMES.ssq);
  const dlt = merge(existing.dlt, freshDlt, GAMES.dlt);
  if (ssq.length < 30 || dlt.length < 30) {
    throw new Error(`数据量不足：双色球 ${ssq.length} 期，大乐透 ${dlt.length} 期`);
  }

  const sources = ['中国福利彩票官网 cwl.gov.cn', '中国体育彩票官网 sporttery.cn'];
  if (usedFallback) sources.push('500.com 走势图（备用）');

  const payload = {
    updatedAt: new Date().toISOString(),
    sources,
    ssq: { ...GAMES.ssq, draws: ssq },
    dlt: { ...GAMES.dlt, draws: dlt },
  };
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(payload, null, 0), 'utf8');
  console.log(
    `[fetch] 已写入 ${OUT}\n  双色球 ${ssq.length} 期：${ssq[0].issue} → ${ssq[ssq.length - 1].issue}（本次抓取 ${freshSsq.length} 期）\n  大乐透 ${dlt.length} 期：${dlt[0].issue} → ${dlt[dlt.length - 1].issue}（本次抓取 ${freshDlt.length} 期）`
  );
}

main().catch((err) => {
  console.error('[fetch] 失败：', err && err.message ? err.message : err);
  process.exitCode = 1;
});
