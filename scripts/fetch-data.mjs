#!/usr/bin/env node
/**
 * 抓取双色球、大乐透历史开奖数据，生成 data/history.json
 * 数据源：
 *   - 中国福利彩票官网（双色球）
 *   - 中国体育彩票官网（大乐透）
 * 用法：node scripts/fetch-data.mjs [--draws=400]
 * GitHub Actions 中每日自动运行，见 .github/workflows/update-data.yml
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const OUT = resolve(ROOT, 'data/history.json');

const arg = process.argv.find((a) => a.startsWith('--draws='));
const TARGET = Math.max(120, Math.min(1200, Number(arg ? arg.split('=')[1] : 400) || 400));

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

async function main() {
  console.log(`[fetch] 目标期数：${TARGET}`);
  const [ssqRaw, dltRaw] = await Promise.all([fetchSSQ(), fetchDLT()]);
  const ssq = clean(ssqRaw, GAMES.ssq);
  const dlt = clean(dltRaw, GAMES.dlt);
  if (ssq.length < 30 || dlt.length < 30) {
    throw new Error(`数据量不足：双色球 ${ssq.length} 期，大乐透 ${dlt.length} 期`);
  }

  const payload = {
    updatedAt: new Date().toISOString(),
    sources: ['中国福利彩票官网 cwl.gov.cn', '中国体育彩票官网 sporttery.cn'],
    ssq: { ...GAMES.ssq, draws: ssq },
    dlt: { ...GAMES.dlt, draws: dlt },
  };
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(payload, null, 0), 'utf8');
  console.log(
    `[fetch] 已写入 ${OUT}\n  双色球 ${ssq.length} 期：${ssq[0].issue} → ${ssq[ssq.length - 1].issue}\n  大乐透 ${dlt.length} 期：${dlt[0].issue} → ${dlt[dlt.length - 1].issue}`
  );
}

main().catch((err) => {
  console.error('[fetch] 失败：', err && err.message ? err.message : err);
  process.exitCode = 1;
});
