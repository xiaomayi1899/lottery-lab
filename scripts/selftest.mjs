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

let failed = 0;
function ok(cond, label) {
  if (cond) return;
  failed++;
  console.error('  ✗ ' + label);
}
function section(t) { console.log('\n■ ' + t); }

section('公式库');
console.log(
  `总数 ${formulas.stats.total}（前区 ${formulas.stats.front} / 后区 ${formulas.stats.back}）`
);
console.log('分类：', formulas.stats.categories);
ok(formulas.stats.total >= 100, '公式总数不少于 100');
ok(formulas.stats.front >= 60, '前区公式不少于 60');
ok(formulas.stats.back >= 30, '后区公式不少于 30');
const ids = new Set(formulas.all.map((f) => f.id));
ok(ids.size === formulas.all.length, '公式 id 唯一');
const names = new Set(formulas.all.map((f) => f.zone + '|' + f.name));
ok(names.size === formulas.all.length, '同一分区内公式名称唯一');
ok(formulas.all.every((f) => f.desc && f.desc.length >= 10), '每个公式都有说明');

section('边界与确定性');
for (const key of ['ssq', 'dlt']) {
  const cfg = core.GAMES[key];
  const game = { ...data[key], key };
  for (const zone of ['front', 'back']) {
    const list = formulas[zone];
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
for (const key of ['ssq', 'dlt']) {
  const game = { ...data[key], key };
  for (const zone of ['front', 'back']) {
    const list = formulas[zone];
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
    console.log(
      `  ${key}/${zone}: ${a.numbers.map((n) => String(n).padStart(2, '0')).join(' ')}` +
      ` | ${a.details.length} 票 · ${ms}ms · 加权命中率 ${(a.stats.avgRate * 100).toFixed(1)}%` +
      ` | 票王 ${a.ranking[0].n}（${a.ranking[0].votes} 票 / ${a.ranking[0].weight.toFixed(2)} 权重）`
    );
  }
}

section('备选票');
for (const key of ['ssq', 'dlt']) {
  const game = { ...data[key], key };
  for (const zone of ['front', 'back']) {
    const cfg = game[zone];
    const base = core.analyze(game, zone, formulas[zone], { window: 40 });
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
    console.log(`  ${key}/${zone}: 主推 ${baseCopy} · 备选 ${[1, 2, 3].map((s) => core.reweight(game, base, s).numbers.join('/')).join(' | ')}`);
  }
}

section('走势图');
for (const key of ['ssq', 'dlt']) {
  const game = { ...data[key], key };
  for (const zone of ['front', 'back']) {
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
const ssqLast = data.ssq.draws[data.ssq.draws.length - 1];
const dltLast = data.dlt.draws[data.dlt.draws.length - 1];
console.log(`  双色球 ${ssqLast.issue} ${ssqLast.date} ${ssqLast.front.join(',')}+${ssqLast.back}`);
console.log(`  大乐透 ${dltLast.issue} ${dltLast.date} ${dltLast.front.join(',')}+${dltLast.back}`);
ok(data.ssq.draws.length >= 300 && data.dlt.draws.length >= 300, '至少 300 期历史数据');

if (failed) {
  console.error(`\n✗ 自测失败：${failed} 项`);
  process.exit(1);
}
console.log('\n✓ 全部自测通过');
