#!/usr/bin/env node
/* 引擎自测：node scripts/selftest.mjs */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const core = require(resolve(ROOT, 'assets/core.js'));
const formulas = require(resolve(ROOT, 'assets/formulas.js'));
const data = JSON.parse(readFileSync(resolve(ROOT, 'data/history.json'), 'utf8'));

const GAME_KEYS = ['ssq', 'dlt', 'fc3d', 'kl8', 'pl5'];
let failed = 0;
function ok(cond, label) {
  if (cond) return;
  failed++;
  console.error('  ✗ ' + label);
}
function section(t) { console.log('\n■ ' + t); }
function zonesOf(key) { return core.GAMES[key].ticketZones; }
function poolFor(key, zone) {
  if (key === 'kl8') return formulas.front;
  if (zone === 'front' || zone === 'back') return formulas[zone];
  return formulas.digit;
}
function fmt(n, cfg) {
  return cfg.min === 0 && cfg.max === 9 ? String(n) : String(n).padStart(2, '0');
}
function drawText(key, draw) {
  if (key === 'ssq' || key === 'dlt') {
    return draw.front.map((n) => String(n).padStart(2, '0')).join(',') + ' + ' +
      draw.back.map((n) => String(n).padStart(2, '0')).join(',');
  }
  if (key === 'kl8') return draw.main.map((n) => String(n).padStart(2, '0')).join(',');
  return draw.digits.join(' ');
}

section('公式库');
console.log(
  `双色球/大乐透 ${formulas.stats.total}（前区 ${formulas.stats.front} / 后区 ${formulas.stats.back}）` +
  ` · 3D/排列五数字 ${formulas.stats.digit} · 全部 ${formulas.stats.allTotal}`
);
console.log('分类：', formulas.stats.categories);
ok(formulas.stats.total >= 265, '双色球/大乐透公式总数不少于 265');
ok(formulas.stats.front >= 170, '前区公式不少于 170');
ok(formulas.stats.back >= 95, '后区公式不少于 95');
ok(formulas.stats.digit >= 90, '数字位置公式不少于 90');
const ids = new Set(formulas.all.map((f) => f.id));
ok(ids.size === formulas.all.length, '公式 id 唯一');
const names = new Set(formulas.all.map((f) => f.zone + '|' + f.name));
ok(names.size === formulas.all.length, '同一分区内公式名称唯一');
ok(formulas.all.every((f) => f.desc && f.desc.length >= 10), '每个公式都有说明');

section('边界与确定性');
for (const key of GAME_KEYS) {
  const cfg = core.GAMES[key];
  const game = { ...data[key], key };
  for (const zone of zonesOf(key)) {
    const list = poolFor(key, zone);
    const cfgZone = cfg[zone];
    const lens = [10, 30, 100, game.draws.length];
    let bad = 0, nondet = 0;
    for (const len of lens) {
      const draws = game.draws.slice(-len);
      for (const f of list) {
        const ctx = core.makeCtx(draws, cfgZone, zone);
        const a = core.safeRun(f, ctx);
        const b = core.safeRun(f, ctx);
        if (!Number.isInteger(a) || a < cfgZone.min || a > cfgZone.max) bad++;
        if (a !== b) nondet++;
      }
    }
    ok(bad === 0, `${key}/${zone} 所有公式在 10/30/100/全部历史下均落在号码区间内（异常 ${bad}）`);
    ok(nondet === 0, `${key}/${zone} 公式输出确定（不一致 ${nondet}）`);
    console.log(`  ${key}/${zone}: ${list.length} 个公式 × ${lens.length} 种历史长度，全部通过`);
  }
}

section('投票推荐');
for (const key of GAME_KEYS) {
  const game = { ...data[key], key };
  for (const zone of zonesOf(key)) {
    const list = poolFor(key, zone);
    const cfg = game[zone];
    const t0 = Date.now();
    const a = core.analyze(game, zone, list, { window: 40 });
    const ms = Date.now() - t0;
    const b = core.analyze(game, zone, list, { window: 40 });
    ok(a.numbers.length === cfg.pick, `${key}/${zone} 选出 ${cfg.pick} 个号码`);
    ok(new Set(a.numbers).size === cfg.pick, `${key}/${zone} 号码不重复`);
    ok(a.numbers.every((n) => n >= cfg.min && n <= cfg.max), `${key}/${zone} 号码在区间内`);
    ok(a.numbers.slice().sort((x, y) => x - y).join(',') === a.numbers.join(','), `${key}/${zone} 号码升序`);
    ok(a.details.length === list.length, `${key}/${zone} 每个公式都产出推荐`);
    ok(a.details.every((d) => d.rec >= cfg.min && d.rec <= cfg.max), `${key}/${zone} 公式推荐均在区间内`);
    ok(a.ranking.reduce((s, r) => s + r.votes, 0) === list.length, `${key}/${zone} 票数守恒`);
    ok(a.ranking[0].weight >= a.ranking[a.ranking.length - 1].weight, `${key}/${zone} 排名按权重降序`);
    ok(a.numbers.join(',') === b.numbers.join(','), `${key}/${zone} 推荐结果可复现`);
    const lastNumbers = (game.draws[game.draws.length - 1][zone] || []);
    const repeats = a.numbers.filter((n) => lastNumbers.includes(n)).length;
    ok(repeats <= a.stats.repeatLimit, `${key}/${zone} 与上期重号不超过 ${a.stats.repeatLimit} 个（实际 ${repeats}）`);
    ok(a.stats.repeatCount === repeats, `${key}/${zone} 重号统计一致`);
    console.log(
      `  ${key}/${zone}: ${a.numbers.map((n) => fmt(n, cfg)).join(' ')}` +
      ` | ${a.details.length} 票 · ${ms}ms · 加权命中率 ${(a.stats.avgRate * 100).toFixed(1)}%` +
      ` | 重号 ${repeats}/${a.stats.repeatLimit}` +
      ` | 票王 ${fmt(a.ranking[0].n, cfg)}（${a.ranking[0].votes} 票 / ${a.ranking[0].weight.toFixed(2)} 权重）`
    );
  }
}

section('备选票');
for (const key of GAME_KEYS) {
  const game = { ...data[key], key };
  for (const zone of zonesOf(key)) {
    const cfg = game[zone];
    const base = core.analyze(game, zone, poolFor(key, zone), { window: 40 });
    const baseCopy = base.numbers.join(',');
    let changed = 0;
    for (const salt of [1, 2, 3]) {
      const alt = core.reweight(game, base, salt);
      ok(alt.numbers.length === cfg.pick, `${key}/${zone} 备选 ${salt} 号码数量正确`);
      ok(new Set(alt.numbers).size === cfg.pick, `${key}/${zone} 备选 ${salt} 号码不重复`);
      ok(alt.numbers.every((n) => n >= cfg.min && n <= cfg.max), `${key}/${zone} 备选 ${salt} 号码在区间内`);
      ok(alt.numbers.slice().sort((x, y) => x - y).join(',') === alt.numbers.join(','), `${key}/${zone} 备选 ${salt} 升序`);
      if (alt.numbers.join(',') !== baseCopy) changed++;
      ok(alt.stats.salt === salt, `${key}/${zone} 备选 ${salt} 记录盐值`);
    }
    ok(base.numbers.join(',') === baseCopy, `${key}/${zone} 生成备选不会改动主推`);
    ok(changed >= 2, `${key}/${zone} 至少两组备选与主推不同（实际 ${changed}/3）`);

    let avoid = base.numbers.slice();
    const seqAlts = [1, 2].map((salt) => {
      const alt = core.reweight(game, base, salt, avoid);
      avoid = avoid.concat(alt.numbers);
      return alt;
    });
    ok(seqAlts[0].numbers.join(',') !== seqAlts[1].numbers.join(','), `${key}/${zone} 两个备选票互不相同`);
    console.log(`  ${key}/${zone}: 主推 ${base.numbers.map((n) => fmt(n, cfg)).join(' ')} · 顺序备选 ` +
      seqAlts.map((x) => x.numbers.map((n) => fmt(n, cfg)).join('/')).join(' | '));
  }
}

section('走势图');
for (const key of GAME_KEYS) {
  const game = { ...data[key], key };
  for (const zone of zonesOf(key)) {
    const cfg = core.GAMES[key][zone];
    const rows = core.trend(game.draws, zone, cfg, 30);
    ok(rows.length === 30, `${key}/${zone} 走势 30 行`);
    ok(rows.every((r) => r.cells.length === cfg.max - cfg.min + 1), `${key}/${zone} 每行号码列完整`);
    ok(rows.every((r) => r.cells.every((c) => c.hit === r.numbers.includes(c.n))), `${key}/${zone} 命中标记正确`);
    ok(rows.every((r) => r.cells.every((c) => c.hit ? c.omission === 0 : c.omission > 0)), `${key}/${zone} 遗漏值正确`);
    console.log(`  ${key}/${zone}: ${rows.length} 期 × ${rows[0].cells.length} 列`);
  }
}

section('数据新鲜度');
for (const key of GAME_KEYS) {
  const g = data[key];
  const last = g.draws[g.draws.length - 1];
  console.log(`  ${g.name} ${last.issue} ${last.date} ${drawText(key, last)}`);
  ok(g.draws.length >= 300, `${g.name} 至少 300 期历史数据`);
}

if (failed) {
  console.error(`\n✗ 自测失败：${failed} 项`);
  process.exit(1);
}
console.log('\n✓ 全部自测通过');
