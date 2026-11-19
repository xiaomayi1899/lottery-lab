/*!
 * 大乐透专属公式（前区 1–35 选 5 / 后区 1–12 选 2）
 *
 * 只在超级大乐透上使用，不提供给双色球或快乐8。
 * 与双色球的关键差异：
 *   - 前区 35 个号选 5 个（双色球是 33 选 6），号码更分散
 *   - 后区是「12 选 2」，是组合问题；双色球蓝球是「16 选 1」
 *   - 后区两个号的和值、跨度、配对关系是大乐透独有特征
 */
(function (root, factory) {
  var Core = root.LotteryCore;
  if (!Core && typeof require === "function") Core = require("./core.js");
  var api = factory(Core);
  root.LotteryDLT = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (Core) {
  "use strict";

  var L = Core.Lib;
  var list = [];
  var nf = 0, nb = 0;

  function add(zone, cat, name, desc, run) {
    var id;
    if (zone === "front") { nf++; id = "P" + String(nf).padStart(3, "0"); }
    else { nb++; id = "R" + String(nb).padStart(3, "0"); }
    list.push({ id: id, zone: zone, cat: cat, name: name, desc: desc, run: run });
  }

  function countLast(ctx, n, w) { return L.countLast(ctx, n, w); }
  function omit(ctx, n) { return L.omission(ctx, n); }

  /* 大乐透前区三区：1–12 / 13–24 / 25–35 */
  function zone3(n) {
    if (n <= 12) return 0;
    if (n <= 24) return 1;
    return 2;
  }
  /* 五分区：每区 7 个号 */
  function zone5(n) { return Math.min(4, Math.floor((n - 1) / 7)); }

  /* ==================== 前区：三区 / 五分区 ==================== */

  [1, 2, 3].forEach(function (z) {
    add("front", "三区", "第 " + z + " 区热号",
      "前区三区（1–12 / 13–24 / 25–35）中的第 " + z + " 区，推荐近 24 期出现最多的号。",
      function (ctx) {
        var pool = ctx.cands.filter(function (n) { return zone3(n) === z - 1; });
        return L.bestOf(ctx, pool, function (n) { return countLast(ctx, n, 24); }, "recent");
      });
  });

  add("front", "三区", "补最冷区",
    "统计近 5 期前区三区分布，推荐最冷一区里遗漏最久的号。",
    function (ctx) {
      var zc = [0, 0, 0];
      ctx.seqs.slice(-5).forEach(function (arr) {
        arr.forEach(function (n) { zc[zone3(n)]++; });
      });
      var minZ = 0;
      for (var i = 1; i < 3; i++) if (zc[i] < zc[minZ]) minZ = i;
      var pool = ctx.cands.filter(function (n) { return zone3(n) === minZ; });
      return L.bestOf(ctx, pool, function (n) { return omit(ctx, n); }, "cold");
    });

  add("front", "五分区", "五区热号",
    "把 1–35 分成 5 段（每段 7 个号），推荐近 30 期最热那一段里最热的号。",
    function (ctx) {
      var zc = [0, 0, 0, 0, 0];
      ctx.seqs.slice(-30).forEach(function (arr) {
        arr.forEach(function (n) { zc[zone5(n)]++; });
      });
      var best = 0;
      for (var i = 1; i < 5; i++) if (zc[i] > zc[best]) best = i;
      var pool = ctx.cands.filter(function (n) { return zone5(n) === best; });
      return L.bestOf(ctx, pool, function (n) { return countLast(ctx, n, 20); }, "recent");
    });

  /* ==================== 前区：和值 / 跨度 ==================== */

  add("front", "和值", "和值回归号",
    "前区 5 个号和值中位数约 90；上期偏高则推低位号，偏低则推高位号。",
    function (ctx) {
      var lastSum = L.sum(ctx.last);
      var target = lastSum > 100 ? 12 : (lastSum < 80 ? 24 : 18);
      return L.bestOf(ctx, ctx.cands, function (n) {
        return -Math.abs(n - target) + countLast(ctx, n, 24) * 0.06;
      }, "small");
    });

  add("front", "和值", "中位和值补号",
    "取近 24 期前区和值中位数，换算成平均单号位置，推荐最接近该位置的号。",
    function (ctx) {
      var sums = ctx.seqs.slice(-24).map(function (arr) { return L.sum(arr); });
      var target = L.median(sums) / Math.max(1, ctx.pick);
      return L.bestOf(ctx, ctx.cands, function (n) { return -Math.abs(n - target); }, "small");
    });

  add("front", "跨度", "跨度端点号",
    "取近 10 期前区最小/最大值，推荐最接近端点的号（大乐透跨度上限 34）。",
    function (ctx) {
      var flat = [];
      ctx.seqs.slice(-10).forEach(function (arr) { flat = flat.concat(arr); });
      if (!flat.length) return ctx.min;
      var lo = Math.min.apply(null, flat), hi = Math.max.apply(null, flat);
      return L.bestOf(ctx, ctx.cands, function (n) {
        return -Math.min(Math.abs(n - lo), Math.abs(n - hi));
      }, "small");
    });

  /* ==================== 前区：形态 ==================== */

  add("front", "形态", "奇偶补缺",
    "5 个号通常 2:3 或 3:2；推荐上期较少一侧里近 24 期最热的号。",
    function (ctx) {
      var odd = 0;
      ctx.last.forEach(function (n) { if (n % 2) odd++; });
      var needOdd = odd * 2 < ctx.last.length;
      var pool = ctx.cands.filter(function (n) { return needOdd ? n % 2 === 1 : n % 2 === 0; });
      return L.bestOf(ctx, pool, function (n) { return countLast(ctx, n, 24); }, "recent");
    });

  add("front", "形态", "大小补缺",
    "以 18 为界，推荐上期较少一侧里最热的号。",
    function (ctx) {
      var small = 0;
      ctx.last.forEach(function (n) { if (n <= 18) small++; });
      var needSmall = small * 2 < ctx.last.length;
      var pool = ctx.cands.filter(function (n) { return needSmall ? n <= 18 : n > 18; });
      return L.bestOf(ctx, pool, function (n) { return countLast(ctx, n, 24); }, "recent");
    });

  add("front", "形态", "质数回补",
    "上期前区质数少于 1 个时推荐遗漏最久的质数，否则推荐合数。",
    function (ctx) {
      var isP = function (n) {
        if (n < 2) return false;
        for (var i = 2; i * i <= n; i++) if (n % i === 0) return false;
        return true;
      };
      var pc = 0;
      ctx.last.forEach(function (n) { if (isP(n)) pc++; });
      var wantPrime = pc < 1;
      var pool = ctx.cands.filter(function (n) { return isP(n) === wantPrime; });
      return L.bestOf(ctx, pool, function (n) { return omit(ctx, n); }, "cold");
    });

  /* ==================== 前区：连号 / 尾数 ==================== */

  add("front", "连号", "上期邻号",
    "推荐上期前区 ±1 中近 24 期最热的号。",
    function (ctx) {
      var pool = [];
      ctx.last.forEach(function (n) {
        if (n - 1 >= ctx.min) pool.push(n - 1);
        if (n + 1 <= ctx.max) pool.push(n + 1);
      });
      if (!pool.length) return ctx.min;
      return L.bestOf(ctx, pool, function (n) { return countLast(ctx, n, 24); }, "recent");
    });

  add("front", "连号", "斜连延伸",
    "上上期有 X、上期有 X+1 时，推荐 X+2。",
    function (ctx) {
      var p2 = ctx.seqs[ctx.seqs.length - 3] || [];
      var p1 = ctx.seqs[ctx.seqs.length - 2] || [];
      var pool = [];
      p1.forEach(function (x) {
        if (p2.indexOf(x - 1) !== -1 && x + 1 <= ctx.max) pool.push(x + 1);
        if (p2.indexOf(x + 1) !== -1 && x - 1 >= ctx.min) pool.push(x - 1);
      });
      if (!pool.length) return L.best(ctx, function (n) { return omit(ctx, n); }, "cold");
      return L.bestOf(ctx, pool, function (n) { return omit(ctx, n); }, "cold");
    });

  add("front", "尾数", "热尾前区",
    "统计近 24 期前区尾数分布，推荐最热尾数里遗漏最久的号。",
    function (ctx) {
      var tc = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
      ctx.seqs.slice(-24).forEach(function (arr) { arr.forEach(function (n) { tc[n % 10]++; }); });
      var bestT = 0;
      for (var i = 1; i < 10; i++) if (tc[i] > tc[bestT]) bestT = i;
      var pool = ctx.cands.filter(function (n) { return n % 10 === bestT; });
      return L.bestOf(ctx, pool, function (n) { return omit(ctx, n); }, "cold");
    });

  add("front", "尾数", "同尾跟随",
    "取上期前区尾数最多的一尾，推荐该尾中不在上期的号。",
    function (ctx) {
      var tc = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
      ctx.last.forEach(function (n) { tc[n % 10]++; });
      var bestT = 0;
      for (var i = 1; i < 10; i++) if (tc[i] > tc[bestT]) bestT = i;
      var pool = ctx.cands.filter(function (n) {
        return n % 10 === bestT && ctx.last.indexOf(n) === -1;
      });
      if (!pool.length) return ctx.min;
      return L.bestOf(ctx, pool, function (n) { return countLast(ctx, n, 24); }, "recent");
    });

  add("front", "尾部", "高位补号",
    "大乐透 32–35 是双色球没有的号段，大众偏爱小号；推荐该段遗漏最久的号。",
    function (ctx) {
      var pool = ctx.cands.filter(function (n) { return n >= 32; });
      if (!pool.length) return ctx.max;
      return L.bestOf(ctx, pool, function (n) { return omit(ctx, n); }, "cold");
    });

  /* ==================== 后区（12 选 2，组合问题） ==================== */

  add("back", "后区", "后区遗漏",
    "推荐后区当前遗漏期数最大的号。",
    function (ctx) { return L.best(ctx, function (n) { return omit(ctx, n); }, "cold"); });

  add("back", "后区", "后区热号",
    "推荐近 20 期后区出现次数最多的号。",
    function (ctx) { return L.best(ctx, function (n) { return countLast(ctx, n, 20); }, "recent"); });

  add("back", "后区", "后区和值补位",
    "后区两个号的和值多在 9–17；推荐能让和值落回中位区间的号。",
    function (ctx) {
      var lastSum = ctx.last.length >= 2 ? L.sum(ctx.last) : 13;
      var target = lastSum > 16 ? 4 : (lastSum < 10 ? 9 : 7);
      return L.bestOf(ctx, ctx.cands, function (n) {
        return -Math.abs(n - target) + countLast(ctx, n, 20) * 0.1;
      }, "small");
    });

  add("back", "后区", "后区跨度驱动",
    "后区两个号的跨度多为 3–8；推荐能与上期某个号凑出该跨度的号。",
    function (ctx) {
      var base = ctx.last.length ? ctx.last[0] : 6;
      var pool = ctx.cands.filter(function (n) {
        var gap = Math.abs(n - base);
        return gap >= 3 && gap <= 8;
      });
      if (!pool.length) return ctx.min;
      return L.bestOf(ctx, pool, function (n) { return countLast(ctx, n, 20); }, "recent");
    });

  add("back", "后区", "后区奇偶配对",
    "后区常出现一奇一偶；推荐与上期后区奇偶相反、且遗漏最久的号。",
    function (ctx) {
      var lastOdd = ctx.last.length ? ctx.last[0] % 2 === 1 : false;
      var pool = ctx.cands.filter(function (n) { return lastOdd ? n % 2 === 0 : n % 2 === 1; });
      return L.bestOf(ctx, pool, function (n) { return omit(ctx, n); }, "cold");
    });

  add("back", "后区", "后区邻号",
    "推荐上期后区 ±1 中遗漏最久的号。",
    function (ctx) {
      var pool = [];
      ctx.last.forEach(function (n) {
        if (n - 1 >= ctx.min) pool.push(n - 1);
        if (n + 1 <= ctx.max) pool.push(n + 1);
      });
      if (!pool.length) return ctx.min;
      return L.bestOf(ctx, pool, function (n) { return omit(ctx, n); }, "cold");
    });

  add("back", "后区", "后区四分区",
    "把 1–12 分成 4 段，推荐近 12 期最冷一段里遗漏最久的号。",
    function (ctx) {
      var zc = [0, 0, 0, 0];
      ctx.seqs.slice(-12).forEach(function (arr) {
        arr.forEach(function (n) { zc[Math.floor((n - 1) / 3)]++; });
      });
      var minZ = 0;
      for (var i = 1; i < 4; i++) if (zc[i] < zc[minZ]) minZ = i;
      var pool = ctx.cands.filter(function (n) { return Math.floor((n - 1) / 3) === minZ; });
      return L.bestOf(ctx, pool, function (n) { return omit(ctx, n); }, "cold");
    });

  var front = list.filter(function (f) { return f.zone === "front"; });
  var back = list.filter(function (f) { return f.zone === "back"; });

  return {
    all: list,
    front: front,
    back: back,
    count: list.length,
    stats: { front: front.length, back: back.length },
  };
});
