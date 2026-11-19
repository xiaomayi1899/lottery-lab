/*!
 * 快乐8 专属公式（1–80，每期开 20 个，票选 10 个）
 *
 * 与双色球/大乐透的 33/35 号池公式完全不同：
 *   - 池子大 2.4 倍，单号覆盖率高（25%）
 *   - 每期 20 个号，连号、同尾、区间聚集是常态而非例外
 *   - 选 10 个号，随机期望 2.5 个
 *
 * 本文件独立成册，id 以 K 开头，不与其他彩种共用。
 */
(function (root, factory) {
  var Core = root.LotteryCore;
  if (!Core && typeof require === 'function') Core = require('./core.js');
  var api = factory(Core);
  root.LotteryKL8 = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (Core) {
  "use strict";

  var L = Core.Lib;
  var list = [];
  var seq = 0;

  function add(cat, name, desc, run) {
    seq++;
    list.push({
      id: "K" + String(seq).padStart(3, "0"),
      zone: "main",
      cat: cat,
      name: name,
      desc: desc,
      run: run,
    });
  }

  /* 快乐8 专用工具 */
  function countLast(ctx, n, w) { return L.countLast(ctx, n, w); }
  function omit(ctx, n) { return L.omission(ctx, n); }

  function zoneOf(n) {
    if (n <= 20) return 0;
    if (n <= 40) return 1;
    if (n <= 60) return 2;
    return 3;
  }

  function recentCounts(ctx, w) {
    var c = {};
    ctx.cands.forEach(function (n) { c[n] = 0; });
    ctx.seqs.slice(-w).forEach(function (arr) {
      arr.forEach(function (n) { c[n] = (c[n] || 0) + 1; });
    });
    return c;
  }

  /* ==================== 频率 ==================== */

  [10, 20, 40, 80].forEach(function (w) {
    add("频率", "热号 · 近" + w + "期",
      "统计近" + w + "期每个号码出现次数，推荐次数最多的号；20 个号的高覆盖率下，热号筛选比小号池更稳定。",
      function (ctx) { return L.best(ctx, function (n) { return countLast(ctx, n, w); }, "recent"); });
  });

  [20, 40, 80].forEach(function (w) {
    add("频率", "冷号 · 近" + w + "期",
      "推荐近" + w + "期出现次数最少的号，属于冷号回补思路。",
      function (ctx) { return L.worst(ctx, function (n) { return countLast(ctx, n, w); }, "cold"); });
  });

  add("频率", "衰减热度",
    "近 40 期指数衰减加权（越近权重越高），推荐加权热度最高的号。",
    function (ctx) {
      var w = 40, arrs = ctx.seqs.slice(-w), len = arrs.length;
      return L.best(ctx, function (n) {
        var s = 0;
        for (var i = 0; i < len; i++) if (arrs[i].indexOf(n) !== -1) s += Math.pow(0.92, len - 1 - i);
        return s;
      }, "recent");
    });

  /* ==================== 区间（四区） ==================== */

  [1, 2, 3, 4].forEach(function (z) {
    add("区间", "第 " + z + " 区热号",
      "把 1–80 均分为四区（1–20 / 21–40 / 41–60 / 61–80），推荐第 " + z + " 区近 20 期最热的号。",
      function (ctx) {
        var c = recentCounts(ctx, 20);
        var pool = ctx.cands.filter(function (n) { return zoneOf(n) === z - 1; });
        return L.bestOf(ctx, pool, function (n) { return c[n] || 0; }, "recent");
      });
  });

  add("区间", "补空缺区",
    "找出近 10 期出现次数最少的区，推荐该区遗漏最久的号，用于补区间轮动。",
    function (ctx) {
      var zc = [0, 0, 0, 0];
      ctx.seqs.slice(-10).forEach(function (arr) {
        arr.forEach(function (n) { zc[zoneOf(n)]++; });
      });
      var minZ = 0;
      for (var i = 1; i < 4; i++) if (zc[i] < zc[minZ]) minZ = i;
      var pool = ctx.cands.filter(function (n) { return zoneOf(n) === minZ; });
      return L.bestOf(ctx, pool, function (n) { return omit(ctx, n); }, "cold");
    });

  add("区间", "段内最热 · 16 号一段",
    "把 1–80 分成 5 段（每段 16 个号），先选近 20 期最热的段，再取该段热号。",
    function (ctx) {
      var seg = function (n) { return Math.floor((n - 1) / 16); };
      var sc = [0, 0, 0, 0, 0];
      ctx.seqs.slice(-20).forEach(function (arr) {
        arr.forEach(function (n) { sc[seg(n)]++; });
      });
      var best = 0;
      for (var i = 1; i < 5; i++) if (sc[i] > sc[best]) best = i;
      var pool = ctx.cands.filter(function (n) { return seg(n) === best; });
      return L.bestOf(ctx, pool, function (n) { return countLast(ctx, n, 20); }, "recent");
    });

  /* ==================== 遗漏 ==================== */

  add("遗漏", "最大遗漏号",
    "推荐当前遗漏期数最大的号（最久未出）。", 
    function (ctx) { return L.best(ctx, function (n) { return omit(ctx, n); }, "cold"); });

  add("遗漏", "刚出号延续",
    "推荐上一期刚开出的号中最热的一个，代表热号延续的极端假设。",
    function (ctx) {
      var pool = ctx.last.filter(function (n) { return n >= ctx.min && n <= ctx.max; });
      if (!pool.length) return ctx.min;
      return L.bestOf(ctx, pool, function (n) { return countLast(ctx, n, 20); }, "recent");
    });

  add("遗漏", "超期比最大",
    "当前遗漏 ÷ 该号历史平均间隔，推荐超期最严重的号。",
    function (ctx) {
      return L.best(ctx, function (n) {
        var avg = L.avgGap(ctx, n) || 4;
        return omit(ctx, n) / Math.max(1, avg);
      }, "cold");
    });

  add("遗漏", "遗漏 Z 分数",
    "把当前遗漏在所有号上做标准化，推荐 Z 分数最高（相对超期）的号。",
    function (ctx) {
      var vals = ctx.cands.map(function (n) { return omit(ctx, n); });
      var m = L.mean(vals), sd = L.std(vals) || 1;
      return L.best(ctx, function (n) { return (omit(ctx, n) - m) / sd; }, "cold");
    });

  /* ==================== 结构（连号/尾数/奇偶） ==================== */

  add("结构", "上期邻号 +1",
    "推荐上期开奖号 +1 的号（若已开出则顺延），20 个号的高覆盖率让邻号命中率明显高于小号池。",
    function (ctx) {
      var pool = ctx.last.map(function (n) { return n + 1; })
        .filter(function (n) { return n >= ctx.min && n <= ctx.max; });
      if (!pool.length) return ctx.min;
      return L.bestOf(ctx, pool, function (n) { return countLast(ctx, n, 20); }, "recent");
    });

  add("结构", "上期邻号 -1",
    "推荐上期开奖号 -1 的号。",
    function (ctx) {
      var pool = ctx.last.map(function (n) { return n - 1; })
        .filter(function (n) { return n >= ctx.min && n <= ctx.max; });
      if (!pool.length) return ctx.max;
      return L.bestOf(ctx, pool, function (n) { return countLast(ctx, n, 20); }, "recent");
    });

  add("结构", "连号起点延伸",
    "找上期连号段的起点，推荐起点 -1，赌连号段向下延伸。",
    function (ctx) {
      var prev = ctx.last.slice().sort(function (a, b) { return a - b; });
      var starts = [];
      for (var i = 1; i < prev.length; i++) {
        if (prev[i] - prev[i - 1] === 1) starts.push(prev[i - 1]);
      }
      var pool = starts.map(function (n) { return n - 1; })
        .filter(function (n) { return n >= ctx.min && n <= ctx.max; });
      if (!pool.length) return L.best(ctx, function (n) { return omit(ctx, n); }, "cold");
      return L.bestOf(ctx, pool, function (n) { return countLast(ctx, n, 20); }, "recent");
    });

  add("结构", "热尾号",
    "统计近 20 期各尾数（0–9）出现次数，推荐最热尾数里遗漏最久的号。",
    function (ctx) {
      var tc = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
      ctx.seqs.slice(-20).forEach(function (arr) {
        arr.forEach(function (n) { tc[n % 10]++; });
      });
      var bestT = 0;
      for (var i = 1; i < 10; i++) if (tc[i] > tc[bestT]) bestT = i;
      var pool = ctx.cands.filter(function (n) { return n % 10 === bestT; });
      return L.bestOf(ctx, pool, function (n) { return omit(ctx, n); }, "cold");
    });

  add("结构", "冷尾回补",
    "推荐近 20 期出现最少的尾数里最热的号。",
    function (ctx) {
      var tc = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
      ctx.seqs.slice(-20).forEach(function (arr) {
        arr.forEach(function (n) { tc[n % 10]++; });
      });
      var worstT = 0;
      for (var i = 1; i < 10; i++) if (tc[i] < tc[worstT]) worstT = i;
      var pool = ctx.cands.filter(function (n) { return n % 10 === worstT; });
      return L.bestOf(ctx, pool, function (n) { return countLast(ctx, n, 20); }, "recent");
    });

  add("结构", "奇偶补缺",
    "统计上期 20 个号的奇偶比，推荐当前更少的那一类里最热的号。",
    function (ctx) {
      var odd = 0;
      ctx.last.forEach(function (n) { if (n % 2) odd++; });
      var needOdd = odd * 2 < ctx.last.length;
      var pool = ctx.cands.filter(function (n) { return needOdd ? n % 2 === 1 : n % 2 === 0; });
      return L.bestOf(ctx, pool, function (n) { return countLast(ctx, n, 20); }, "recent");
    });

  add("结构", "大小补缺",
    "以 40 为界，推荐上期较少一侧里最热的号。",
    function (ctx) {
      var small = 0;
      ctx.last.forEach(function (n) { if (n <= 40) small++; });
      var needSmall = small * 2 < ctx.last.length;
      var pool = ctx.cands.filter(function (n) { return needSmall ? n <= 40 : n > 40; });
      return L.bestOf(ctx, pool, function (n) { return countLast(ctx, n, 20); }, "recent");
    });

  add("结构", "中位号",
    "取近 10 期所有开出号的中位数，推荐最接近该中位数且近 20 期较热的号。",
    function (ctx) {
      var flat = [];
      ctx.seqs.slice(-10).forEach(function (arr) { flat = flat.concat(arr); });
      var target = L.median(flat);
      return L.bestOf(ctx, ctx.cands, function (n) {
        return -Math.abs(n - target) / 10 + countLast(ctx, n, 20) * 0.02;
      }, "small");
    });

  add("结构", "上期最热号 +10",
    "取上期最热的号，推荐 +10 的位置（跨段跟随）。",
    function (ctx) {
      var pool = ctx.last.map(function (n) { return n + 10; })
        .filter(function (n) { return n >= ctx.min && n <= ctx.max; });
      if (!pool.length) return ctx.max;
      return L.bestOf(ctx, pool, function (n) { return countLast(ctx, n, 20); }, "recent");
    });

  /* ==================== 统计 ==================== */

  add("统计", "卡方残差最大",
    "以均匀分布为期望，计算每个号的 (观测-期望)/√期望，推荐正残差最大的号。",
    function (ctx) {
      var w = 40, expect = ctx.seqs.slice(-w).length * ctx.last.length / ctx.cands.length;
      return L.best(ctx, function (n) {
        var o = countLast(ctx, n, w);
        return (o - expect) / Math.sqrt(Math.max(1e-6, expect));
      }, "recent");
    });

  add("统计", "Z 分数最低",
    "把近 40 期出现次数做标准化，推荐 Z 分数最低（显著偏冷）的号。",
    function (ctx) {
      var w = 40;
      var vals = ctx.cands.map(function (n) { return countLast(ctx, n, w); });
      var m = L.mean(vals), sd = L.std(vals) || 1;
      return L.best(ctx, function (n) { return -((countLast(ctx, n, w) - m) / sd); }, "cold");
    });

  add("统计", "滑动回归斜率",
    "对每个号近 20 期的 0/1 序列做线性回归，推荐斜率最大（转热最快）的号。",
    function (ctx) {
      var w = 20;
      return L.best(ctx, function (n) {
        var arrs = ctx.seqs.slice(-w), m = arrs.length, sx = 0, sy = 0, sxy = 0, sxx = 0;
        for (var i = 0; i < m; i++) {
          var y = arrs[i].indexOf(n) !== -1 ? 1 : 0;
          sx += i; sy += y; sxy += i * y; sxx += i * i;
        }
        var den = m * sxx - sx * sx;
        return den ? (m * sxy - sx * sy) / den : 0;
      }, "recent");
    });

  add("统计", "自相关最高",
    "计算每个号近 40 期序列的一阶自相关，推荐自相关最强（有延续性）的号。",
    function (ctx) {
      var w = 40;
      return L.best(ctx, function (n) {
        var arrs = ctx.seqs.slice(-w), xs = [], ys = [];
        for (var i = 1; i < arrs.length; i++) {
          xs.push(arrs[i - 1].indexOf(n) !== -1 ? 1 : 0);
          ys.push(arrs[i].indexOf(n) !== -1 ? 1 : 0);
        }
        var mx = L.mean(xs), my = L.mean(ys), num = 0, dx = 0, dy = 0;
        for (var j = 0; j < xs.length; j++) {
          num += (xs[j] - mx) * (ys[j] - my);
          dx += (xs[j] - mx) * (xs[j] - mx);
          dy += (ys[j] - my) * (ys[j] - my);
        }
        return dx && dy ? num / Math.sqrt(dx * dy) : 0;
      }, "recent");
    });

  add("统计", "出现间隔最规律",
    "计算每个号历史出现间隔的标准差，推荐间隔最规律（可预测性强）的号，取当前接近下一个间隔点的。",
    function (ctx) {
      return L.best(ctx, function (n) {
        var gs = L.gapStats(ctx, n);
        if (gs.count < 3) return -999;
        var sd = gs.std || 0.1;
        var avg = gs.avg || 4;
        var phase = omit(ctx, n) / avg;
        return -Math.abs(phase - 1) / sd;
      }, "cold");
    });

  /* ==================== 组合 ==================== */

  add("组合", "上期同尾跟随",
    "取上期尾数出现最多的那一尾，推荐该尾数中不在上期的号。",
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

  add("组合", "双期交集补位",
    "取上期与上上期都没出现的号，推荐其中近 40 期最热的，押“补位”。",
    function (ctx) {
      var pool = ctx.cands.filter(function (n) {
        return ctx.last.indexOf(n) === -1 && ctx.prev.indexOf(n) === -1;
      });
      if (!pool.length) return ctx.min;
      return L.bestOf(ctx, pool, function (n) { return countLast(ctx, n, 40); }, "recent");
    });

  add("组合", "三期都热的号",
    "统计近 3 期都出现过的号，推荐其中遗漏最久的。",
    function (ctx) {
      var a = ctx.seqs[ctx.seqs.length - 1] || [];
      var b = ctx.seqs[ctx.seqs.length - 2] || [];
      var c = ctx.seqs[ctx.seqs.length - 3] || [];
      var pool = a.filter(function (n) { return b.indexOf(n) !== -1 && c.indexOf(n) !== -1; });
      if (!pool.length) return L.best(ctx, function (n) { return countLast(ctx, n, 10); }, "recent");
      return L.bestOf(ctx, pool, function (n) { return omit(ctx, n); }, "cold");
    });

  add("组合", "跨度端点",
    "取近 10 期开出号的最小值与最大值，推荐最接近这两个端点的号。",
    function (ctx) {
      var flat = [];
      ctx.seqs.slice(-10).forEach(function (arr) { flat = flat.concat(arr); });
      if (!flat.length) return ctx.min;
      var lo = Math.min.apply(null, flat), hi = Math.max.apply(null, flat);
      return L.bestOf(ctx, ctx.cands, function (n) {
        return -Math.min(Math.abs(n - lo), Math.abs(n - hi));
      }, "small");
    });

  var API = {
    all: list,
    ids: list.map(function (f) { return f.id; }),
    count: list.length,
    categories: list.reduce(function (acc, f) { acc[f.cat] = (acc[f.cat] || 0) + 1; return acc; }, {}),
  };
  return API;
});
