/*!
 * 双色球专属公式（红球 1–33 选 6 / 蓝球 1–16 选 1）
 *
 * 只在双色球上使用，不提供给大乐透或快乐8。
 * 双色球的结构特征：
 *   - 红球三区：1–11 / 12–22 / 23–33，每期通常每区各出 2 个
 *   - 红球 6 个，和值集中在 100 附近
 *   - 蓝球单独 1 个，与红球是独立摇奖
 */
(function (root, factory) {
  var Core = root.LotteryCore;
  if (!Core && typeof require === "function") Core = require("./core.js");
  var api = factory(Core);
  root.LotterySSQ = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (Core) {
  "use strict";

  var L = Core.Lib;
  var list = [];
  var nf = 0, nb = 0;

  function add(zone, cat, name, desc, run) {
    var id;
    if (zone === "front") { nf++; id = "S" + String(nf).padStart(3, "0"); }
    else { nb++; id = "Q" + String(nb).padStart(3, "0"); }
    list.push({ id: id, zone: zone, cat: cat, name: name, desc: desc, run: run });
  }

  function zone3(n) {
    if (n <= 11) return 0;
    if (n <= 22) return 1;
    return 2;
  }

  function countLast(ctx, n, w) { return L.countLast(ctx, n, w); }
  function omit(ctx, n) { return L.omission(ctx, n); }

  /* ==================== 红球：三区结构 ==================== */

  [1, 2, 3].forEach(function (z) {
    add("front", "三区", "第 " + z + " 区热号",
      "红球三区（1–11 / 12–22 / 23–33）中的第 " + z + " 区，推荐近 20 期出现最多的红球。",
      function (ctx) {
        var pool = ctx.cands.filter(function (n) { return zone3(n) === z - 1; });
        return L.bestOf(ctx, pool, function (n) { return countLast(ctx, n, 20); }, "recent");
      });
  });

  add("front", "三区", "补最冷区",
    "统计近 6 期红球三区各出多少个，找最冷的一区，推荐该区遗漏最久的红球。",
    function (ctx) {
      var zc = [0, 0, 0];
      ctx.seqs.slice(-6).forEach(function (arr) {
        arr.forEach(function (n) { zc[zone3(n)]++; });
      });
      var minZ = 0;
      for (var i = 1; i < 3; i++) if (zc[i] < zc[minZ]) minZ = i;
      var pool = ctx.cands.filter(function (n) { return zone3(n) === minZ; });
      return L.bestOf(ctx, pool, function (n) { return omit(ctx, n); }, "cold");
    });

  add("front", "三区", "三区均衡位",
    "取近 10 期红球中位数，推荐最接近该中位数的号，让组合落在中间区。",
    function (ctx) {
      var flat = [];
      ctx.seqs.slice(-10).forEach(function (arr) { flat = flat.concat(arr); });
      var target = L.median(flat);
      return L.bestOf(ctx, ctx.cands, function (n) {
        return -Math.abs(n - target) + countLast(ctx, n, 20) * 0.05;
      }, "small");
    });

  /* ==================== 红球：和值 / 跨度 ==================== */

  add("front", "和值", "和值回归号",
    "红球和值长期在 100 附近波动；若上期和值偏高则推荐低位号，偏低则推荐高位号。",
    function (ctx) {
      var lastSum = L.sum(ctx.last);
      var target = lastSum > 110 ? 12 : (lastSum < 92 ? 22 : 17);
      return L.bestOf(ctx, ctx.cands, function (n) {
        return -Math.abs(n - target) + countLast(ctx, n, 20) * 0.06;
      }, "small");
    });

  add("front", "和值", "中位和值补号",
    "取近 20 期红球和值中位数，换算成平均单号位置，推荐最接近该位置的号。",
    function (ctx) {
      var sums = ctx.seqs.slice(-20).map(function (arr) { return L.sum(arr); });
      var med = L.median(sums);
      var target = med / Math.max(1, ctx.pick);
      return L.bestOf(ctx, ctx.cands, function (n) {
        return -Math.abs(n - target);
      }, "small");
    });

  add("front", "跨度", "跨度端点号",
    "取近 10 期红球最小值与最大值，推荐最接近这两个端点的号。",
    function (ctx) {
      var flat = [];
      ctx.seqs.slice(-10).forEach(function (arr) { flat = flat.concat(arr); });
      if (!flat.length) return ctx.min;
      var lo = Math.min.apply(null, flat), hi = Math.max.apply(null, flat);
      return L.bestOf(ctx, ctx.cands, function (n) {
        return -Math.min(Math.abs(n - lo), Math.abs(n - hi));
      }, "small");
    });

  /* ==================== 红球：奇偶 / 大小 / 质合 ==================== */

  add("front", "形态", "奇偶补缺",
    "统计上期红球奇偶比，推荐较少一侧里近 20 期最热的红球（目标 3:3）。",
    function (ctx) {
      var odd = 0;
      ctx.last.forEach(function (n) { if (n % 2) odd++; });
      var needOdd = odd * 2 < ctx.last.length;
      var pool = ctx.cands.filter(function (n) { return needOdd ? n % 2 === 1 : n % 2 === 0; });
      return L.bestOf(ctx, pool, function (n) { return countLast(ctx, n, 20); }, "recent");
    });

  add("front", "形态", "大小补缺",
    "以 17 为界，推荐上期较少一侧里最热的红球。",
    function (ctx) {
      var small = 0;
      ctx.last.forEach(function (n) { if (n <= 16) small++; });
      var needSmall = small * 2 < ctx.last.length;
      var pool = ctx.cands.filter(function (n) { return needSmall ? n <= 16 : n > 16; });
      return L.bestOf(ctx, pool, function (n) { return countLast(ctx, n, 20); }, "recent");
    });

  add("front", "形态", "质数回补",
    "统计上期红球质数个数，若少于 2 个则推荐遗漏最久的质数，否则推荐合数。",
    function (ctx) {
      var isP = function (n) {
        if (n < 2) return false;
        for (var i = 2; i * i <= n; i++) if (n % i === 0) return false;
        return true;
      };
      var pc = 0;
      ctx.last.forEach(function (n) { if (isP(n)) pc++; });
      var wantPrime = pc < 2;
      var pool = ctx.cands.filter(function (n) { return isP(n) === wantPrime; });
      return L.bestOf(ctx, pool, function (n) { return omit(ctx, n); }, "cold");
    });

  /* ==================== 红球：连号 / 尾数 ==================== */

  add("front", "连号", "上期邻号",
    "推荐上期红球 ±1 中近 20 期最热的一个，双色球邻号平均每期出现约 1 个。",
    function (ctx) {
      var pool = [];
      ctx.last.forEach(function (n) {
        if (n - 1 >= ctx.min) pool.push(n - 1);
        if (n + 1 <= ctx.max) pool.push(n + 1);
      });
      if (!pool.length) return ctx.min;
      return L.bestOf(ctx, pool, function (n) { return countLast(ctx, n, 20); }, "recent");
    });

  add("front", "连号", "斜连延伸",
    "上上期有 X、上期有 X+1 时，推荐 X+2（斜连走势）。",
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

  add("front", "尾数", "热尾红球",
    "统计近 20 期红球尾数分布，推荐最热尾数里遗漏最久的红球。",
    function (ctx) {
      var tc = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
      ctx.seqs.slice(-20).forEach(function (arr) { arr.forEach(function (n) { tc[n % 10]++; }); });
      var bestT = 0;
      for (var i = 1; i < 10; i++) if (tc[i] > tc[bestT]) bestT = i;
      var pool = ctx.cands.filter(function (n) { return n % 10 === bestT; });
      return L.bestOf(ctx, pool, function (n) { return omit(ctx, n); }, "cold");
    });

  add("front", "尾数", "同尾跟随",
    "取上期红球尾数最多的一尾，推荐该尾中不在上期的号。",
    function (ctx) {
      var tc = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
      ctx.last.forEach(function (n) { tc[n % 10]++; });
      var bestT = 0;
      for (var i = 1; i < 10; i++) if (tc[i] > tc[bestT]) bestT = i;
      var pool = ctx.cands.filter(function (n) {
        return n % 10 === bestT && ctx.last.indexOf(n) === -1;
      });
      if (!pool.length) return ctx.min;
      return L.bestOf(ctx, pool, function (n) { return countLast(ctx, n, 20); }, "recent");
    });

  /* ==================== 蓝球（16 选 1） ==================== */

  add("back", "蓝球", "蓝球遗漏",
    "推荐蓝球中当前遗漏期数最大的号。",
    function (ctx) { return L.best(ctx, function (n) { return omit(ctx, n); }, "cold"); });

  add("back", "蓝球", "蓝球热号",
    "推荐近 20 期蓝球出现次数最多的号。",
    function (ctx) { return L.best(ctx, function (n) { return countLast(ctx, n, 20); }, "recent"); });

  add("back", "蓝球", "蓝球奇偶交替",
    "若上期蓝球为奇则推荐偶数蓝球中遗漏最久的，反之亦然。",
    function (ctx) {
      var lastOdd = ctx.last.length ? ctx.last[0] % 2 === 1 : false;
      var pool = ctx.cands.filter(function (n) { return lastOdd ? n % 2 === 0 : n % 2 === 1; });
      return L.bestOf(ctx, pool, function (n) { return omit(ctx, n); }, "cold");
    });

  add("back", "蓝球", "红球和值映射",
    "用上期红球和值对 16 取模换算蓝球位置，推荐最接近该位置的蓝球（纯统计巧合，无因果关系）。",
    function (ctx) {
      var target = (L.sum(ctx.last) % 16) + 1;
      return L.bestOf(ctx, ctx.cands, function (n) {
        return -Math.abs(n - target);
      }, "small");
    });

  add("back", "蓝球", "蓝球四分区",
    "把 1–16 分成 4 段，推荐近 12 期出现最少的段里遗漏最久的蓝球。",
    function (ctx) {
      var zc = [0, 0, 0, 0];
      ctx.seqs.slice(-12).forEach(function (arr) {
        arr.forEach(function (n) { zc[Math.floor((n - 1) / 4)]++; });
      });
      var minZ = 0;
      for (var i = 1; i < 4; i++) if (zc[i] < zc[minZ]) minZ = i;
      var pool = ctx.cands.filter(function (n) { return Math.floor((n - 1) / 4) === minZ; });
      return L.bestOf(ctx, pool, function (n) { return omit(ctx, n); }, "cold");
    });

  add("back", "蓝球", "蓝球尾数偏好",
    "统计近 20 期蓝球尾数，推荐最热尾数里遗漏最久的蓝球。",
    function (ctx) {
      var tc = {};
      ctx.seqs.slice(-20).forEach(function (arr) {
        arr.forEach(function (n) { tc[n % 10] = (tc[n % 10] || 0) + 1; });
      });
      var bestT = null, bestC = -1;
      Object.keys(tc).forEach(function (k) {
        if (tc[k] > bestC) { bestC = tc[k]; bestT = Number(k); }
      });
      if (bestT === null) return ctx.min;
      var pool = ctx.cands.filter(function (n) { return n % 10 === bestT; });
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
