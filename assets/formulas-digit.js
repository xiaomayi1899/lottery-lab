/*!
 * 福彩3D / 排列五专属公式（每位 0–9 选 1）
 *
 * 与双色球/大乐透/快乐8 完全分开：
 *   - 号码域是 0–9，且分位置（百/十/个，或万/千/百/十/个）
 *   - 每位独立摇奖，位置之间没有大小关系
 *   - 3D 关注和值、跨度、组三/组六；排列五关注五位结构与位置偏差
 *
 * 每个位置都有一份独立公式集，id 以 F/P 开头并带位置标记。
 */
(function (root, factory) {
  var Core = root.LotteryCore;
  if (!Core && typeof require === "function") Core = require("./core.js");
  var api = factory(Core);
  root.LotteryDigit = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (Core) {
  "use strict";

  var L = Core.Lib;

  function isPrime(n) {
    if (n < 2) return false;
    for (var i = 2; i * i <= n; i++) if (n % i === 0) return false;
    return true;
  }

  /* 位置内统计（ctx 已经是该位置的上下文） */
  function countLast(ctx, n, w) { return L.countLast(ctx, n, w); }
  function omit(ctx, n) { return L.omission(ctx, n); }

  /* 跨位置：读取某一期的完整开奖，按位置顺序拼接 */
  function otherPositions(ctx, zoneList) {
    return zoneList;
  }

  function buildPositionFormulas(prefix, zones, allZones) {
    var out = [];
    var seq = 0;

    function add(zone, cat, name, desc, run) {
      seq++;
      out.push({
        id: prefix + String(seq).padStart(3, "0"),
        zone: zone,
        cat: cat,
        name: name,
        desc: desc,
        run: run,
      });
    }

    var posLabel = {};
    zones.forEach(function (z) { posLabel[z] = z; });

    zones.forEach(function (zone, idx) {
      var tag = "第 " + (idx + 1) + " 位";

      /* 1. 位置热号 */
      [10, 20, 40].forEach(function (w) {
        add(zone, "位置频率", tag + "热号 · 近" + w + "期",
          "统计该位置近" + w + "期各数字出现次数，推荐最热的数字。",
          function (ctx) { return L.best(ctx, function (n) { return countLast(ctx, n, w); }, "recent"); });
      });

      /* 2. 位置冷号 */
      [20, 40].forEach(function (w) {
        add(zone, "位置频率", tag + "冷号 · 近" + w + "期",
          "推荐该位置近" + w + "期出现最少的数字。",
          function (ctx) { return L.worst(ctx, function (n) { return countLast(ctx, n, w); }, "cold"); });
      });

      /* 3. 遗漏 */
      add(zone, "位置遗漏", tag + "遗漏最大",
        "推荐该位置当前遗漏期数最大的数字。",
        function (ctx) { return L.best(ctx, function (n) { return omit(ctx, n); }, "cold"); });

      add(zone, "位置遗漏", tag + "超期比",
        "当前遗漏 ÷ 历史平均间隔，推荐超期最严重的数字。",
        function (ctx) {
          return L.best(ctx, function (n) {
            var avg = L.avgGap(ctx, n) || 3;
            return omit(ctx, n) / Math.max(1, avg);
          }, "cold");
        });

      /* 4. 形态 */
      add(zone, "位置形态", tag + "奇偶交替",
        "若上期该位为奇则推偶数中遗漏最久的，反之亦然。",
        function (ctx) {
          var lastOdd = ctx.last.length ? ctx.last[0] % 2 === 1 : false;
          var pool = ctx.cands.filter(function (n) { return lastOdd ? n % 2 === 0 : n % 2 === 1; });
          return L.bestOf(ctx, pool, function (n) { return omit(ctx, n); }, "cold");
        });

      add(zone, "位置形态", tag + "大小补缺",
        "以 4.5 为界（0–4 小 / 5–9 大），推荐上期较少一侧里最热的数字。",
        function (ctx) {
          var small = ctx.last.length ? (ctx.last[0] <= 4 ? 1 : 0) : 0;
          var wantSmall = !small;
          var pool = ctx.cands.filter(function (n) { return wantSmall ? n <= 4 : n >= 5; });
          return L.bestOf(ctx, pool, function (n) { return countLast(ctx, n, 20); }, "recent");
        });

      add(zone, "位置形态", tag + "012 路回补",
        "按数字对 3 取模分三路，推荐近 20 期最冷那一路里遗漏最久的数字。",
        function (ctx) {
          var rc = [0, 0, 0];
          ctx.seqs.slice(-20).forEach(function (arr) {
            arr.forEach(function (n) { rc[n % 3]++; });
          });
          var minR = 0;
          for (var i = 1; i < 3; i++) if (rc[i] < rc[minR]) minR = i;
          var pool = ctx.cands.filter(function (n) { return n % 3 === minR; });
          return L.bestOf(ctx, pool, function (n) { return omit(ctx, n); }, "cold");
        });

      add(zone, "位置形态", tag + "质合回补",
        "统计上期该位是否质数，推荐相反类别里遗漏最久的数字。",
        function (ctx) {
          var lastP = ctx.last.length ? isPrime(ctx.last[0]) : false;
          var pool = ctx.cands.filter(function (n) { return isPrime(n) !== lastP; });
          return L.bestOf(ctx, pool, function (n) { return omit(ctx, n); }, "cold");
        });

      add(zone, "位置形态", tag + "上期重号",
        "推荐上期该位置刚开出的数字（位置重号在高频数字上时有出现）。",
        function (ctx) {
          if (!ctx.last.length) return ctx.min;
          return ctx.last[0];
        });

      add(zone, "位置形态", tag + "邻号跟随",
        "推荐上期该位 ±1 中近 20 期最热的数字。",
        function (ctx) {
          if (!ctx.last.length) return ctx.min;
          var v = ctx.last[0];
          var pool = [v - 1, v + 1].filter(function (n) { return n >= ctx.min && n <= ctx.max; });
          if (!pool.length) return ctx.min;
          return L.bestOf(ctx, pool, function (n) { return countLast(ctx, n, 20); }, "recent");
        });

      /* 5. 统计 */
      add(zone, "位置统计", tag + "卡方偏差",
        "以均匀分布为期望，推荐出现次数偏离期望最大的数字。",
        function (ctx) {
          var w = 40, expect = ctx.seqs.slice(-w).length / ctx.cands.length;
          return L.best(ctx, function (n) {
            var o = countLast(ctx, n, w);
            return (o - expect) / Math.sqrt(Math.max(1e-6, expect));
          }, "recent");
        });

      add(zone, "位置统计", tag + "回归斜率",
        "对近 20 期 0/1 序列做回归，推荐斜率最大的数字。",
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
    });

    /* 跨位置结构公式（只加在第一位上，用于整注结构） */
    var mainZone = zones[0];
    var allKeys = allZones || zones;

    add(mainZone, "整体结构", prefix === "F" ? "三位和值回归" : "五位和值回归",
      "取最近 20 期各位数字之和的中位数，推荐能让本注和值回到中位的数字。",
      function (ctx) {
        var sums = ctx.draws.slice(-20).map(function (d) {
          var s = 0;
          allKeys.forEach(function (z) { s += (d[z] && d[z][0]) || 0; });
          return s;
        });
        var med = L.median(sums) || 0;
        var lastSum = 0;
        var lastDraw = ctx.draws[ctx.draws.length - 1] || {};
        allKeys.forEach(function (z) { lastSum += (lastDraw[z] && lastDraw[z][0]) || 0; });
        var target = Math.max(0, Math.min(9, Math.round(med - (lastSum - (ctx.last[0] || 0)))));
        return target;
      });

    if (zones.length >= 3) {
      add(mainZone, "整体结构", "跨度驱动",
        "取近 10 期各位极差的中位数，推荐能让本注跨度接近该值的数字。",
        function (ctx) {
          var spans = ctx.draws.slice(-10).map(function (d) {
            var vals = allKeys.map(function (z) { return (d[z] && d[z][0]) || 0; });
            return Math.max.apply(null, vals) - Math.min.apply(null, vals);
          });
          var med = Math.round(L.median(spans) || 0);
          var lastDraw = ctx.draws[ctx.draws.length - 1] || {};
          var others = allKeys.slice(1).map(function (z) { return (lastDraw[z] && lastDraw[z][0]) || 0; });
          var lo = Math.min.apply(null, others), hi = Math.max.apply(null, others);
          var target = Math.max(0, Math.min(9, Math.round(lo + med)));
          return target;
        });
    }

    return out;
  }

  var fc3dZones = ["hundreds", "tens", "units"];
  var pl5Zones = ["pos1", "pos2", "pos3", "pos4", "pos5"];

  var fc3d = buildPositionFormulas("F", fc3dZones, fc3dZones);
  var pl5 = buildPositionFormulas("P", pl5Zones, pl5Zones);

  /* 按位置分组，供 formulasFor 直接取用 */
  function groupByZone(list, zones) {
    var g = {};
    zones.forEach(function (z) {
      g[z] = list.filter(function (f) { return f.zone === z; });
    });
    return g;
  }

  return {
    all: fc3d.concat(pl5),
    fc3d: { list: fc3d, byZone: groupByZone(fc3d, fc3dZones), count: fc3d.length },
    pl5: { list: pl5, byZone: groupByZone(pl5, pl5Zones), count: pl5.length },
  };
});
