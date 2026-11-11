/* 数彩实验室 · 公式库
 * 每个公式只做一件事：基于历史数据，给出一个推荐号码。
 * front 公式用于双色球红球 / 大乐透前区；back 公式用于蓝球 / 后区。
 */
(function (root) {
  'use strict';

  var Core = root.LotteryCore;
  if (!Core && typeof require === 'function') Core = require('./core.js');
  var L = Core.Lib;
  var formulas = [];
  var counters = { front: 0, back: 0 };

  function add(zone, cat, name, desc, run) {
    counters[zone]++;
    formulas.push({
      id: (zone === 'front' ? 'F' : 'B') + String(counters[zone]).padStart(3, '0'),
      zone: zone,
      cat: cat,
      name: name,
      desc: desc,
      run: run
    });
  }

  function hot(ctx, w, tie) {
    return L.best(ctx, function (n) { return L.countLast(ctx, n, w); }, tie || 'recent');
  }
  function cold(ctx, w) {
    return L.worst(ctx, function (n) { return L.countLast(ctx, n, w); }, 'cold');
  }
  function decay(ctx, w, lambda) {
    var seqs = ctx.seqs.slice(-w), len = seqs.length;
    return L.best(ctx, function (n) {
      var s = 0;
      for (var i = 0; i < len; i++) if (seqs[i].indexOf(n) !== -1) s += Math.pow(lambda, len - 1 - i);
      return s;
    }, 'recent');
  }
  function predict(ctx, n, w) {
    var seqs = ctx.seqs.slice(-w), m = seqs.length;
    if (m < 2) return 0;
    var sx = 0, sy = 0, sxy = 0, sxx = 0;
    for (var i = 0; i < m; i++) {
      var y = seqs[i].indexOf(n) !== -1 ? 1 : 0;
      sx += i; sy += y; sxy += i * y; sxx += i * i;
    }
    var den = m * sxx - sx * sx;
    var slope = den ? (m * sxy - sx * sy) / den : 0;
    var intercept = (sy - slope * sx) / m;
    return intercept + slope * m;
  }
  function sumLast(ctx, k) {
    var arr = ctx.draws.slice(-(k || 1));
    var s = 0;
    arr.forEach(function (d) { s += L.sum(d[ctx.zone]); });
    return s;
  }
  function sumSeries(ctx, k) {
    return ctx.draws.slice(-(k || 10)).map(function (d) { return L.sum(d[ctx.zone]); });
  }
  function spanSeries(ctx, k) {
    return ctx.draws.slice(-(k || 10)).map(function (d) { return L.span(d[ctx.zone]); });
  }
  function nearestOf(ctx, list, target, excludeLast) {
    var pool = L.uniq(list).filter(function (n) {
      return n >= ctx.min && n <= ctx.max && (!excludeLast || ctx.last.indexOf(n) === -1);
    });
    if (!pool.length) pool = L.uniq(list).filter(function (n) { return n >= ctx.min && n <= ctx.max; });
    if (!pool.length) return L.clamp(Math.round(target), ctx.min, ctx.max);
    return L.bestOf(ctx, pool, function (n) { return -Math.abs(n - target); }, 'small');
  }
  function bestInGroup(ctx, groupFn, w) {
    var counts = {};
    var recent = ctx.seqs.slice(-(w || 30));
    recent.forEach(function (arr) {
      arr.forEach(function (n) {
        var g = groupFn(n);
        counts[g] = (counts[g] || 0) + 1;
      });
    });
    var bestG = null, bestC = -1;
    Object.keys(counts)
      .map(function (g) { return Number(g); })
      .sort(function (a, b) { return a - b; })
      .forEach(function (g) {
        if (counts[g] > bestC) { bestC = counts[g]; bestG = g; }
      });
    if (bestG === null) return ctx.min;
    var pool = ctx.cands.filter(function (n) { return String(groupFn(n)) === String(bestG); });
    return L.bestOf(ctx, pool, function (n) { return L.countLast(ctx, n, 30); }, 'recent');
  }
  function medianPool(ctx, k, excludeLast) {
    var flat = [];
    ctx.draws.slice(-(k || 10)).forEach(function (d) { flat = flat.concat(d[ctx.zone]); });
    var target = L.median(flat);
    return nearestOf(ctx, ctx.cands, target, excludeLast !== false);
  }
  function weekdayOf(str) {
    var d = new Date(String(str || '').replace(/-/g, '/'));
    return isNaN(d.getTime()) ? -1 : d.getDay();
  }
  function digitSum(str) {
    return String(str || '').split('').reduce(function (s, c) {
      return /[0-9]/.test(c) ? s + Number(c) : s;
    }, 0);
  }

  /* ============================ 前区公式 ============================ */

  [5, 8, 10, 12, 15, 20, 25, 30, 40, 50, 60, 80, 100].forEach(function (w) {
    add('front', '频率', '热号 · 近' + w + '期',
      '统计近' + w + '期每个号码的出现次数，推荐出现次数最多的热号；次数相同时优先最近出现者。',
      function (ctx) { return hot(ctx, w); });
  });

  [5, 10, 15, 20, 30, 50, 100].forEach(function (w) {
    add('front', '频率', '冷号 · 近' + w + '期',
      '统计近' + w + '期出现次数最少的号码（冷号），次数相同时优先遗漏更久者，属于“冷号回补”思路。',
      function (ctx) { return cold(ctx, w); });
  });

  [10, 20, 50].forEach(function (w) {
    add('front', '频率', '衰减热度 · 近' + w + '期',
      '对近' + w + '期做指数衰减加权（越近权重越高，λ=0.85），推荐加权热度最高的号码。',
      function (ctx) { return decay(ctx, w, 0.85); });
  });

  add('front', '遗漏', '最大遗漏号',
    '计算每个号码距上次出现的期数，推荐当前遗漏值最大的号码（最久未出）。',
    function (ctx) { return L.best(ctx, function (n) { return L.omission(ctx, n); }, 'cold'); });

  add('front', '遗漏', '最小遗漏号',
    '推荐刚刚开出或最近开出的号码，代表“热号延续”的极端假设。',
    function (ctx) { return L.worst(ctx, function (n) { return L.omission(ctx, n); }, 'recent'); });

  add('front', '遗漏', '遗漏偏差最大',
    '当前遗漏值减去该号历史平均间隔，推荐“超期最严重”的号码。',
    function (ctx) {
      return L.best(ctx, function (n) { return L.omission(ctx, n) - L.avgGap(ctx, n); }, 'cold');
    });

  add('front', '遗漏', '遗漏回补临界',
    '在尚未开出的号码中，推荐当前遗漏值最接近其历史平均间隔的号码（回补窗口）。',
    function (ctx) {
      return L.best(ctx, function (n) {
        if (L.omission(ctx, n) === 0) return -999;
        return -Math.abs(L.omission(ctx, n) - L.avgGap(ctx, n));
      }, 'cold');
    });

  add('front', '遗漏', '遗漏尾数映射',
    '取当前最大遗漏值的个位数作为尾数，在该尾数号码中推荐近30期最活跃者。',
    function (ctx) {
      var maxOm = 0;
      ctx.cands.forEach(function (n) { maxOm = Math.max(maxOm, L.omission(ctx, n)); });
      var tail = maxOm % 10;
      var pool = ctx.cands.filter(function (n) { return n % 10 === tail; });
      return L.bestOf(ctx, pool, function (n) { return L.countLast(ctx, n, 30); }, 'recent');
    });

  add('front', '上期关联', '重号王',
    '在上期开出的号码中，挑选历史上“连庄”（连续两期出现）次数最多的号码。',
    function (ctx) { return L.bestOf(ctx, ctx.last, function (n) { return L.repeatScore(ctx, n); }, 'recent'); });

  [1, 2, 3, -1, -2, -3].forEach(function (step) {
    add('front', '上期关联', '上期邻号 ' + (step > 0 ? '+' : '') + step,
      '把上期每个号码平移 ' + step + ' 位（越界回绕），在得到的邻号中推荐近30期最活跃者。',
      function (ctx) {
        var pool = ctx.last.map(function (n) { return L.wrap(n + step, ctx.min, ctx.max); });
        return L.bestOf(ctx, pool, function (n) { return L.countLast(ctx, n, 30); }, 'recent');
      });
  });

  add('front', '上期关联', '上期同尾号',
    '提取上期号码的尾数，在未开出的同尾号码中推荐近30期最活跃者。',
    function (ctx) {
      var tails = ctx.last.map(function (n) { return n % 10; });
      var pool = ctx.cands.filter(function (n) {
        return tails.indexOf(n % 10) !== -1 && ctx.last.indexOf(n) === -1;
      });
      return L.bestOf(ctx, pool.length ? pool : ctx.last, function (n) { return L.countLast(ctx, n, 30); }, 'recent');
    });

  add('front', '上期关联', '上期首尾和',
    '上期最小号 + 最大号，按号码区间回绕后作为推荐号；代表首尾结构的延伸。',
    function (ctx) {
      if (!ctx.last.length) return ctx.min;
      return L.wrap(ctx.last[0] + ctx.last[ctx.last.length - 1], ctx.min, ctx.max);
    });

  add('front', '上期关联', '上期镜像号',
    '用“区间首号 + 区间尾号 − 上期均值”做镜像映射，推荐镜像位置上的号码。',
    function (ctx) {
      if (!ctx.last.length) return ctx.min;
      return L.wrap(ctx.min + ctx.max - Math.round(L.mean(ctx.last)), ctx.min, ctx.max);
    });

  add('front', '上期关联', '上期均值号',
    '取上期所有号码的平均值四舍五入，作为单号推荐，代表上期的“重心”。',
    function (ctx) { return L.clamp(Math.round(L.mean(ctx.last)), ctx.min, ctx.max); });

  add('front', '上期关联', '上期连号缺口',
    '找出上期相邻号码之间的空档，推荐最大空档的中点，代表连号结构的回补位。',
    function (ctx) {
      var nums = ctx.last.slice().sort(function (a, b) { return a - b; });
      if (nums.length < 2) return ctx.min;
      var bestGap = -1, mid = ctx.min;
      for (var i = 1; i < nums.length; i++) {
        var gap = nums[i] - nums[i - 1];
        if (gap > bestGap) { bestGap = gap; mid = (nums[i] + nums[i - 1]) / 2; }
      }
      return L.clamp(Math.round(mid), ctx.min, ctx.max);
    });

  add('front', '上期关联', '上期尾数热',
    '统计上期号码的尾数分布，选择出现最多的尾数，再在该尾数中推荐近30期最活跃者。',
    function (ctx) {
      var cnt = {};
      ctx.last.forEach(function (n) { cnt[n % 10] = (cnt[n % 10] || 0) + 1; });
      var bestTail = 0, best = -1;
      Object.keys(cnt).forEach(function (t) { if (cnt[t] > best) { best = cnt[t]; bestTail = Number(t); } });
      var pool = ctx.cands.filter(function (n) { return n % 10 === bestTail; });
      return L.bestOf(ctx, pool, function (n) { return L.countLast(ctx, n, 30); }, 'recent');
    });

  add('front', '和值跨度', '和值均值单号',
    '取近10期和值的平均值，除以每期球数得到“平均单号”，四舍五入后作为推荐。',
    function (ctx) {
      var target = L.mean(sumSeries(ctx, 10)) / ctx.pick;
      return L.clamp(Math.round(target), ctx.min, ctx.max);
    });

  add('front', '和值跨度', '和值尾数号',
    '用上期和值的个位数作为尾数，在该尾数号码中推荐近30期最活跃者。',
    function (ctx) {
      var tail = L.sum(ctx.last) % 10;
      var pool = ctx.cands.filter(function (n) { return n % 10 === tail; });
      return L.bestOf(ctx, pool, function (n) { return L.countLast(ctx, n, 30); }, 'recent');
    });

  add('front', '和值跨度', '和值差分映射',
    '计算上期与上上期的和值之差，取绝对值回绕到号码区间，作为差分映射号。',
    function (ctx) {
      var diff = Math.abs(L.sum(ctx.last) - L.sum(ctx.prev));
      return L.wrap(diff === 0 ? ctx.min : diff, ctx.min, ctx.max);
    });

  add('front', '和值跨度', '和值回归号',
    '以近10期和值均值为目标，用上期和值与目标的偏差修正上期均值，得到回归位推荐。',
    function (ctx) {
      var target = L.mean(sumSeries(ctx, 10));
      var delta = target - L.sum(ctx.last);
      return L.wrap(Math.round(L.mean(ctx.last) + delta / ctx.pick), ctx.min, ctx.max);
    });

  add('front', '和值跨度', '和值奇偶平衡',
    '若上期和值为奇数，推荐近期出现最多的偶数号；反之推荐奇数号，追求奇偶结构平衡。',
    function (ctx) {
      var wantEven = L.sum(ctx.last) % 2 === 1;
      var pool = ctx.cands.filter(function (n) { return (n % 2 === 0) === wantEven; });
      return L.bestOf(ctx, pool, function (n) { return L.countLast(ctx, n, 20); }, 'recent');
    });

  add('front', '和值跨度', '跨度直取',
    '把上期的最大最小号之差（跨度）直接映射为号码，跨度越小推荐号越靠前。',
    function (ctx) { return L.clamp(L.span(ctx.last), ctx.min, ctx.max); });

  add('front', '和值跨度', '跨度均值号',
    '取近10期跨度的平均值四舍五入，作为推荐号码，代表近期跨度重心。',
    function (ctx) { return L.clamp(Math.round(L.mean(spanSeries(ctx, 10))), ctx.min, ctx.max); });

  add('front', '和值跨度', '跨度回补号',
    '用“区间上限 − 上期跨度”做回补映射，寻找跨度另一端的号码。',
    function (ctx) { return L.wrap(ctx.max - L.span(ctx.last), ctx.min, ctx.max); });

  add('front', '和值跨度', 'AC 值映射',
    '计算上期的 AC 值（两两差值去重数 − (球数−1)），映射到号码区间作为推荐。',
    function (ctx) { return L.wrap(ctx.min + L.ac(ctx.last), ctx.min, ctx.max); });

  add('front', '结构形态', '奇偶回补',
    '统计上期奇数个数：若奇数偏多则推荐近期最热的偶数，反之推荐最热的奇数。',
    function (ctx) {
      var odd = ctx.last.filter(function (n) { return n % 2 === 1; }).length;
      var wantOdd = odd <= Math.floor(ctx.pick / 2);
      var pool = ctx.cands.filter(function (n) { return (n % 2 === 1) === wantOdd; });
      return L.bestOf(ctx, pool, function (n) { return L.countLast(ctx, n, 20); }, 'recent');
    });

  add('front', '结构形态', '大小回补',
    '以区间中点为界，若上期大号偏多则推荐小号区热号，反之推荐大号区热号。',
    function (ctx) {
      var mid = (ctx.min + ctx.max) / 2;
      var big = ctx.last.filter(function (n) { return n > mid; }).length;
      var wantBig = big <= Math.floor(ctx.pick / 2);
      var pool = ctx.cands.filter(function (n) { return (n > mid) === wantBig; });
      return L.bestOf(ctx, pool, function (n) { return L.countLast(ctx, n, 20); }, 'recent');
    });

  add('front', '结构形态', '质合回补',
    '统计上期质数个数：质数偏少时推荐近期最热质数，偏多时推荐最热合数。',
    function (ctx) {
      var primes = ctx.last.filter(function (n) { return L.isPrime(n); }).length;
      var wantPrime = primes <= Math.floor(ctx.pick / 2);
      var pool = ctx.cands.filter(function (n) { return L.isPrime(n) === wantPrime; });
      return L.bestOf(ctx, pool, function (n) { return L.countLast(ctx, n, 20); }, 'recent');
    });

  add('front', '结构形态', '三区回补',
    '把号码区间三等分，统计上期三个区的出号数，从最冷的区里推荐近30期最活跃号。',
    function (ctx) {
      var zones = [0, 0, 0];
      ctx.last.forEach(function (n) { zones[L.zoneIndex(n, ctx.min, ctx.max, 3)]++; });
      var minZone = 0;
      for (var i = 1; i < 3; i++) if (zones[i] < zones[minZone]) minZone = i;
      var pool = ctx.cands.filter(function (n) { return L.zoneIndex(n, ctx.min, ctx.max, 3) === minZone; });
      return L.bestOf(ctx, pool, function (n) { return L.countLast(ctx, n, 30); }, 'recent');
    });

  add('front', '结构形态', '012 路回补',
    '按号码除以 3 的余数分成 0/1/2 路，从上期出号最少的一路中推荐近30期最活跃号。',
    function (ctx) {
      var roads = [0, 0, 0];
      ctx.last.forEach(function (n) { roads[n % 3]++; });
      var minRoad = 0;
      for (var i = 1; i < 3; i++) if (roads[i] < roads[minRoad]) minRoad = i;
      var pool = ctx.cands.filter(function (n) { return n % 3 === minRoad; });
      return L.bestOf(ctx, pool, function (n) { return L.countLast(ctx, n, 30); }, 'recent');
    });

  add('front', '结构形态', '尾数热号',
    '统计近20期各尾数的出现次数，选取最热尾数，再在该尾数中推荐最活跃号码。',
    function (ctx) { return bestInGroup(ctx, function (n) { return n % 10; }, 20); });

  add('front', '结构形态', '尾数冷号',
    '统计近30期各尾数出现次数，选取最冷尾数，再在该尾数中推荐遗漏最久的号码。',
    function (ctx) {
      var cnt = {};
      ctx.seqs.slice(-30).forEach(function (arr) { arr.forEach(function (n) { cnt[n % 10] = (cnt[n % 10] || 0) + 1; }); });
      var bestTail = 0, best = Infinity;
      for (var t = 0; t <= 9; t++) {
        var c = cnt[t] || 0;
        if (c < best) { best = c; bestTail = t; }
      }
      var pool = ctx.cands.filter(function (n) { return n % 10 === bestTail; });
      return L.bestOf(ctx, pool, function (n) { return -L.omission(ctx, n); }, 'cold');
    });

  add('front', '结构形态', '连号缺口',
    '在上期号码的最小值与最大值之间，寻找未开出的“缺口号”，推荐近30期最活跃者。',
    function (ctx) {
      if (ctx.last.length < 2) return ctx.min;
      var lo = Math.min.apply(null, ctx.last), hi = Math.max.apply(null, ctx.last);
      var pool = ctx.cands.filter(function (n) { return n > lo && n < hi && ctx.last.indexOf(n) === -1; });
      return L.bestOf(ctx, pool.length ? pool : ctx.cands, function (n) { return L.countLast(ctx, n, 30); }, 'recent');
    });

  add('front', '结构形态', '重邻混合',
    '把上期重号与左右邻号合并成候选池，用“连庄次数 + 近20期频率”综合打分取最高者。',
    function (ctx) {
      var pool = ctx.last.slice();
      ctx.last.forEach(function (n) {
        pool.push(L.wrap(n - 1, ctx.min, ctx.max));
        pool.push(L.wrap(n + 1, ctx.min, ctx.max));
      });
      return L.bestOf(ctx, pool, function (n) {
        return L.repeatScore(ctx, n) + L.countLast(ctx, n, 20) * 0.5;
      }, 'recent');
    });

  add('front', '结构形态', '首尾中位号',
    '取上期最小号与最大号的中点，作为首尾结构的中心位推荐。',
    function (ctx) {
      if (!ctx.last.length) return ctx.min;
      return L.clamp(Math.round((ctx.last[0] + ctx.last[ctx.last.length - 1]) / 2), ctx.min, ctx.max);
    });

  add('front', '结构形态', '同尾连出',
    '找出上期与上上期都出现过的尾数，在这些尾数的未开号码中推荐近期最活跃者。',
    function (ctx) {
      var t1 = ctx.last.map(function (n) { return n % 10; });
      var t0 = ctx.prev.map(function (n) { return n % 10; });
      var same = t1.filter(function (t) { return t0.indexOf(t) !== -1; });
      var pool = ctx.cands.filter(function (n) {
        return same.indexOf(n % 10) !== -1 && ctx.last.indexOf(n) === -1;
      });
      return L.bestOf(ctx, pool.length ? pool : ctx.cands, function (n) { return L.countLast(ctx, n, 30); }, 'recent');
    });

  add('front', '统计模型', '线性趋势向上',
    '对近20期每个号码的出现序列做最小二乘线性回归，推荐斜率最大（热度上升最快）的号码。',
    function (ctx) { return L.best(ctx, function (n) { return L.trendSlope(ctx, n, 20); }, 'recent'); });

  add('front', '统计模型', '线性趋势向下',
    '对近20期出现序列做线性回归，推荐斜率最小（热度下降最快）的号码，属于反转思路。',
    function (ctx) { return L.worst(ctx, function (n) { return L.trendSlope(ctx, n, 20); }, 'cold'); });

  add('front', '统计模型', '趋势外推预测',
    '对近25期出现序列拟合直线，并外推到下一期，推荐预测值最高的号码。',
    function (ctx) { return L.best(ctx, function (n) { return predict(ctx, n, 25); }, 'recent'); });

  add('front', '统计模型', '指数平滑 EWMA',
    '对近30期做半衰期 8 期的指数平滑，推荐平滑热度最高的号码。',
    function (ctx) { return decay(ctx, 30, Math.pow(0.5, 1 / 8)); });

  add('front', '统计模型', '加权移动平均',
    '对近20期按 1..20 线性加权，越近权重越大，推荐加权得分最高的号码。',
    function (ctx) {
      var seqs = ctx.seqs.slice(-20), m = seqs.length;
      return L.best(ctx, function (n) {
        var s = 0;
        for (var i = 0; i < m; i++) if (seqs[i].indexOf(n) !== -1) s += (i + 1);
        return s;
      }, 'recent');
    });

  add('front', '统计模型', '卡方偏高',
    '以近30期理论出现次数为期望，计算每个号码的卡方偏差，推荐偏高最明显的号码。',
    function (ctx) {
      var w = 30, exp = w * ctx.pick / ctx.cands.length;
      return L.best(ctx, function (n) { return Math.pow(L.countLast(ctx, n, w) - exp, 2) / exp; }, 'recent');
    });

  add('front', '统计模型', '卡方偏低',
    '计算近30期卡方偏差，推荐偏低最明显的号码，等待统计回归。',
    function (ctx) {
      var w = 30, exp = w * ctx.pick / ctx.cands.length;
      return L.worst(ctx, function (n) { return Math.pow(L.countLast(ctx, n, w) - exp, 2) / exp; }, 'cold');
    });

  add('front', '统计模型', '贝叶斯平滑',
    '用 Beta 先验对近30期出现率做平滑估计，推荐后验概率最高的号码。',
    function (ctx) {
      var w = 30, prior = ctx.pick / ctx.cands.length;
      return L.best(ctx, function (n) { return (L.countLast(ctx, n, w) + 2 * prior) / (w + 2); }, 'recent');
    });

  add('front', '统计模型', '热度提升度',
    '对比近10期与近50期的出现率，推荐近期热度提升幅度最大的号码。',
    function (ctx) {
      return L.best(ctx, function (n) {
        return (L.countLast(ctx, n, 10) + 0.5) / (L.countLast(ctx, n, 50) * 0.2 + 0.5);
      }, 'recent');
    });

  add('front', '统计模型', 'Z-Score 偏离',
    '把近30期各号码出现次数标准化，推荐 Z 值最高的号码。',
    function (ctx) {
      var counts = ctx.cands.map(function (n) { return L.countLast(ctx, n, 30); });
      var m = L.mean(counts), sd = L.std(counts) || 1;
      return L.best(ctx, function (n) { return (L.countLast(ctx, n, 30) - m) / sd; }, 'recent');
    });

  add('front', '统计模型', '一阶自相关',
    '对近50期出现序列计算 lag-1 自相关，推荐“惯性”最强的号码。',
    function (ctx) { return L.best(ctx, function (n) { return L.autocorr(ctx, n, 50); }, 'recent'); });

  add('front', '统计模型', '均线交叉',
    '用近5期频率减去近20期频率的四分之一，推荐短期均线向上穿越的号码。',
    function (ctx) {
      return L.best(ctx, function (n) { return L.countLast(ctx, n, 5) - L.countLast(ctx, n, 20) * 0.25; }, 'recent');
    });

  add('front', '统计模型', '动量反转',
    '计算近5期出现次数与近20期平均的差，推荐超跌最明显的号码（动量反转）。',
    function (ctx) {
      return L.worst(ctx, function (n) { return L.countLast(ctx, n, 5) - L.countLast(ctx, n, 20) * 0.25; }, 'cold');
    });

  add('front', '统计模型', '马尔可夫一阶',
    '按“上期是否出现”划分状态，统计历史条件概率，推荐在本期状态下最可能出现的号码。',
    function (ctx) { return L.best(ctx, function (n) { return L.transition(ctx, n, 1); }, 'recent'); });

  add('front', '统计模型', '马尔可夫二阶',
    '按最近两期的出现状态划分四种情形，统计条件转移概率，推荐概率最高的号码。',
    function (ctx) { return L.best(ctx, function (n) { return L.transition(ctx, n, 2); }, 'recent'); });

  add('front', '统计模型', '集合跟随',
    '统计历史上“上期号码集合之后一期”的号码分布，推荐跟随次数最多的号码。',
    function (ctx) {
      var scores = {};
      ctx.cands.forEach(function (n) { scores[n] = 0; });
      for (var t = 0; t < ctx.seqs.length - 1; t++) {
        var intersects = ctx.seqs[t].some(function (n) { return ctx.last.indexOf(n) !== -1; });
        if (!intersects) continue;
        ctx.seqs[t + 1].forEach(function (n) { if (scores[n] !== undefined) scores[n]++; });
      }
      return L.best(ctx, function (n) { return scores[n]; }, 'recent');
    });

  add('front', '统计模型', '冷转热临界',
    '在遗漏 1~3 期的温号中，推荐近10期出现次数最多的号码，捕捉冷转热节点。',
    function (ctx) {
      var pool = ctx.cands.filter(function (n) {
        var om = L.omission(ctx, n);
        return om >= 1 && om <= 3;
      });
      return L.bestOf(ctx, pool.length ? pool : ctx.cands, function (n) { return L.countLast(ctx, n, 10); }, 'recent');
    });

  add('front', '数论映射', '黄金分割位',
    '按区间长度的 0.618 黄金分割位置取号，并加上上期和值做偏移，避免固定死号。',
    function (ctx) {
      var size = ctx.max - ctx.min + 1;
      var pos = Math.round(size * 0.618) + L.sum(ctx.last);
      return L.wrap(ctx.min + (pos % size), ctx.min, ctx.max);
    });

  add('front', '数论映射', '镜像号',
    '以区间中心为镜面，取上期均值号的镜像位置作为推荐。',
    function (ctx) {
      return L.wrap(ctx.min + ctx.max - Math.round(L.mean(ctx.last)), ctx.min, ctx.max);
    });

  add('front', '数论映射', '反向号',
    '用“区间上限 + 1 − 上期首号”生成反向号，代表号码轴上的对称位置。',
    function (ctx) { return L.wrap(ctx.max + 1 - (ctx.last[0] || ctx.min), ctx.min, ctx.max); });

  add('front', '数论映射', '质数序列定位',
    '列出区间内全部质数，用上期和值对质数个数取模定位，推荐对应质数。',
    function (ctx) {
      var primes = ctx.cands.filter(function (n) { return L.isPrime(n); });
      if (!primes.length) return ctx.min;
      return primes[L.sum(ctx.last) % primes.length];
    });

  add('front', '数论映射', '斐波那契定位',
    '列出区间内的斐波那契数，用当前期数对个数取模定位，推荐对应斐波那契号。',
    function (ctx) {
      var fibs = [], a = 1, b = 2;
      while (a <= ctx.max) {
        if (a >= ctx.min) fibs.push(a);
        var c = a + b; a = b; b = c;
      }
      if (!fibs.length) return ctx.min;
      return fibs[ctx.n % fibs.length];
    });

  add('front', '数论映射', '平方数邻近',
    '列出区间内的完全平方数，推荐与近10期号码均值最接近的平方数。',
    function (ctx) {
      var squares = [], i = 1;
      while (i * i <= ctx.max) { if (i * i >= ctx.min) squares.push(i * i); i++; }
      var flat = [];
      ctx.draws.slice(-10).forEach(function (d) { flat = flat.concat(d[ctx.zone]); });
      return nearestOf(ctx, squares, L.mean(flat), false);
    });

  add('front', '数论映射', '三角数邻近',
    '列出区间内的三角数（1,3,6,10…），推荐与近10期号码中位数最接近的三角数。',
    function (ctx) {
      var tris = [], i = 1, v = 1;
      while (v <= ctx.max) { if (v >= ctx.min) tris.push(v); i++; v = i * (i + 1) / 2; }
      var flat = [];
      ctx.draws.slice(-10).forEach(function (d) { flat = flat.concat(d[ctx.zone]); });
      return nearestOf(ctx, tris, L.median(flat), false);
    });

  add('front', '数论映射', '模 7 热组',
    '按号码除以 7 的余数分组，统计近30期最热的一组，推荐组内最活跃号码。',
    function (ctx) { return bestInGroup(ctx, function (n) { return n % 7; }, 30); });

  add('front', '数论映射', '模 5 热组',
    '按号码除以 5 的余数分组，统计近30期最热的一组，推荐组内最活跃号码。',
    function (ctx) { return bestInGroup(ctx, function (n) { return n % 5; }, 30); });

  add('front', '数论映射', '中位数邻近',
    '取近10期全部开出号码的中位数，推荐最接近该中位数且上期未出的号码。',
    function (ctx) { return medianPool(ctx, 10, true); });

  add('front', '数论映射', '标准差上轨',
    '计算近12期全部号码的均值与标准差，推荐落在“均值 + 1 个标准差”附近的号码。',
    function (ctx) {
      var flat = [];
      ctx.draws.slice(-12).forEach(function (d) { flat = flat.concat(d[ctx.zone]); });
      return nearestOf(ctx, ctx.cands, L.mean(flat) + L.std(flat), false);
    });

  add('front', '数论映射', '均值回归位',
    '取近10期全部号码的均值，推荐最接近均值且上期未出的号码。',
    function (ctx) {
      var flat = [];
      ctx.draws.slice(-10).forEach(function (d) { flat = flat.concat(d[ctx.zone]); });
      return nearestOf(ctx, ctx.cands, L.mean(flat), true);
    });

  add('front', '数论映射', '最大间隔中点',
    '在上期最小号到最大号之间，找出最大的未出号间隔，推荐其中点。',
    function (ctx) {
      if (ctx.last.length < 2) return ctx.min;
      var nums = ctx.last.slice().sort(function (a, b) { return a - b; });
      var bestGap = -1, mid = nums[0];
      for (var i = 1; i < nums.length; i++) {
        if (nums[i] - nums[i - 1] > bestGap) {
          bestGap = nums[i] - nums[i - 1];
          mid = (nums[i] + nums[i - 1]) / 2;
        }
      }
      return L.clamp(Math.round(mid), ctx.min, ctx.max);
    });

  add('front', '数论映射', '最小间隔中点',
    '找出上期相邻号码之间的最小间隔，推荐该间隔的中点，代表密集区中心。',
    function (ctx) {
      if (ctx.last.length < 2) return ctx.min;
      var nums = ctx.last.slice().sort(function (a, b) { return a - b; });
      var bestGap = Infinity, mid = nums[0];
      for (var i = 1; i < nums.length; i++) {
        var gap = nums[i] - nums[i - 1];
        if (gap < bestGap) { bestGap = gap; mid = (nums[i] + nums[i - 1]) / 2; }
      }
      return L.clamp(Math.round(mid), ctx.min, ctx.max);
    });

  add('front', '数论映射', '数字根',
    '把上期和值反复各位相加得到数字根，按区间回绕后作为推荐号。',
    function (ctx) {
      var s = L.sum(ctx.last);
      while (s > 9) s = String(s).split('').reduce(function (a, c) { return a + Number(c); }, 0);
      return L.wrap(s, ctx.min, ctx.max);
    });

  add('front', '期号日期', '期号数字和',
    '把最新期号的数字逐位相加，对区间长度取模后映射为号码。',
    function (ctx) {
      var issue = ctx.draws.length ? ctx.draws[ctx.draws.length - 1].issue : '';
      var size = ctx.max - ctx.min + 1;
      return ctx.min + (digitSum(issue) % size);
    });

  add('front', '期号日期', '期号尾数',
    '取最新期号的后两位，对区间长度取模后映射为号码，跟随期号节奏。',
    function (ctx) {
      var issue = ctx.draws.length ? ctx.draws[ctx.draws.length - 1].issue : '';
      var size = ctx.max - ctx.min + 1;
      return ctx.min + (Number(issue.slice(-2) || 0) % size);
    });

  add('front', '期号日期', '星期映射',
    '按最新开奖日期的星期，统计历史上同星期开奖的号码分布，推荐出现最多的号码。',
    function (ctx) {
      var last = ctx.draws[ctx.draws.length - 1] || {};
      var wd = weekdayOf(last.date);
      var counts = {};
      ctx.cands.forEach(function (n) { counts[n] = 0; });
      ctx.draws.forEach(function (d) {
        if (weekdayOf(d.date) === wd) d[ctx.zone].forEach(function (n) { counts[n]++; });
      });
      return L.best(ctx, function (n) { return counts[n]; }, 'recent');
    });

  add('front', '期号日期', '日期数字和',
    '把最新开奖日期（YYYY-MM-DD）的数字逐位相加，对区间长度取模后映射为号码。',
    function (ctx) {
      var last = ctx.draws[ctx.draws.length - 1] || {};
      var size = ctx.max - ctx.min + 1;
      return ctx.min + (digitSum(last.date) % size);
    });

  add('front', '期号日期', '月份映射',
    '取最新开奖月份，按区间长度取模映射为号码，代表时间维度上的位置。',
    function (ctx) {
      var last = ctx.draws[ctx.draws.length - 1] || {};
      var m = Number(String(last.date || '').slice(5, 7)) || 1;
      var size = ctx.max - ctx.min + 1;
      return ctx.min + ((m - 1) % size);
    });

  add('front', '统计模型', '和值尾数转移',
    '统计历史上“上期和值尾数 → 下期号码”的转移次数，推荐当前和值尾数之后出现最多的号码。',
    function (ctx) {
      var targetTail = L.sum(ctx.last) % 10;
      var scores = {};
      ctx.cands.forEach(function (n) { scores[n] = 0; });
      for (var t = 0; t < ctx.seqs.length - 1; t++) {
        if (L.sum(ctx.seqs[t]) % 10 !== targetTail) continue;
        ctx.seqs[t + 1].forEach(function (n) { if (scores[n] !== undefined) scores[n]++; });
      }
      return L.best(ctx, function (n) { return scores[n]; }, 'recent');
    });

  add('front', '遗漏', '尾数遗漏回补',
    '计算 0–9 每个尾数距上次出现的期数，选最久未出的尾数，再在该尾数中推荐近30期最活跃的号码。',
    function (ctx) {
      var bestTail = 0, bestOm = -1;
      for (var t = 0; t <= 9; t++) {
        var om = ctx.n;
        for (var i = ctx.seqs.length - 1; i >= 0; i--) {
          var hit = false;
          for (var j = 0; j < ctx.seqs[i].length; j++) {
            if (ctx.seqs[i][j] % 10 === t) { hit = true; break; }
          }
          if (hit) { om = ctx.seqs.length - 1 - i; break; }
        }
        if (om > bestOm) { bestOm = om; bestTail = t; }
      }
      var pool = ctx.cands.filter(function (n) { return n % 10 === bestTail; });
      return L.bestOf(ctx, pool, function (n) { return L.countLast(ctx, n, 30); }, 'recent');
    });

  add('front', '上期关联', '邻号遗漏',
    '取上期每个号码的左右邻号，推荐当前遗漏最久的一个；遗漏相同时优先近10期出现更多的号码。',
    function (ctx) {
      var pool = [];
      ctx.last.forEach(function (n) {
        pool.push(L.wrap(n - 1, ctx.min, ctx.max));
        pool.push(L.wrap(n + 1, ctx.min, ctx.max));
      });
      return L.bestOf(ctx, pool, function (n) { return L.omission(ctx, n); }, 'freq10');
    });

  add('front', '结构形态', '区间遗漏轮动',
    '把号码区间三等分，计算每个区距上次出号的期数，从最久未出号的区里推荐近20期最活跃号。',
    function (ctx) {
      var zoneOm = [ctx.n, ctx.n, ctx.n];
      for (var z = 0; z < 3; z++) {
        for (var i = ctx.seqs.length - 1; i >= 0; i--) {
          var hit = false;
          for (var j = 0; j < ctx.seqs[i].length; j++) {
            if (L.zoneIndex(ctx.seqs[i][j], ctx.min, ctx.max, 3) === z) { hit = true; break; }
          }
          if (hit) { zoneOm[z] = ctx.seqs.length - 1 - i; break; }
        }
      }
      var maxZ = 0;
      for (z = 1; z < 3; z++) if (zoneOm[z] > zoneOm[maxZ]) maxZ = z;
      var pool = ctx.cands.filter(function (n) { return L.zoneIndex(n, ctx.min, ctx.max, 3) === maxZ; });
      return L.bestOf(ctx, pool, function (n) { return L.countLast(ctx, n, 20); }, 'recent');
    });

  add('front', '遗漏', '质数遗漏',
    '在区间内的质数中推荐当前遗漏最久的号码；遗漏相同时优先近10期出现更多的号码。',
    function (ctx) {
      var pool = ctx.cands.filter(function (n) { return L.isPrime(n); });
      return L.bestOf(ctx, pool, function (n) { return L.omission(ctx, n); }, 'freq10');
    });

  /* ============================ 后区公式 ============================ */

  [5, 10, 15, 20, 30, 50, 100].forEach(function (w) {
    add('back', '频率', '后区热号 · 近' + w + '期',
      '统计后区近' + w + '期各号码出现次数，推荐出现最多的号码；同频优先最近出现者。',
      function (ctx) { return hot(ctx, w); });
  });

  [5, 10, 20, 30, 50, 100].forEach(function (w) {
    add('back', '频率', '后区冷号 · 近' + w + '期',
      '统计后区近' + w + '期出现次数最少的号码，同频优先遗漏更久者。',
      function (ctx) { return cold(ctx, w); });
  });

  [10, 20].forEach(function (w) {
    add('back', '频率', '后区衰减热度 · 近' + w + '期',
      '对后区近' + w + '期做指数衰减加权（λ=0.85），推荐热度最高的号码。',
      function (ctx) { return decay(ctx, w, 0.85); });
  });

  add('back', '遗漏', '后区最大遗漏',
    '推荐后区当前遗漏期数最大的号码。',
    function (ctx) { return L.best(ctx, function (n) { return L.omission(ctx, n); }, 'cold'); });

  add('back', '遗漏', '后区最小遗漏',
    '推荐后区最近刚开出的号码，代表热号延续。',
    function (ctx) { return L.worst(ctx, function (n) { return L.omission(ctx, n); }, 'recent'); });

  add('back', '遗漏', '后区遗漏偏差',
    '当前遗漏减去历史平均间隔，推荐超期最严重的后区号码。',
    function (ctx) {
      return L.best(ctx, function (n) { return L.omission(ctx, n) - L.avgGap(ctx, n); }, 'cold');
    });

  add('back', '上期关联', '后区重号',
    '在上期后区号码中，推荐历史上连续出现次数最多的号码。',
    function (ctx) { return L.bestOf(ctx, ctx.last, function (n) { return L.repeatScore(ctx, n); }, 'recent'); });

  [1, -1, 2, -2].forEach(function (step) {
    add('back', '上期关联', '后区邻号 ' + (step > 0 ? '+' : '') + step,
      '把上期后区号码平移 ' + step + ' 位（越界回绕），推荐近30期最活跃的邻号。',
      function (ctx) {
        var pool = ctx.last.map(function (n) { return L.wrap(n + step, ctx.min, ctx.max); });
        return L.bestOf(ctx, pool, function (n) { return L.countLast(ctx, n, 30); }, 'recent');
      });
  });

  add('back', '上期关联', '后区同尾号',
    '取上期后区号码的尾数，在同尾且上期未出的号码中推荐最活跃者。',
    function (ctx) {
      var tails = ctx.last.map(function (n) { return n % 10; });
      var pool = ctx.cands.filter(function (n) {
        return tails.indexOf(n % 10) !== -1 && ctx.last.indexOf(n) === -1;
      });
      return L.bestOf(ctx, pool.length ? pool : ctx.cands, function (n) { return L.countLast(ctx, n, 30); }, 'recent');
    });

  add('back', '和值跨度', '后区和值尾',
    '取上期后区和值的个位数，在该尾数号码中推荐近30期最活跃者。',
    function (ctx) {
      var tail = L.sum(ctx.last) % 10;
      var pool = ctx.cands.filter(function (n) { return n % 10 === tail; });
      return L.bestOf(ctx, pool, function (n) { return L.countLast(ctx, n, 30); }, 'recent');
    });

  add('back', '和值跨度', '后区和值均值',
    '取近10期后区和值平均值除以每期个数，推荐最接近该值的号码。',
    function (ctx) {
      var target = L.mean(sumSeries(ctx, 10)) / ctx.pick;
      return L.clamp(Math.round(target), ctx.min, ctx.max);
    });

  add('back', '和值跨度', '后区跨度均值',
    '取近10期后区跨度的平均值，推荐最接近该值的号码。',
    function (ctx) { return L.clamp(Math.round(L.mean(spanSeries(ctx, 10))), ctx.min, ctx.max); });

  add('back', '结构形态', '后区奇偶回补',
    '若上期后区奇数偏多，推荐近期最热的偶数号；反之推荐奇数号。',
    function (ctx) {
      var odd = ctx.last.filter(function (n) { return n % 2 === 1; }).length;
      var wantOdd = odd <= Math.floor(ctx.pick / 2);
      var pool = ctx.cands.filter(function (n) { return (n % 2 === 1) === wantOdd; });
      return L.bestOf(ctx, pool, function (n) { return L.countLast(ctx, n, 20); }, 'recent');
    });

  add('back', '结构形态', '后区大小回补',
    '以区间中点为界，从上期偏少的一侧推荐近20期最活跃号码。',
    function (ctx) {
      var mid = (ctx.min + ctx.max) / 2;
      var big = ctx.last.filter(function (n) { return n > mid; }).length;
      var wantBig = big <= Math.floor(ctx.pick / 2);
      var pool = ctx.cands.filter(function (n) { return (n > mid) === wantBig; });
      return L.bestOf(ctx, pool, function (n) { return L.countLast(ctx, n, 20); }, 'recent');
    });

  add('back', '结构形态', '后区质合回补',
    '统计上期后区质数个数，从偏少的一类中推荐近20期最活跃号码。',
    function (ctx) {
      var primes = ctx.last.filter(function (n) { return L.isPrime(n); }).length;
      var wantPrime = primes <= Math.floor(ctx.pick / 2);
      var pool = ctx.cands.filter(function (n) { return L.isPrime(n) === wantPrime; });
      return L.bestOf(ctx, pool, function (n) { return L.countLast(ctx, n, 20); }, 'recent');
    });

  add('back', '结构形态', '后区尾数热',
    '统计近20期后区尾数分布，推荐最热尾数中最活跃的号码。',
    function (ctx) { return bestInGroup(ctx, function (n) { return n % 10; }, 20); });

  add('back', '结构形态', '后区尾数冷',
    '统计近30期后区尾数分布，推荐最冷尾数中遗漏最久的号码。',
    function (ctx) {
      var cnt = {};
      ctx.seqs.slice(-30).forEach(function (arr) { arr.forEach(function (n) { cnt[n % 10] = (cnt[n % 10] || 0) + 1; }); });
      var bestTail = 0, best = Infinity;
      for (var t = 0; t <= 9; t++) if ((cnt[t] || 0) < best) { best = cnt[t] || 0; bestTail = t; }
      var pool = ctx.cands.filter(function (n) { return n % 10 === bestTail; });
      return L.bestOf(ctx, pool, function (n) { return -L.omission(ctx, n); }, 'cold');
    });

  add('back', '结构形态', '后区 012 路',
    '按除以 3 的余数分组，从上期后区最少的余数类中推荐近30期最活跃号码。',
    function (ctx) {
      var roads = [0, 0, 0];
      ctx.last.forEach(function (n) { roads[n % 3]++; });
      var minRoad = 0;
      for (var i = 1; i < 3; i++) if (roads[i] < roads[minRoad]) minRoad = i;
      var pool = ctx.cands.filter(function (n) { return n % 3 === minRoad; });
      return L.bestOf(ctx, pool, function (n) { return L.countLast(ctx, n, 30); }, 'recent');
    });

  add('back', '统计模型', '后区线性趋势',
    '对近20期后区出现序列做线性回归，推荐斜率最大的号码。',
    function (ctx) { return L.best(ctx, function (n) { return L.trendSlope(ctx, n, 20); }, 'recent'); });

  add('back', '统计模型', '后区 EWMA',
    '对近30期后区做半衰期 8 期的指数平滑，推荐平滑热度最高者。',
    function (ctx) { return decay(ctx, 30, Math.pow(0.5, 1 / 8)); });

  add('back', '统计模型', '后区贝叶斯',
    '用 Beta 先验平滑近30期后区出现率，推荐后验概率最高的号码。',
    function (ctx) {
      var w = 30, prior = ctx.pick / ctx.cands.length;
      return L.best(ctx, function (n) { return (L.countLast(ctx, n, w) + 2 * prior) / (w + 2); }, 'recent');
    });

  add('back', '统计模型', '后区卡方偏高',
    '以近30期理论出现次数为期望，推荐卡方偏差最大的后区号码。',
    function (ctx) {
      var w = 30, exp = w * ctx.pick / ctx.cands.length;
      return L.best(ctx, function (n) { return Math.pow(L.countLast(ctx, n, w) - exp, 2) / exp; }, 'recent');
    });

  add('back', '统计模型', '后区卡方偏低',
    '推荐近30期卡方偏差最小（最冷）的后区号码，等待回归。',
    function (ctx) {
      var w = 30, exp = w * ctx.pick / ctx.cands.length;
      return L.worst(ctx, function (n) { return Math.pow(L.countLast(ctx, n, w) - exp, 2) / exp; }, 'cold');
    });

  add('back', '统计模型', '后区马尔可夫',
    '按“上期是否出现”划分状态，推荐后区条件转移概率最高的号码。',
    function (ctx) { return L.best(ctx, function (n) { return L.transition(ctx, n, 1); }, 'recent'); });

  add('back', '统计模型', '后区自相关',
    '对近50期后区出现序列计算 lag-1 自相关，推荐惯性最强号码。',
    function (ctx) { return L.best(ctx, function (n) { return L.autocorr(ctx, n, 50); }, 'recent'); });

  add('back', '数论映射', '后区黄金分割',
    '按后区区间长度的 0.618 位置取号，并叠加最近期号尾数做偏移。',
    function (ctx) {
      var size = ctx.max - ctx.min + 1;
      var issue = ctx.draws.length ? Number(ctx.draws[ctx.draws.length - 1].issue.slice(-2) || 0) : 0;
      return L.wrap(ctx.min + (Math.round(size * 0.618) + issue) % size, ctx.min, ctx.max);
    });

  add('back', '数论映射', '后区镜像号',
    '以后区中心为镜面，取上期后区均值号的镜像位置。',
    function (ctx) {
      return L.wrap(ctx.min + ctx.max - Math.round(L.mean(ctx.last)), ctx.min, ctx.max);
    });

  add('back', '数论映射', '后区质数定位',
    '列出后区全部质数，用上期后区和值取模定位，推荐对应质数。',
    function (ctx) {
      var primes = ctx.cands.filter(function (n) { return L.isPrime(n); });
      return primes.length ? primes[L.sum(ctx.last) % primes.length] : ctx.min;
    });

  add('back', '数论映射', '后区斐波那契',
    '列出后区区间内的斐波那契数，用当前期数取模定位。',
    function (ctx) {
      var fibs = [], a = 1, b = 2;
      while (a <= ctx.max) { if (a >= ctx.min) fibs.push(a); var c = a + b; a = b; b = c; }
      return fibs.length ? fibs[ctx.n % fibs.length] : ctx.min;
    });

  add('back', '数论映射', '后区中位数',
    '取近10期后区全部号码的中位数，推荐最接近的号码。',
    function (ctx) { return medianPool(ctx, 10, false); });

  add('back', '数论映射', '后区均值回归',
    '取近10期后区全部号码的均值，推荐最接近均值的号码。',
    function (ctx) {
      var flat = [];
      ctx.draws.slice(-10).forEach(function (d) { flat = flat.concat(d[ctx.zone]); });
      return nearestOf(ctx, ctx.cands, L.mean(flat), false);
    });

  add('back', '期号日期', '后区期号数字和',
    '把最新期号数字逐位相加，对后区长度取模映射为号码。',
    function (ctx) {
      var issue = ctx.draws.length ? ctx.draws[ctx.draws.length - 1].issue : '';
      return ctx.min + (digitSum(issue) % (ctx.max - ctx.min + 1));
    });

  add('back', '期号日期', '后区星期映射',
    '按最新开奖日期的星期，统计同星期历史后区号码分布，推荐最多者。',
    function (ctx) {
      var last = ctx.draws[ctx.draws.length - 1] || {};
      var wd = weekdayOf(last.date);
      var counts = {};
      ctx.cands.forEach(function (n) { counts[n] = 0; });
      ctx.draws.forEach(function (d) {
        if (weekdayOf(d.date) === wd) d[ctx.zone].forEach(function (n) { counts[n]++; });
      });
      return L.best(ctx, function (n) { return counts[n]; }, 'recent');
    });

  add('back', '跨区联动', '前区和值映射',
    '用同期前区（或红球）和值对后区长度取模，推荐映射位置的后区号。',
    function (ctx) {
      var other = ctx.zone === 'back' ? 'front' : 'back';
      var last = ctx.draws[ctx.draws.length - 1] || {};
      var s = L.sum(last[other] || []);
      return ctx.min + (s % (ctx.max - ctx.min + 1));
    });

  add('back', '跨区联动', '前区跨度映射',
    '用同期前区（或红球）跨度对后区长度取模，推荐映射位置的后区号。',
    function (ctx) {
      var other = ctx.zone === 'back' ? 'front' : 'back';
      var last = ctx.draws[ctx.draws.length - 1] || {};
      return ctx.min + (L.span(last[other] || []) % (ctx.max - ctx.min + 1));
    });

  add('back', '遗漏', '后区尾数遗漏',
    '计算后区 0–9 每个尾数距上次出现的期数，推荐最久未出尾数中近30期最活跃的号码。',
    function (ctx) {
      var bestTail = 0, bestOm = -1;
      for (var t = 0; t <= 9; t++) {
        var om = ctx.n;
        for (var i = ctx.seqs.length - 1; i >= 0; i--) {
          var hit = false;
          for (var j = 0; j < ctx.seqs[i].length; j++) {
            if (ctx.seqs[i][j] % 10 === t) { hit = true; break; }
          }
          if (hit) { om = ctx.seqs.length - 1 - i; break; }
        }
        if (om > bestOm) { bestOm = om; bestTail = t; }
      }
      var pool = ctx.cands.filter(function (n) { return n % 10 === bestTail; });
      return L.bestOf(ctx, pool, function (n) { return L.countLast(ctx, n, 30); }, 'recent');
    });

  add('back', '统计模型', '后区和值尾转移',
    '统计历史上“上期后区和值尾数 → 下期号码”的转移次数，推荐当前和值尾数之后出现最多的后区号。',
    function (ctx) {
      var targetTail = L.sum(ctx.last) % 10;
      var scores = {};
      ctx.cands.forEach(function (n) { scores[n] = 0; });
      for (var t = 0; t < ctx.seqs.length - 1; t++) {
        if (L.sum(ctx.seqs[t]) % 10 !== targetTail) continue;
        ctx.seqs[t + 1].forEach(function (n) { if (scores[n] !== undefined) scores[n]++; });
      }
      return L.best(ctx, function (n) { return scores[n]; }, 'recent');
    });

  add('back', '上期关联', '后区邻号遗漏',
    '取上期后区号码的左右邻号，推荐当前遗漏最久的一个；遗漏相同时优先近10期出现更多的号码。',
    function (ctx) {
      var pool = [];
      ctx.last.forEach(function (n) {
        pool.push(L.wrap(n - 1, ctx.min, ctx.max));
        pool.push(L.wrap(n + 1, ctx.min, ctx.max));
      });
      return L.bestOf(ctx, pool, function (n) { return L.omission(ctx, n); }, 'freq10');
    });

  var byZone = { front: [], back: [] };
  formulas.forEach(function (f) { byZone[f.zone].push(f); });

  var API = {
    all: formulas,
    front: byZone.front,
    back: byZone.back,
    stats: {
      total: formulas.length,
      front: byZone.front.length,
      back: byZone.back.length,
      categories: formulas.reduce(function (acc, f) {
        acc[f.cat] = (acc[f.cat] || 0) + 1;
        return acc;
      }, {})
    }
  };

  root.LotteryFormulas = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof globalThis !== 'undefined' ? globalThis : this);
