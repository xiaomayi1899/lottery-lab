/*!
 * 补充公式（双色球 / 大乐透）
 *
 * 填补原公式库缺失的逻辑维度：
 *   - 时间维度：星期效应、期号尾数、月份
 *   - 数值维度：和值尾数、跨度尾数、首尾和
 *   - 结构维度：连号长度、重号位置、区间交界、尾数递进
 *   - 历史镜像：去年同期
 *
 * 与主公式库分开存放，可独立启停。
 */
(function (root, factory) {
  var Core = root.LotteryCore;
  if (!Core && typeof require === "function") Core = require("./core.js");
  var api = factory(Core);
  root.LotteryExtra = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (Core) {
  "use strict";

  var L = Core.Lib;
  var ssq = [], dlt = [];

  function weekdayOf(dateStr) {
    var d = new Date(String(dateStr || "").replace(/-/g, "/"));
    return isNaN(d.getTime()) ? -1 : d.getDay();
  }

  function build(gameKey, prefix, frontMin, frontMax, frontPick, backMin, backMax) {
    var list = [];
    var seq = 0;
    function add(zone, cat, name, desc, run) {
      seq++;
      list.push({ id: prefix + String(seq).padStart(3, "0"), zone: zone, cat: cat, name: name, desc: desc, run: run });
    }

    /* ---------- 时间维度 ---------- */

    add("front", "时间", "星期效应 · 前区",
      "按开奖星期分组统计历史出现次数，推荐在「当前星期几」出现最多的号（如双色球周二/四/日各不同）。",
      function (ctx) {
        var lastDraw = ctx.draws[ctx.draws.length - 1] || {};
        var wd = weekdayOf(lastDraw.date);
        if (wd < 0) return L.best(ctx, function (n) { return L.countLast(ctx, n, 30); }, "recent");
        var cnt = {};
        ctx.cands.forEach(function (n) { cnt[n] = 0; });
        ctx.draws.forEach(function (d) {
          if (weekdayOf(d.date) !== wd) return;
          (d[ctx.zone] || []).forEach(function (n) { if (cnt[n] !== undefined) cnt[n]++; });
        });
        return L.best(ctx, function (n) { return cnt[n] || 0; }, "recent");
      });

    add("front", "时间", "期号尾数定位",
      "取最新期号对号码区间取模，定位到对应号（期号节奏，纯统计）。",
      function (ctx) {
        var lastDraw = ctx.draws[ctx.draws.length - 1] || {};
        var digits = String(lastDraw.issue || "").replace(/\D/g, "");
        var v = digits ? Number(digits.slice(-4)) : 0;
        var span = ctx.max - ctx.min + 1;
        return ctx.min + (v % span);
      });

    add("front", "时间", "去年同期号",
      "找出去年同期（同月同日或同周次）开出的号码中，当前遗漏最久的号。",
      function (ctx) {
        var lastDraw = ctx.draws[ctx.draws.length - 1] || {};
        var md = String(lastDraw.date || "").slice(5);
        var pool = [];
        ctx.draws.forEach(function (d) {
          if (String(d.date || "").slice(5) === md && d !== lastDraw) {
            (d[ctx.zone] || []).forEach(function (n) { if (pool.indexOf(n) === -1) pool.push(n); });
          }
        });
        if (!pool.length) return L.best(ctx, function (n) { return L.omission(ctx, n); }, "cold");
        return L.bestOf(ctx, pool, function (n) { return L.omission(ctx, n); }, "cold");
      });

    /* ---------- 数值维度 ---------- */

    add("front", "数值", "和值尾数定位",
      "上期和值的个位数作为尾数，推荐该尾数里近 30 期最热的号。",
      function (ctx) {
        var t = L.sum(ctx.last) % 10;
        var pool = ctx.cands.filter(function (n) { return n % 10 === t; });
        if (!pool.length) return ctx.min;
        return L.bestOf(ctx, pool, function (n) { return L.countLast(ctx, n, 30); }, "recent");
      });

    add("front", "数值", "跨度尾数定位",
      "上期跨度的个位数作为尾数，推荐该尾数里遗漏最久的号。",
      function (ctx) {
        var sp = L.span(ctx.last);
        var t = sp % 10;
        var pool = ctx.cands.filter(function (n) { return n % 10 === t; });
        if (!pool.length) return ctx.min;
        return L.bestOf(ctx, pool, function (n) { return L.omission(ctx, n); }, "cold");
      });

    add("front", "数值", "首尾和回补",
      "上期最小号 + 最大号 = 首尾和，对区间取模后推荐该位置附近的号。",
      function (ctx) {
        if (!ctx.last.length) return ctx.min;
        var s = Math.min.apply(null, ctx.last) + Math.max.apply(null, ctx.last);
        var target = ctx.min + (s % (ctx.max - ctx.min + 1));
        return L.bestOf(ctx, ctx.cands, function (n) { return -Math.abs(n - target); }, "small");
      });

    add("front", "数值", "和值增量跟随",
      "计算上期与上上期的和值差，若为正（和值走高）则推荐高位号，否则推荐低位号。",
      function (ctx) {
        if (ctx.draws.length < 2) return ctx.min;
        var a = L.sum(ctx.draws[ctx.draws.length - 1][ctx.zone] || []);
        var b = L.sum(ctx.draws[ctx.draws.length - 2][ctx.zone] || []);
        var target = a > b ? ctx.max - 2 : ctx.min + 2;
        return L.bestOf(ctx, ctx.cands, function (n) {
          return -Math.abs(n - target) + L.countLast(ctx, n, 20) * 0.05;
        }, "small");
      });

    /* ---------- 结构维度 ---------- */

    add("front", "结构", "最长连号长度",
      "统计上期最长连号段的长度 k，推荐该连号段终点 +1 的号（连号继续延伸）。",
      function (ctx) {
        var arr = ctx.last.slice().sort(function (a, b) { return a - b; });
        if (!arr.length) return ctx.min;
        var bestLen = 1, bestEnd = arr[0], cur = 1;
        for (var i = 1; i < arr.length; i++) {
          if (arr[i] - arr[i - 1] === 1) { cur++; } else { cur = 1; }
          if (cur > bestLen) { bestLen = cur; bestEnd = arr[i]; }
        }
        var next = bestEnd + 1;
        return next <= ctx.max ? next : bestEnd - bestLen;
      });

    add("front", "结构", "重号位置号",
      "上期第 2 个号（中位偏前）常在下期重复，推荐它。",
      function (ctx) {
        var arr = ctx.last.slice().sort(function (a, b) { return a - b; });
        if (arr.length < 2) return ctx.min;
        return arr[Math.floor(arr.length / 3)];
      });

    add("front", "结构", "区间交界号",
      "把区间三等分，推荐两个交界处（1/3 与 2/3）里遗漏最久的号。",
      function (ctx) {
        var span = ctx.max - ctx.min + 1;
        var a = ctx.min + Math.round(span / 3);
        var b = ctx.min + Math.round(span * 2 / 3);
        var pool = [a, b].filter(function (n) { return n >= ctx.min && n <= ctx.max; });
        return L.bestOf(ctx, pool, function (n) { return L.omission(ctx, n); }, "cold");
      });

    add("front", "结构", "尾数递进号",
      "上期每个号尾数 +1，推荐生成的新尾数里近 20 期最热的号。",
      function (ctx) {
        var tails = {};
        ctx.last.forEach(function (n) { tails[(n % 10 + 1) % 10] = 1; });
        var pool = ctx.cands.filter(function (n) { return tails[n % 10]; });
        if (!pool.length) return ctx.min;
        return L.bestOf(ctx, pool, function (n) { return L.countLast(ctx, n, 20); }, "recent");
      });

    add("front", "结构", "两期交集补位",
      "取上期与上上期都没出现的号，推荐其中近 20 期最热的，押补位。",
      function (ctx) {
        var pool = ctx.cands.filter(function (n) {
          return ctx.last.indexOf(n) === -1 && ctx.prev.indexOf(n) === -1;
        });
        if (!pool.length) return ctx.min;
        return L.bestOf(ctx, pool, function (n) { return L.countLast(ctx, n, 20); }, "recent");
      });

    /* ---------- 后区补充 ---------- */

    add("back", "时间", "星期效应 · 后区",
      "按开奖星期分组统计后区出现次数，推荐当前星期出现最多的后区号。",
      function (ctx) {
        var lastDraw = ctx.draws[ctx.draws.length - 1] || {};
        var wd = weekdayOf(lastDraw.date);
        if (wd < 0) return L.best(ctx, function (n) { return L.countLast(ctx, n, 20); }, "recent");
        var cnt = {};
        ctx.cands.forEach(function (n) { cnt[n] = 0; });
        ctx.draws.forEach(function (d) {
          if (weekdayOf(d.date) !== wd) return;
          (d[ctx.zone] || []).forEach(function (n) { if (cnt[n] !== undefined) cnt[n]++; });
        });
        return L.best(ctx, function (n) { return cnt[n] || 0; }, "recent");
      });

    add("back", "数值", "后区和值尾",
      "上期后区两个号之和的个位数，推荐该尾数中遗漏最久的后区号。",
      function (ctx) {
        var t = L.sum(ctx.last) % 10;
        var pool = ctx.cands.filter(function (n) { return n % 10 === t; });
        if (!pool.length) return ctx.min;
        return L.bestOf(ctx, pool, function (n) { return L.omission(ctx, n); }, "cold");
      });

    add("back", "结构", "后区尾部递进",
      "上期后区尾数 +1 生成新尾数，推荐该尾数中近 20 期最热的后区号。",
      function (ctx) {
        var tails = {};
        ctx.last.forEach(function (n) { tails[(n % 10 + 1) % 10] = 1; });
        var pool = ctx.cands.filter(function (n) { return tails[n % 10]; });
        if (!pool.length) return ctx.min;
        return L.bestOf(ctx, pool, function (n) { return L.countLast(ctx, n, 20); }, "recent");
      });

    add("back", "结构", "后区全区间补位",
      "推荐近 12 期完全没出现过的后区号中遗漏最久的一个。",
      function (ctx) {
        var seen = {};
        ctx.seqs.slice(-12).forEach(function (arr) { arr.forEach(function (n) { seen[n] = 1; }); });
        var pool = ctx.cands.filter(function (n) { return !seen[n]; });
        if (!pool.length) return L.best(ctx, function (n) { return L.omission(ctx, n); }, "cold");
        return L.bestOf(ctx, pool, function (n) { return L.omission(ctx, n); }, "cold");
      });

    return list;
  }

  ssq = build("ssq", "X", 1, 33, 6, 1, 16);
  dlt = build("dlt", "Y", 1, 35, 5, 1, 12);

  return {
    ssq: { list: ssq, front: ssq.filter(function (f) { return f.zone === "front"; }), back: ssq.filter(function (f) { return f.zone === "back"; }), count: ssq.length },
    dlt: { list: dlt, front: dlt.filter(function (f) { return f.zone === "front"; }), back: dlt.filter(function (f) { return f.zone === "back"; }), count: dlt.length },
    all: ssq.concat(dlt),
  };
});
