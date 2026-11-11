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

  /* ---------- 反思维公式：刻意避开大众常见选号，降低撞号/分奖概率 ---------- */

  add('front', '反思维', '反生日号',
    '避开 1–31 的生日号段，在 32 以上的号码中推荐遗漏最久者，降低与大众生日选号撞车的概率。',
    function (ctx) {
      var pool = ctx.cands.filter(function (n) { return n > 31; });
      return L.bestOf(ctx, pool.length ? pool : ctx.cands, function (n) { return L.omission(ctx, n); }, 'freq10');
    });

  add('front', '反思维', '反吉利尾',
    '避开尾数 6/8/9 等大众偏爱尾数，在其余尾数中推荐遗漏最久的号码。',
    function (ctx) {
      var pool = ctx.cands.filter(function (n) { return [6, 8, 9].indexOf(n % 10) === -1; });
      return L.bestOf(ctx, pool, function (n) { return L.omission(ctx, n); }, 'freq10');
    });

  add('front', '反思维', '反上期重号',
    '避开上期开出的全部号码，在未开号码中推荐遗漏最久者，刻意不追刚开出的号。',
    function (ctx) {
      var pool = ctx.cands.filter(function (n) { return ctx.last.indexOf(n) === -1; });
      return L.bestOf(ctx, pool.length ? pool : ctx.cands, function (n) { return L.omission(ctx, n); }, 'freq10');
    });

  add('front', '反思维', '反上期邻号',
    '避开上期号码及其 ±1 邻号，推荐距离上期号码至少 2 位、且遗漏最久的号码。',
    function (ctx) {
      var pool = ctx.cands.filter(function (n) {
        return !ctx.last.some(function (x) { return Math.abs(n - x) <= 1; });
      });
      return L.bestOf(ctx, pool.length ? pool : ctx.cands, function (n) { return L.omission(ctx, n); }, 'freq10');
    });

  add('front', '反思维', '反同尾',
    '避开上期出现过的尾数，在其他尾数中推荐遗漏最久者。',
    function (ctx) {
      var tails = ctx.last.map(function (n) { return n % 10; });
      var pool = ctx.cands.filter(function (n) { return tails.indexOf(n % 10) === -1; });
      return L.bestOf(ctx, pool.length ? pool : ctx.cands, function (n) { return L.omission(ctx, n); }, 'freq10');
    });

  add('front', '反思维', '反对称号',
    '避开上期号码的镜像位（区间首尾对称），推荐非对称位置上遗漏最久的号码。',
    function (ctx) {
      var mirrors = ctx.last.map(function (n) { return ctx.min + ctx.max - n; });
      var pool = ctx.cands.filter(function (n) { return mirrors.indexOf(n) === -1; });
      return L.bestOf(ctx, pool.length ? pool : ctx.cands, function (n) { return L.omission(ctx, n); }, 'freq10');
    });

  add('front', '反思维', '反奇偶',
    '若上期奇数偏多则推荐被冷落的偶数，反之推荐奇数，且优先遗漏更久者。',
    function (ctx) {
      var odd = ctx.last.filter(function (n) { return n % 2 === 1; }).length;
      var wantOdd = odd <= Math.floor(ctx.pick / 2);
      var pool = ctx.cands.filter(function (n) { return (n % 2 === 1) === wantOdd; });
      return L.bestOf(ctx, pool, function (n) { return L.omission(ctx, n); }, 'freq10');
    });

  add('front', '反思维', '反大小',
    '若上期大号偏多则推荐被冷落的小号，反之推荐大号，且优先遗漏更久者。',
    function (ctx) {
      var mid = (ctx.min + ctx.max) / 2;
      var big = ctx.last.filter(function (n) { return n > mid; }).length;
      var wantBig = big <= Math.floor(ctx.pick / 2);
      var pool = ctx.cands.filter(function (n) { return (n > mid) === wantBig; });
      return L.bestOf(ctx, pool, function (n) { return L.omission(ctx, n); }, 'freq10');
    });

  add('front', '反思维', '反热区',
    '统计近30期三个区的出号量，从最冷区中推荐遗漏最久的号码，避开大众扎堆的热区。',
    function (ctx) {
      var counts = [0, 0, 0];
      ctx.seqs.slice(-30).forEach(function (arr) {
        arr.forEach(function (n) { counts[L.zoneIndex(n, ctx.min, ctx.max, 3)]++; });
      });
      var minZone = 0;
      for (var z = 1; z < 3; z++) if (counts[z] < counts[minZone]) minZone = z;
      var pool = ctx.cands.filter(function (n) { return L.zoneIndex(n, ctx.min, ctx.max, 3) === minZone; });
      return L.bestOf(ctx, pool, function (n) { return L.omission(ctx, n); }, 'freq10');
    });

  add('front', '反思维', '反热尾',
    '统计近30期各尾数出现次数，从最冷尾数中推荐遗漏最久的号码。',
    function (ctx) {
      var counts = {};
      ctx.seqs.slice(-30).forEach(function (arr) {
        arr.forEach(function (n) { counts[n % 10] = (counts[n % 10] || 0) + 1; });
      });
      var minTail = 0, minCount = Infinity;
      for (var t = 0; t <= 9; t++) {
        var c = counts[t] || 0;
        if (c < minCount) { minCount = c; minTail = t; }
      }
      var pool = ctx.cands.filter(function (n) { return n % 10 === minTail; });
      return L.bestOf(ctx, pool, function (n) { return L.omission(ctx, n); }, 'freq10');
    });

  add('front', '反思维', '反温和冷',
    '在近30期出现次数处于后 50%、且遗漏 3 期以上的号码中，推荐遗漏最接近其历史平均间隔的号码。',
    function (ctx) {
      var counts = ctx.cands.map(function (n) { return L.countLast(ctx, n, 30); });
      var cutoff = L.quantile(counts, 0.5);
      var pool = ctx.cands.filter(function (n) {
        return L.countLast(ctx, n, 30) <= cutoff && L.omission(ctx, n) >= 3;
      });
      return L.bestOf(ctx, pool.length ? pool : ctx.cands, function (n) {
        var g = L.gapStats(ctx, n);
        return -Math.abs(L.omission(ctx, n) - g.avg);
      }, 'cold');
    });

  add('front', '反思维', '反生日+反吉利',
    '同时避开 1–31 生日号段和 6/8/9 尾数，在剩余号码中推荐遗漏最久者。',
    function (ctx) {
      var pool = ctx.cands.filter(function (n) {
        return n > 31 && [6, 8, 9].indexOf(n % 10) === -1;
      });
      return L.bestOf(ctx, pool.length ? pool : ctx.cands, function (n) { return L.omission(ctx, n); }, 'freq10');
    });

  /* ---------- 大众选号偏好模型：分数越高，越可能和一大堆人买到同一注 ---------- */

  // 大众手选习惯：生日/日期号段、吉利尾 6·8·9、整五整十、质数、上期号码及其邻号、
  // 区间正中、投注单每行的首尾列。分越高撞号越严重，分越低越接近“无人区”。
  function popScore(ctx, n) {
    var s = 0, t = n % 10;
    var span = Math.max(1, ctx.max - ctx.min);
    var pos = (n - ctx.min) / span;
    var col = (n - ctx.min) % 10;
    if (n >= 1 && n <= 31) s += 3;                 // 生日 / 日期号段
    if (n >= 1 && n <= 12) s += 1;                 // 月份号
    if (t === 6 || t === 8 || t === 9) s += 2;     // 吉利尾
    if (t === 5 || t === 0) s += 1;                // 整五整十
    if (n === 18 || n === 28) s += 1;              // “要发”号
    if (L.isPrime(n)) s += 1;                      // 质数偏好
    if (ctx.last.indexOf(n) !== -1) s += 2;        // 照抄上期
    if (ctx.last.some(function (x) { return Math.abs(n - x) === 1; })) s += 2;  // 跟上期邻号
    if (Math.abs(pos - 0.5) < 0.17) s += 1;        // 区间正中
    if (col === 0 || col === 9) s += 1;            // 投注单每行首尾列
    return s;
  }
  function antiPopular(ctx, pool) {
    var list = pool && pool.length ? pool : ctx.cands;
    return L.bestOf(ctx, list, function (n) {
      return -popScore(ctx, n) * 10 + L.omission(ctx, n) / 100;
    }, 'cold');
  }

  add('front', '反思维', '避众指数',
    '给每个号码打“大众偏好分”：生日号段、吉利尾 6/8/9、整五整十、质数、上期号码与邻号、区间正中、投注单行首行尾都算热门位；在偏好分最低的号码里挑遗漏最久的，专挑没人愿意买的那一个。',
    function (ctx) { return antiPopular(ctx); });

  add('front', '反思维', '避众指数 · 极冷',
    '先取大众偏好分最低的一半号码，再按近100期出现次数从少到多挑，取“形态冷门 + 长期没人碰”的号码。',
    function (ctx) {
      var scores = ctx.cands.map(function (n) { return popScore(ctx, n); });
      var cutoff = L.quantile(scores, 0.5);
      var pool = ctx.cands.filter(function (n) { return popScore(ctx, n) <= cutoff; });
      return L.bestOf(ctx, pool.length ? pool : ctx.cands, function (n) {
        return -L.countLast(ctx, n, 100) * 10 + L.omission(ctx, n) / 100;
      }, 'cold');
    });

  add('front', '反思维', '反忌讳数',
    '大众普遍回避 4 尾以及 13、14、24 这类“不吉利”号码，正好可以从这些被嫌弃的号码里挑遗漏最久的一个。',
    function (ctx) {
      var pool = ctx.cands.filter(function (n) {
        return n % 10 === 4 || n === 13 || n === 14 || n === 24;
      });
      return L.bestOf(ctx, pool.length ? pool : ctx.cands, function (n) { return L.omission(ctx, n); }, 'freq10');
    });

  add('front', '反思维', '反整五整十',
    '排除 5 的倍数（5/10/15/20/25/30 等）这些大众爱挑的整数号，在剩下的号码中推荐遗漏最久者。',
    function (ctx) {
      var pool = ctx.cands.filter(function (n) { return n % 5 !== 0; });
      return L.bestOf(ctx, pool.length ? pool : ctx.cands, function (n) { return L.omission(ctx, n); }, 'freq10');
    });

  add('front', '反思维', '反热门榜',
    '把近20期出现 3 次以上的号码视为“榜单热号”，这些号注定被大量人跟买；在其余号码中推荐遗漏最久者。',
    function (ctx) {
      var pool = ctx.cands.filter(function (n) { return L.countLast(ctx, n, 20) < 3; });
      return L.bestOf(ctx, pool.length ? pool : ctx.cands, function (n) { return L.omission(ctx, n); }, 'freq10');
    });

  add('front', '反思维', '反均衡形态',
    '大众习惯把一注选成奇偶、大小“刚刚好”的均衡样式；统计全部历史奇偶出号总量，从偏少的一侧挑遗漏最久的号码，让整注形态主动偏离大众模板。',
    function (ctx) {
      var odd = 0, even = 0;
      ctx.seqs.forEach(function (arr) {
        arr.forEach(function (n) { if (n % 2 === 1) odd++; else even++; });
      });
      var wantOdd = odd <= even;
      var pool = ctx.cands.filter(function (n) { return (n % 2 === 1) === wantOdd; });
      return L.bestOf(ctx, pool.length ? pool : ctx.cands, function (n) { return L.omission(ctx, n); }, 'freq10');
    });

  add('front', '反思维', '反连号簇',
    '避开近 3 期任意号码的 ±1 邻域——那是“顺子党”和跟号族最爱扎堆的地方，在真空区里推荐遗漏最久者。',
    function (ctx) {
      var near = [];
      ctx.seqs.slice(-3).forEach(function (arr) {
        arr.forEach(function (x) { near.push(x - 1, x + 1, x); });
      });
      var pool = ctx.cands.filter(function (n) { return near.indexOf(n) === -1; });
      return L.bestOf(ctx, pool.length ? pool : ctx.cands, function (n) { return L.omission(ctx, n); }, 'freq10');
    });

  add('front', '反思维', '反等差数列',
    '上期任意两个号码的等距延展位（由 a、b 得到 2b−a 与 2a−b）是最常见的“规律号”，排除这些位置后推荐遗漏最久者。',
    function (ctx) {
      var banned = [];
      for (var i = 0; i < ctx.last.length; i++) {
        for (var j = i + 1; j < ctx.last.length; j++) {
          banned.push(2 * ctx.last[i] - ctx.last[j], 2 * ctx.last[j] - ctx.last[i]);
        }
      }
      var pool = ctx.cands.filter(function (n) { return banned.indexOf(n) === -1; });
      return L.bestOf(ctx, pool.length ? pool : ctx.cands, function (n) { return L.omission(ctx, n); }, 'freq10');
    });

  add('front', '反思维', '反票面图形',
    '很多人在投注单上画方框、十字、对角线，落点集中在每行首尾列；避开这些图形位，在其余号码中推荐遗漏最久者。',
    function (ctx) {
      var pool = ctx.cands.filter(function (n) {
        var col = (n - ctx.min) % 10;
        return col !== 0 && col !== 9;
      });
      return L.bestOf(ctx, pool.length ? pool : ctx.cands, function (n) { return L.omission(ctx, n); }, 'freq10');
    });

  add('front', '反思维', '反跨期热圈',
    '避开近 5 期开出过的全部号码——这些号会被大量“追热”的人继续投注，在 5 期之外的冷号里推荐遗漏最久者。',
    function (ctx) {
      var recent = [];
      ctx.seqs.slice(-5).forEach(function (arr) { recent = recent.concat(arr); });
      var pool = ctx.cands.filter(function (n) { return recent.indexOf(n) === -1; });
      return L.bestOf(ctx, pool.length ? pool : ctx.cands, function (n) { return L.omission(ctx, n); }, 'freq10');
    });

  add('front', '反思维', '反质数偏好',
    '质数（2/3/5/7/11…）是手选票里的高频偏好；跳过全部质数，在合数中推荐遗漏最久者。',
    function (ctx) {
      var pool = ctx.cands.filter(function (n) { return !L.isPrime(n); });
      return L.bestOf(ctx, pool.length ? pool : ctx.cands, function (n) { return L.omission(ctx, n); }, 'freq10');
    });

  add('front', '反思维', '反小号扎堆',
    '大众选号明显偏爱小号区（生日、月份都挤在前段），排除区间最小的三分之一，在其余号码中推荐遗漏最久者。',
    function (ctx) {
      var cut = ctx.min + Math.floor((ctx.max - ctx.min + 1) / 3);
      var pool = ctx.cands.filter(function (n) { return n > cut; });
      return L.bestOf(ctx, pool.length ? pool : ctx.cands, function (n) { return L.omission(ctx, n); }, 'freq10');
    });

  add('front', '反思维', '反双尾热',
    '统计近10期各尾数出现次数，排除出现 2 次以上的尾数（连出尾是大众追捧的“强势尾”），在其余尾数中推荐遗漏最久者。',
    function (ctx) {
      var counts = {};
      ctx.seqs.slice(-10).forEach(function (arr) {
        arr.forEach(function (n) { counts[n % 10] = (counts[n % 10] || 0) + 1; });
      });
      var pool = ctx.cands.filter(function (n) { return (counts[n % 10] || 0) < 2; });
      return L.bestOf(ctx, pool.length ? pool : ctx.cands, function (n) { return L.omission(ctx, n); }, 'freq10');
    });

  add('front', '反思维', '反日期号',
    '很多人按开奖当天的月、日数字买号；把最新一期的月份与日期数排除，在剩下的号码中推荐遗漏最久者。',
    function (ctx) {
      var last = ctx.draws[ctx.draws.length - 1] || {};
      var d = new Date(String(last.date || '').replace(/-/g, '/'));
      var banned = [];
      if (!isNaN(d.getTime())) banned = [d.getDate(), d.getMonth() + 1];
      var pool = ctx.cands.filter(function (n) { return banned.indexOf(n) === -1; });
      return L.bestOf(ctx, pool.length ? pool : ctx.cands, function (n) { return L.omission(ctx, n); }, 'freq10');
    });

  add('front', '反思维', '反惧连号',
    '手选票常刻意回避相邻号，但历史开奖 64.5% 都带连号；主动在上期号码的 ±1 位置里挑遗漏最久的一个，抢大众躲开的位置。',
    function (ctx) {
      var pool = [];
      ctx.last.forEach(function (x) { pool.push(x - 1, x + 1); });
      return L.bestOf(ctx, pool, function (n) { return L.omission(ctx, n); }, 'freq10');
    });

  add('front', '反思维', '反尾数全异',
    '大众喜欢让一注的尾数各不相同，而历史开奖 75.5% 的期数尾数有重复；从近10期出现过的尾数里挑遗漏最久的号码，主动留重复尾。',
    function (ctx) {
      var tails = {};
      ctx.seqs.slice(-10).forEach(function (arr) {
        arr.forEach(function (n) { tails[n % 10] = 1; });
      });
      var pool = ctx.cands.filter(function (n) { return tails[n % 10]; });
      return L.bestOf(ctx, pool.length ? pool : ctx.cands, function (n) { return L.omission(ctx, n); }, 'freq10');
    });

  add('front', '反思维', '反三区均分',
    '大众习惯三区各挑两个，但真实开奖的三区比很少真的均分；统计近30期出号最多的区，从该区推荐遗漏最久的号码，让整注三区比主动偏斜。',
    function (ctx) {
      var counts = [0, 0, 0];
      ctx.seqs.slice(-30).forEach(function (arr) {
        arr.forEach(function (n) { counts[L.zoneIndex(n, ctx.min, ctx.max, 3)]++; });
      });
      var maxZ = 0;
      for (var z = 1; z < 3; z++) if (counts[z] > counts[maxZ]) maxZ = z;
      var pool = ctx.cands.filter(function (n) { return L.zoneIndex(n, ctx.min, ctx.max, 3) === maxZ; });
      return L.bestOf(ctx, pool.length ? pool : ctx.cands, function (n) { return L.omission(ctx, n); }, 'freq10');
    });

  add('front', '反思维', '反小跨度',
    '大众选号挤在生日段，整注跨度自然偏小（历史跨度均值 24.5、最大 32）；在区间两端各取 10% 的号码，推荐遗漏最久者，把跨度拉到接近满幅。',
    function (ctx) {
      var edge = Math.max(1, Math.round((ctx.max - ctx.min + 1) * 0.1));
      var pool = ctx.cands.filter(function (n) { return n <= ctx.min + edge || n >= ctx.max - edge; });
      return L.bestOf(ctx, pool.length ? pool : ctx.cands, function (n) { return L.omission(ctx, n); }, 'freq10');
    });

  add('front', '反思维', '反忌大号',
    '手选票很少选区间末尾的大号，机器却不管这些；在区间最后 10% 的号码里推荐遗漏最久者，专门捡大众不敢选的号。',
    function (ctx) {
      var cut = ctx.max - Math.max(1, Math.round((ctx.max - ctx.min + 1) * 0.1));
      var pool = ctx.cands.filter(function (n) { return n > cut; });
      return L.bestOf(ctx, pool.length ? pool : ctx.cands, function (n) { return L.omission(ctx, n); }, 'freq10');
    });

  add('front', '反思维', '反惧等差',
    '大众会刻意回避“2、4、6 这种太整齐”的号码，但整齐并不等于不可能；主动从上期号码的等距延展位里挑遗漏最久者。',
    function (ctx) {
      var pool = [];
      for (var i = 0; i < ctx.last.length; i++) {
        for (var j = i + 1; j < ctx.last.length; j++) {
          pool.push(2 * ctx.last[i] - ctx.last[j], 2 * ctx.last[j] - ctx.last[i]);
        }
      }
      return L.bestOf(ctx, pool, function (n) { return L.omission(ctx, n); }, 'freq10');
    });

  add('front', '反思维', '反补冷直觉',
    '大众看到长时间没出的号就想“该补了”，冷号反而被买爆；这条公式反过来只从近 3 期刚开出的号码里挑遗漏最短的那个，专捡大众刚放弃的号。',
    function (ctx) {
      var pool = [];
      ctx.seqs.slice(-3).forEach(function (arr) { pool = pool.concat(arr); });
      return L.bestOf(ctx, pool.length ? pool : ctx.cands, function (n) { return -L.omission(ctx, n); }, 'recent');
    });

  add('front', '反思维', '反回补直觉',
    '大众总想“上期奇数多、这期该补偶数”，被补的一侧于是挤满票；这条公式从上期偏多的一侧继续选遗漏最久的号，顺着趋势、逆着人群。',
    function (ctx) {
      var odd = ctx.last.filter(function (n) { return n % 2 === 1; }).length;
      var wantOdd = odd > Math.floor(ctx.pick / 2);
      var pool = ctx.cands.filter(function (n) { return (n % 2 === 1) === wantOdd; });
      return L.bestOf(ctx, pool.length ? pool : ctx.cands, function (n) { return L.omission(ctx, n); }, 'freq10');
    });

  add('front', '反思维', '反和值均值区',
    '历史上只有 41.5% 的开奖和值落在 90–110 这个大众最爱的区间；比较近10期和值均值与理论中位，往相反方向取号，让整注和值跑出大众舒适区。',
    function (ctx) {
      var avg = L.mean(sumSeries(ctx, 10));
      var theory = ctx.pick * (ctx.min + ctx.max) / 2;
      var mid = (ctx.min + ctx.max) / 2;
      var pool = ctx.cands.filter(function (n) { return avg >= theory ? n < mid : n > mid; });
      return L.bestOf(ctx, pool.length ? pool : ctx.cands, function (n) { return L.omission(ctx, n); }, 'freq10');
    });

  add('front', '反思维', '反月份区',
    '大众习惯把 1–12 当“月份号”塞进每一注，这一段被反复重复购买；把区间前 12 个号码整体排除，在其余号码中推荐遗漏最久者。',
    function (ctx) {
      var pool = ctx.cands.filter(function (n) { return n > ctx.min + 11; });
      return L.bestOf(ctx, pool.length ? pool : ctx.cands, function (n) { return L.omission(ctx, n); }, 'freq10');
    });

  /* ---------- 统计检验工具（纯函数，供统计模型公式复用） ---------- */

  function baseRate(ctx) { return ctx.pick / ctx.cands.length; }

  // 二项检验 Z：实际出现次数相对理论期望的标准化偏差
  function binomZ(ctx, n, w) {
    var m = Math.min(w, ctx.n) || 1, p = baseRate(ctx), c = L.countLast(ctx, n, m);
    return (c - m * p) / Math.sqrt(m * p * (1 - p) + 1e-9);
  }

  // 游程检验 Z：游程数越少说明越长时间连着没出（或连着出）
  function runsZ(ctx, n, w) {
    var seqs = ctx.seqs.slice(-w), m = seqs.length;
    if (m < 4) return 0;
    var runs = 0, ones = 0, prev = null;
    for (var i = 0; i < m; i++) {
      var y = seqs[i].indexOf(n) !== -1 ? 1 : 0;
      ones += y;
      if (prev === null || y !== prev) { runs++; prev = y; }
    }
    if (!ones || ones === m) return 0;
    var exp = 2 * ones * (m - ones) / m + 1;
    var varr = 2 * ones * (ones - 1) * (m - ones) * (m - ones - 1) / (m * m * (m - 1));
    return varr > 0 ? (runs - exp) / Math.sqrt(varr) : 0;
  }

  // 几何分布：当前遗漏在“每期独立”假设下的累积出现概率
  function geomCdf(ctx, n) {
    var p = baseRate(ctx);
    return 1 - Math.pow(1 - p, L.omission(ctx, n) + 1);
  }

  // 信息量 -log(平滑频率)：出现越少，意外度越高
  function surprise(ctx, n, w) {
    var m = Math.min(w, ctx.n) || 1;
    var c = L.countLast(ctx, n, m) + 0.5;
    return -Math.log(c / (m * ctx.pick + 0.5 * ctx.cands.length));
  }

  // 高斯核密度：近 w 期开出号码在 n 处的密度
  function kdeDensity(ctx, n, w, bw) {
    var flat = [];
    ctx.draws.slice(-w).forEach(function (d) { flat = flat.concat(d[ctx.zone]); });
    bw = bw || 1.5;
    var s = 0;
    flat.forEach(function (x) { s += Math.exp(-Math.pow(n - x, 2) / (2 * bw * bw)); });
    return s;
  }

  // 遗漏的中位数绝对偏差（MAD）稳健 Z
  function madZ(ctx, n) {
    var oms = ctx.cands.map(function (x) { return L.omission(ctx, x); });
    var med = L.median(oms);
    var mad = L.median(oms.map(function (x) { return Math.abs(x - med); }));
    return (L.omission(ctx, n) - med) / (1.4826 * (mad || 1));
  }

  // 半衰期指数加权的出现率偏差（EWMA Z）
  function ewmaBias(ctx, n, w, halfLife) {
    var seqs = ctx.seqs.slice(-w), m = seqs.length;
    if (!m) return 0;
    var p = baseRate(ctx), lambda = Math.pow(0.5, 1 / (halfLife || 10));
    var sum = 0, wt = 0;
    for (var i = 0; i < m; i++) {
      var k = Math.pow(lambda, m - 1 - i);
      sum += k * ((seqs[i].indexOf(n) !== -1 ? 1 : 0) - p);
      wt += k;
    }
    return wt ? sum / wt : 0;
  }

  // 把窗口切成 4 段，统计各段出现次数的变异系数
  function segmentCV(ctx, n, w) {
    var seqs = ctx.seqs.slice(-w), segs = 4, size = Math.max(1, Math.round(seqs.length / segs));
    var arr = [];
    for (var s = 0; s < segs; s++) {
      var c = 0;
      seqs.slice(s * size, (s + 1) * size).forEach(function (a) { if (a.indexOf(n) !== -1) c++; });
      arr.push(c);
    }
    var m = L.mean(arr), sd = L.std(arr);
    return m ? sd / m : 0;
  }

  // 威布尔风险率：以历史平均间隔为尺度，当前遗漏越超期风险率越高
  function weibullHazard(ctx, n, shape) {
    var g = L.gapStats(ctx, n);
    shape = shape || 1.2;
    return Math.pow((L.omission(ctx, n) + 1) / Math.max(1, g.avg), shape - 1);
  }

  // 长短期似然比：近10期出现率 / 近100期出现率
  function likelihoodRatio(ctx, n) {
    var p = baseRate(ctx);
    var shortW = Math.min(10, ctx.n) || 1, longW = Math.min(100, ctx.n) || 1;
    var shortRate = (L.countLast(ctx, n, shortW) + 0.5) / (shortW * p + 0.5);
    var longRate = (L.countLast(ctx, n, longW) + 0.5) / (longW * p + 0.5);
    return shortRate / longRate;
  }

  // Wilson 置信下界：小样本下更稳健的出现率下限
  function wilsonLower(ctx, n, w) {
    var m = Math.min(w, ctx.n) || 1, c = L.countLast(ctx, n, m), z = 1.64;
    var ph = c / m;
    return (ph + z * z / (2 * m) - z * Math.sqrt(ph * (1 - ph) / m + z * z / (4 * m * m))) / (1 + z * z / m);
  }

  // 指数衰减加权后的卡方偏差
  function decayChi(ctx, n, w, lambda) {
    var seqs = ctx.seqs.slice(-w), m = seqs.length;
    lambda = lambda || 0.9;
    var p = baseRate(ctx), obs = 0, exp = 0;
    for (var i = 0; i < m; i++) {
      var k = Math.pow(lambda, m - 1 - i);
      if (seqs[i].indexOf(n) !== -1) obs += k;
      exp += k * p;
    }
    return exp > 0 ? (obs - exp) * (obs - exp) / exp : 0;
  }

  // 经验贝叶斯收缩：以全体平均出现率为先验，把单号频率向先验收缩
  function shrinkRate(ctx, n, w, strength) {
    var m = Math.min(w, ctx.n) || 1, prior = baseRate(ctx), k = strength || 12;
    return (L.countLast(ctx, n, m) + prior * k) / (m + k);
  }

  // James-Stein 收缩估计：按组内离散度决定收缩力度
  function jamesStein(ctx, n, w) {
    var m = Math.min(w, ctx.n) || 1;
    var rates = ctx.cands.map(function (x) { return L.countLast(ctx, x, m); });
    var gm = L.mean(rates);
    var spread = rates.reduce(function (s, r) { return s + Math.pow(r - gm, 2); }, 0);
    var shrink = spread > 0 ? Math.min(1, (rates.length - 3) / spread) : 0;
    return gm + shrink * (L.countLast(ctx, n, m) - gm);
  }

  // 一维卡尔曼滤波：把“出现/未出”当观测，估计隐藏的出现率状态
  function kalman(ctx, n, w) {
    var seqs = ctx.seqs.slice(-w), p = baseRate(ctx);
    var x = p, cov = 0.1, rObs = 0.02, qProc = 0.05;
    for (var i = 0; i < seqs.length; i++) {
      var z = seqs[i].indexOf(n) !== -1 ? 1 : 0;
      cov += qProc;
      var k = cov / (cov + rObs);
      x = x + k * (z - x);
      cov = (1 - k) * cov;
    }
    return x;
  }

  // CUSUM 累积和：近期正向偏差的累计峰值，用来发现“悄悄变热/变冷”
  function cusum(ctx, n, w) {
    var seqs = ctx.seqs.slice(-w), p = baseRate(ctx), s = 0, peak = 0;
    for (var i = 0; i < seqs.length; i++) {
      s = Math.max(0, s + ((seqs[i].indexOf(n) !== -1 ? 1 : 0) - p));
      if (s > peak) peak = s;
    }
    return peak;
  }

  // Hurst 指数（R/S 法）：>0.5 趋势延续，<0.5 反持续（更接近均值回归）
  function hurst(ctx, n, w) {
    var seqs = ctx.seqs.slice(-w), m = seqs.length;
    if (m < 8) return 0.5;
    var y = seqs.map(function (a) { return a.indexOf(n) !== -1 ? 1 : 0; });
    var mean = L.mean(y), cum = 0, lo = 0, hi = 0;
    for (var i = 0; i < m; i++) {
      cum += y[i] - mean;
      if (cum < lo) lo = cum;
      if (cum > hi) hi = cum;
    }
    var range = hi - lo, sd = L.std(y);
    if (!sd || !range) return 0.5;
    return Math.log(range / sd) / Math.log(m);
  }

  // Kaplan-Meier 思路下的等待中位：历史间隔的中位数
  function medianGap(ctx, n) {
    var idx = [];
    for (var i = 0; i < ctx.seqs.length; i++) if (ctx.seqs[i].indexOf(n) !== -1) idx.push(i);
    if (idx.length < 2) return ctx.n;
    var gaps = [];
    for (var j = 1; j < idx.length; j++) gaps.push(idx[j] - idx[j - 1]);
    return L.median(gaps) || 1;
  }

  // 互信息：上期号码集合与候选号下期出现的关联强度
  function mutualInfo(ctx, n, lastSet, w) {
    var seqs = ctx.seqs.slice(-w), total = seqs.length - 1;
    if (total < 4 || !lastSet || !lastSet.length) return 0;
    var a1 = 0, b1 = 0, joint = 0;
    for (var t = 0; t < total; t++) {
      var a = seqs[t].some(function (x) { return lastSet.indexOf(x) !== -1; });
      var b = seqs[t + 1].indexOf(n) !== -1;
      if (a) a1++;
      if (b) b1++;
      if (a && b) joint++;
    }
    if (!joint || !a1 || !b1) return 0;
    var pJ = joint / total, pA = a1 / total, pB = b1 / total;
    return pJ * Math.log(pJ / (pA * pB));
  }

  // 一阶马尔可夫平稳分布：长期来看该号出现的稳态概率
  function stationary(ctx, n) {
    var c = [0, 0, 0, 0];
    for (var t = 0; t < ctx.seqs.length - 1; t++) {
      var a = ctx.seqs[t].indexOf(n) !== -1 ? 1 : 0;
      var b = ctx.seqs[t + 1].indexOf(n) !== -1 ? 1 : 0;
      c[a * 2 + b]++;
    }
    var p01 = (c[0] + c[1]) ? (c[1] + 0.5) / (c[0] + c[1] + 1) : 0.5;
    var p11 = (c[2] + c[3]) ? (c[3] + 0.5) / (c[2] + c[3] + 1) : 0.5;
    var den = p01 + (1 - p11);
    return den > 0 ? p01 / den : 0.5;
  }

  // Bootstrap 重采样命中率：用固定种子抽样估计近 w 期命中率的稳定性
  function bootstrapRate(ctx, n, w, reps) {
    var seqs = ctx.seqs.slice(-w), m = seqs.length;
    if (m < 6) return 0;
    var hits = seqs.map(function (a) { return a.indexOf(n) !== -1 ? 1 : 0; });
    var seed = 7, sum = 0, R = reps || 60;
    for (var r = 0; r < R; r++) {
      var c = 0;
      for (var i = 0; i < m; i++) {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        c += hits[seed % m];
      }
      sum += c / m;
    }
    return sum / R;
  }

  // 泊松对数线性趋势：log(出现次数) 随期数变化的斜率
  function poissonTrend(ctx, n, w) {
    var seqs = ctx.seqs.slice(-w), m = seqs.length;
    if (m < 6) return 0;
    var sx = 0, sy = 0, sxy = 0, sxx = 0;
    for (var i = 0; i < m; i++) {
      var y = Math.log((seqs[i].indexOf(n) !== -1 ? 1 : 0) + 0.5);
      sx += i; sy += y; sxy += i * y; sxx += i * i;
    }
    var den = m * sxx - sx * sx;
    return den ? (m * sxy - sx * sy) / den : 0;
  }

  // 谱密度：给定周期上 DFT 的归一化幅值
  function spectralPower(ctx, n, w, period) {
    var seqs = ctx.seqs.slice(-w), m = seqs.length;
    if (m < 8) return 0;
    var mean = 0, i;
    for (i = 0; i < m; i++) mean += seqs[i].indexOf(n) !== -1 ? 1 : 0;
    mean /= m;
    var re = 0, im = 0;
    for (i = 0; i < m; i++) {
      var y = (seqs[i].indexOf(n) !== -1 ? 1 : 0) - mean;
      var ang = 2 * Math.PI * i / period;
      re += y * Math.cos(ang);
      im -= y * Math.sin(ang);
    }
    return Math.sqrt(re * re + im * im) / m;
  }

  // 前后半段出现率之差：负值说明近期在降温
  function driftDiff(ctx, n, w) {
    var seqs = ctx.seqs.slice(-w), m = seqs.length;
    if (m < 8) return 0;
    var half = Math.floor(m / 2);
    function rate(list) {
      if (!list.length) return 0;
      var c = 0;
      list.forEach(function (a) { if (a.indexOf(n) !== -1) c++; });
      return c / list.length;
    }
    return rate(seqs.slice(half)) - rate(seqs.slice(0, half));
  }

  /* ---------- 新增统计模型公式 ---------- */

  add('front', '统计模型', '泊松低温',
    '以近30期理论出现次数为均值，计算每个号码的泊松 Z 值，推荐偏低最明显的号码。',
    function (ctx) {
      var w = 30, exp = w * ctx.pick / ctx.cands.length;
      return L.best(ctx, function (n) { return -L.poissonZ(L.countLast(ctx, n, w), exp); }, 'cold');
    });

  add('front', '统计模型', '遗漏 Z-Score',
    '用号码当前遗漏减去历史平均间隔，再除以间隔标准差，推荐标准化后最“超期”的号码。',
    function (ctx) {
      return L.best(ctx, function (n) {
        var g = L.gapStats(ctx, n);
        return (L.omission(ctx, n) - g.avg) / g.std;
      }, 'cold');
    });

  add('front', '统计模型', '共现提升度',
    '统计“上期出现过的号码 → 下期某个号码”的条件概率，除以该号码的基础概率，推荐提升度最高者。',
    function (ctx) {
      return L.best(ctx, function (n) { return L.cooccurLift(ctx, n, ctx.last, 120); }, 'recent');
    });

  add('front', '统计模型', '共现网络中心性',
    '把近100期号码共现关系看成网络，计算候选号与上期号码的共现强度，推荐网络中心性最高者。',
    function (ctx) {
      return L.best(ctx, function (n) { return L.cooccurNetwork(ctx, n, ctx.last, 100); }, 'recent');
    });

  add('front', '统计模型', '相似期匹配',
    '在历史中寻找和值、跨度、奇偶数最接近上期的 12 期，统计它们下一期开出的号码，推荐出现最多者。',
    function (ctx) {
      var scores = L.similarScores(ctx, 120, 12);
      return L.best(ctx, function (n) { return scores[n] || 0; }, 'recent');
    });

  add('front', '统计模型', 'AR(1) 自回归',
    '对近50期每个号码的出现序列拟合 AR(1)，用自回归系数预测下一期，推荐预测值最高者。',
    function (ctx) {
      return L.best(ctx, function (n) { return L.ar1(ctx, n, 50); }, 'recent');
    });

  add('front', '统计模型', 'Holt 趋势',
    '对近50期出现序列做 Holt 水平+趋势指数平滑，推荐下一期预测值最高的号码。',
    function (ctx) {
      return L.best(ctx, function (n) { return L.holt(ctx, n, 50, 0.3, 0.1); }, 'recent');
    });

  add('front', '统计模型', '正弦周期',
    '对近50期出现序列拟合周期为 10 的正弦/余弦分量，推荐下一期周期相位最高的号码。',
    function (ctx) {
      return L.best(ctx, function (n) { return L.sinFit(ctx, n, 50, 10); }, 'recent');
    });

  add('front', '统计模型', '分位数上沿',
    '取近10期全部开出号码的 75% 分位数，推荐最接近该分位且上期未出的号码。',
    function (ctx) {
      var flat = [];
      ctx.draws.slice(-10).forEach(function (d) { flat = flat.concat(d[ctx.zone]); });
      return nearestOf(ctx, ctx.cands, L.quantile(flat, 0.75), true);
    });

  add('front', '统计模型', '偏度方向',
    '计算近10期号码分布的偏度：右偏时取 80% 分位，左偏时取 20% 分位，推荐最接近的号码。',
    function (ctx) {
      var flat = [];
      ctx.draws.slice(-10).forEach(function (d) { flat = flat.concat(d[ctx.zone]); });
      var target = L.skewness(flat) >= 0 ? L.quantile(flat, 0.8) : L.quantile(flat, 0.2);
      return nearestOf(ctx, ctx.cands, target, true);
    });

  add('front', '统计模型', '二项 Z 检验',
    '把每个号码近30期的出现次数看成二项分布，推荐实际次数低于理论期望最明显的号码。',
    function (ctx) { return L.best(ctx, function (n) { return -binomZ(ctx, n, 30); }, 'cold'); });

  add('front', '统计模型', '游程检验',
    '对每个号码近40期的出现序列做游程检验，游程数越少说明连续空缺越长，推荐游程 Z 值最低（最该结束空缺）的号码。',
    function (ctx) { return L.best(ctx, function (n) { return runsZ(ctx, n, 40); }, 'cold'); });

  add('front', '统计模型', '几何等待分位',
    '按几何分布计算当前遗漏在“每期独立”假设下的累积概率，推荐最接近“该出现了”的号码。',
    function (ctx) { return L.best(ctx, function (n) { return geomCdf(ctx, n); }, 'cold'); });

  add('front', '统计模型', '信息熵权重',
    '用 -log(平滑频率) 衡量每个号码的“意外度”，推荐出现越少、信息量越大的号码。',
    function (ctx) { return L.best(ctx, function (n) { return surprise(ctx, n, 30); }, 'cold'); });

  add('front', '统计模型', '核密度低谷',
    '把近20期开出的号码看成高斯核密度（带宽 1.5），推荐核密度最低、位置最空的那个号码。',
    function (ctx) { return L.best(ctx, function (n) { return -kdeDensity(ctx, n, 20, 1.5); }, 'cold'); });

  add('front', '统计模型', 'MAD 稳健 Z',
    '用全部号码遗漏的中位数和绝对偏差 MAD 做稳健标准化，推荐当前遗漏偏离中位数最远的号码。',
    function (ctx) { return L.best(ctx, function (n) { return madZ(ctx, n); }, 'cold'); });

  add('front', '统计模型', '半衰期 EWMA Z',
    '对近30期出现序列做半衰期 8 期的指数加权，推荐加权出现率低于理论概率最多的号码。',
    function (ctx) { return L.best(ctx, function (n) { return -ewmaBias(ctx, n, 30, 8); }, 'cold'); });

  add('front', '统计模型', '变异系数稳定',
    '把近40期切成 4 段统计每个号码的出现次数，推荐段间变异系数最小、走势最稳定的号码。',
    function (ctx) { return L.best(ctx, function (n) { return -segmentCV(ctx, n, 40); }, 'recent'); });

  add('front', '统计模型', '威布尔风险率',
    '以历史平均间隔为尺度参数构造威布尔风险率，推荐超期程度最高（风险率最大）的号码。',
    function (ctx) { return L.best(ctx, function (n) { return weibullHazard(ctx, n, 1.2); }, 'cold'); });

  add('front', '统计模型', '长短期似然比',
    '比较近10期与近100期出现率，推荐短期明显降温（似然比最低）的号码，等待均值回归。',
    function (ctx) { return L.best(ctx, function (n) { return likelihoodRatio(ctx, n); }, 'cold'); });

  add('front', '统计模型', 'Wilson 下界',
    '用 Wilson 区间给出近30期出现率的 90% 置信下界，推荐下界最低的号码，比直接看频次更稳健。',
    function (ctx) { return L.best(ctx, function (n) { return wilsonLower(ctx, n, 30); }, 'cold'); });

  add('front', '统计模型', '衰减卡方',
    '对近30期做 λ=0.9 的指数衰减加权后再算卡方偏差，推荐加权偏差最小（最冷）的号码。',
    function (ctx) { return L.best(ctx, function (n) { return -decayChi(ctx, n, 30, 0.9); }, 'cold'); });

  add('front', '统计模型', '经验贝叶斯收缩',
    '用全体号码的平均出现率做先验，把每个号码近30期的频率向先验收缩（先验强度 12），推荐收缩后概率最低的号码。',
    function (ctx) { return L.best(ctx, function (n) { return -shrinkRate(ctx, n, 30, 12); }, 'cold'); });

  add('front', '统计模型', 'James-Stein 收缩',
    '按组内离散度自动决定收缩力度，把各号码近30期次数向组均值收缩，推荐收缩后估计值最低的号码。',
    function (ctx) { return L.best(ctx, function (n) { return -jamesStein(ctx, n, 30); }, 'cold'); });

  add('front', '统计模型', '卡尔曼滤波',
    '把每期的“出现/未出”当成带噪观测，用一维卡尔曼滤波估计隐藏的出现率状态，推荐后验状态最低的号码。',
    function (ctx) { return L.best(ctx, function (n) { return -kalman(ctx, n, 40); }, 'cold'); });

  add('front', '统计模型', 'CUSUM 变点',
    '对每个号码做 CUSUM 累积和，找出近期正向偏差的峰值；推荐峰值最小（近期最持续缺席）的号码。',
    function (ctx) { return L.best(ctx, function (n) { return -cusum(ctx, n, 40); }, 'cold'); });

  add('front', '统计模型', 'Hurst 指数',
    '用 R/S 法计算近40期出现序列的 Hurst 指数，推荐指数最低（反持续性最强、最接近均值回归）的号码。',
    function (ctx) { return L.best(ctx, function (n) { return -hurst(ctx, n, 40); }, 'cold'); });

  add('front', '统计模型', 'KM 等待中位',
    '用生存分析思路取每个号码历史间隔的中位数，推荐“当前遗漏 / 中位间隔”比值最大的号码。',
    function (ctx) {
      return L.best(ctx, function (n) { return L.omission(ctx, n) / medianGap(ctx, n); }, 'cold');
    });

  add('front', '统计模型', '互信息',
    '计算“上期是否出现某号”与“下期该号是否出现”的互信息，推荐与上期号码关联最强的号码。',
    function (ctx) { return L.best(ctx, function (n) { return mutualInfo(ctx, n, ctx.last, 120); }, 'recent'); });

  add('front', '统计模型', '马尔可夫平稳',
    '先估计每个号码的一阶转移概率，再求其马尔可夫链的平稳分布，推荐稳态出现概率最低的号码。',
    function (ctx) { return L.best(ctx, function (n) { return stationary(ctx, n); }, 'cold'); });

  add('front', '统计模型', 'Bootstrap 命中率',
    '用固定种子对近40期出现序列做 60 次重采样，估计每个号码命中率的稳定性，推荐重采样命中率最低者。',
    function (ctx) { return L.best(ctx, function (n) { return bootstrapRate(ctx, n, 40, 60); }, 'cold'); });

  add('front', '统计模型', '泊松对数趋势',
    '把出现次数取对数后对期数做线性回归，得到泊松对数线性趋势，推荐斜率最负（衰退最快）的号码。',
    function (ctx) { return L.best(ctx, function (n) { return poissonTrend(ctx, n, 50); }, 'cold'); });

  add('front', '统计模型', '谱密度共振',
    '对近40期出现序列做周期 7 的 DFT，计算该频率上的功率，推荐周期性最强（共振最明显）的号码。',
    function (ctx) { return L.best(ctx, function (n) { return spectralPower(ctx, n, 40, 7); }, 'recent'); });

  add('front', '统计模型', '前后半分位差',
    '把近40期切成前后两半分别算出现率，用后半减前半，推荐差值为负且最小（近期明显降温）的号码。',
    function (ctx) { return L.best(ctx, function (n) { return driftDiff(ctx, n, 40); }, 'cold'); });

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

  /* ---------- 后区反思维与新增统计公式 ---------- */

  add('back', '反思维', '反吉利尾',
    '避开尾数 6/8/9 等大众偏爱尾数，在其余尾数中推荐遗漏最久的号码。',
    function (ctx) {
      var pool = ctx.cands.filter(function (n) { return [6, 8, 9].indexOf(n % 10) === -1; });
      return L.bestOf(ctx, pool, function (n) { return L.omission(ctx, n); }, 'freq10');
    });

  add('back', '反思维', '反上期重号',
    '避开上期开出的号码，在未开号码中推荐遗漏最久者。',
    function (ctx) {
      var pool = ctx.cands.filter(function (n) { return ctx.last.indexOf(n) === -1; });
      return L.bestOf(ctx, pool.length ? pool : ctx.cands, function (n) { return L.omission(ctx, n); }, 'freq10');
    });

  add('back', '反思维', '反上期邻号',
    '避开上期号码及其 ±1 邻号，推荐距离上期至少 2 位、且遗漏最久的号码。',
    function (ctx) {
      var pool = ctx.cands.filter(function (n) {
        return !ctx.last.some(function (x) { return Math.abs(n - x) <= 1; });
      });
      return L.bestOf(ctx, pool.length ? pool : ctx.cands, function (n) { return L.omission(ctx, n); }, 'freq10');
    });

  add('back', '反思维', '反同尾',
    '避开上期出现过的尾数，在其他尾数中推荐遗漏最久者。',
    function (ctx) {
      var tails = ctx.last.map(function (n) { return n % 10; });
      var pool = ctx.cands.filter(function (n) { return tails.indexOf(n % 10) === -1; });
      return L.bestOf(ctx, pool.length ? pool : ctx.cands, function (n) { return L.omission(ctx, n); }, 'freq10');
    });

  add('back', '反思维', '反对称号',
    '避开上期号码的镜像位（区间首尾对称），推荐非对称位置上遗漏最久的号码。',
    function (ctx) {
      var mirrors = ctx.last.map(function (n) { return ctx.min + ctx.max - n; });
      var pool = ctx.cands.filter(function (n) { return mirrors.indexOf(n) === -1; });
      return L.bestOf(ctx, pool.length ? pool : ctx.cands, function (n) { return L.omission(ctx, n); }, 'freq10');
    });

  add('back', '反思维', '反奇偶',
    '若上期奇数偏多则推荐被冷落的偶数，反之推荐奇数，优先遗漏更久者。',
    function (ctx) {
      var odd = ctx.last.filter(function (n) { return n % 2 === 1; }).length;
      var wantOdd = odd <= Math.floor(ctx.pick / 2);
      var pool = ctx.cands.filter(function (n) { return (n % 2 === 1) === wantOdd; });
      return L.bestOf(ctx, pool, function (n) { return L.omission(ctx, n); }, 'freq10');
    });

  add('back', '反思维', '反大小',
    '若上期大号偏多则推荐被冷落的小号，反之推荐大号，优先遗漏更久者。',
    function (ctx) {
      var mid = (ctx.min + ctx.max) / 2;
      var big = ctx.last.filter(function (n) { return n > mid; }).length;
      var wantBig = big <= Math.floor(ctx.pick / 2);
      var pool = ctx.cands.filter(function (n) { return (n > mid) === wantBig; });
      return L.bestOf(ctx, pool, function (n) { return L.omission(ctx, n); }, 'freq10');
    });

  add('back', '反思维', '反热区',
    '统计近30期三个区的出号量，从最冷区中推荐遗漏最久的号码。',
    function (ctx) {
      var counts = [0, 0, 0];
      ctx.seqs.slice(-30).forEach(function (arr) {
        arr.forEach(function (n) { counts[L.zoneIndex(n, ctx.min, ctx.max, 3)]++; });
      });
      var minZone = 0;
      for (var z = 1; z < 3; z++) if (counts[z] < counts[minZone]) minZone = z;
      var pool = ctx.cands.filter(function (n) { return L.zoneIndex(n, ctx.min, ctx.max, 3) === minZone; });
      return L.bestOf(ctx, pool, function (n) { return L.omission(ctx, n); }, 'freq10');
    });

  add('back', '反思维', '反热尾',
    '统计近30期各尾数出现次数，从最冷尾数中推荐遗漏最久的号码。',
    function (ctx) {
      var counts = {};
      ctx.seqs.slice(-30).forEach(function (arr) {
        arr.forEach(function (n) { counts[n % 10] = (counts[n % 10] || 0) + 1; });
      });
      var minTail = 0, minCount = Infinity;
      for (var t = 0; t <= 9; t++) {
        var c = counts[t] || 0;
        if (c < minCount) { minCount = c; minTail = t; }
      }
      var pool = ctx.cands.filter(function (n) { return n % 10 === minTail; });
      return L.bestOf(ctx, pool, function (n) { return L.omission(ctx, n); }, 'freq10');
    });

  add('back', '反思维', '反温和冷',
    '在近30期出现次数处于后 50%、且遗漏 3 期以上的号码中，推荐遗漏最接近历史平均间隔的号码。',
    function (ctx) {
      var counts = ctx.cands.map(function (n) { return L.countLast(ctx, n, 30); });
      var cutoff = L.quantile(counts, 0.5);
      var pool = ctx.cands.filter(function (n) {
        return L.countLast(ctx, n, 30) <= cutoff && L.omission(ctx, n) >= 3;
      });
      return L.bestOf(ctx, pool.length ? pool : ctx.cands, function (n) {
        var g = L.gapStats(ctx, n);
        return -Math.abs(L.omission(ctx, n) - g.avg);
      }, 'cold');
    });

  add('back', '反思维', '后区避众指数',
    '对后区号码打“大众偏好分”（吉利尾、整五整十、质数、上期及邻号、投注单行首行尾），在偏好分最低的号码中挑遗漏最久者。',
    function (ctx) { return antiPopular(ctx); });

  add('back', '反思维', '后区反忌讳数',
    '大众普遍回避 4 尾以及 13、14、24 这类“不吉利”号码；在后区被嫌弃的号码里挑遗漏最久的一个。',
    function (ctx) {
      var pool = ctx.cands.filter(function (n) {
        return n % 10 === 4 || n === 13 || n === 14 || n === 24;
      });
      return L.bestOf(ctx, pool.length ? pool : ctx.cands, function (n) { return L.omission(ctx, n); }, 'freq10');
    });

  add('back', '反思维', '后区反整五整十',
    '排除 5 和 10 这类大众爱挑的整数号，在后区其余号码中推荐遗漏最久者。',
    function (ctx) {
      var pool = ctx.cands.filter(function (n) { return n % 5 !== 0; });
      return L.bestOf(ctx, pool.length ? pool : ctx.cands, function (n) { return L.omission(ctx, n); }, 'freq10');
    });

  add('back', '反思维', '后区反均衡形态',
    '统计后区全部历史的奇偶出号总量，从偏少的一侧挑遗漏最久的号码，让形态主动偏离大众习惯的均衡样式。',
    function (ctx) {
      var odd = 0, even = 0;
      ctx.seqs.forEach(function (arr) {
        arr.forEach(function (n) { if (n % 2 === 1) odd++; else even++; });
      });
      var wantOdd = odd <= even;
      var pool = ctx.cands.filter(function (n) { return (n % 2 === 1) === wantOdd; });
      return L.bestOf(ctx, pool.length ? pool : ctx.cands, function (n) { return L.omission(ctx, n); }, 'freq10');
    });

  add('back', '反思维', '后区反连号簇',
    '避开近 3 期任意后区号码的 ±1 邻域——那是跟号族扎堆的连号簇，在真空区里推荐遗漏最久者。',
    function (ctx) {
      var near = [];
      ctx.seqs.slice(-3).forEach(function (arr) {
        arr.forEach(function (x) { near.push(x - 1, x + 1, x); });
      });
      var pool = ctx.cands.filter(function (n) { return near.indexOf(n) === -1; });
      return L.bestOf(ctx, pool.length ? pool : ctx.cands, function (n) { return L.omission(ctx, n); }, 'freq10');
    });

  add('back', '反思维', '后区反跨期热圈',
    '避开近 5 期开出过的后区号码，在更早出现、已被大众遗忘的冷号里推荐遗漏最久者。',
    function (ctx) {
      var recent = [];
      ctx.seqs.slice(-5).forEach(function (arr) { recent = recent.concat(arr); });
      var pool = ctx.cands.filter(function (n) { return recent.indexOf(n) === -1; });
      return L.bestOf(ctx, pool.length ? pool : ctx.cands, function (n) { return L.omission(ctx, n); }, 'freq10');
    });

  add('back', '反思维', '后区反质数偏好',
    '质数是手选票里的高频偏好；跳过全部质数，在后区合数中推荐遗漏最久者。',
    function (ctx) {
      var pool = ctx.cands.filter(function (n) { return !L.isPrime(n); });
      return L.bestOf(ctx, pool.length ? pool : ctx.cands, function (n) { return L.omission(ctx, n); }, 'freq10');
    });

  add('back', '反思维', '后区反小号扎堆',
    '大众偏爱小号区，排除后区最小的三分之一，在其余号码中推荐遗漏最久者。',
    function (ctx) {
      var cut = ctx.min + Math.floor((ctx.max - ctx.min + 1) / 3);
      var pool = ctx.cands.filter(function (n) { return n > cut; });
      return L.bestOf(ctx, pool.length ? pool : ctx.cands, function (n) { return L.omission(ctx, n); }, 'freq10');
    });

  add('back', '反思维', '后区反惧连号',
    '手选票常刻意回避相邻号；主动在上期后区号码的 ±1 位置里挑遗漏最久的一个，抢大众躲开的连号位。',
    function (ctx) {
      var pool = [];
      ctx.last.forEach(function (x) { pool.push(x - 1, x + 1); });
      return L.bestOf(ctx, pool, function (n) { return L.omission(ctx, n); }, 'freq10');
    });

  add('back', '反思维', '后区反尾数全异',
    '大众喜欢让后区两个号尾数不同；从近10期出现过的尾数里挑遗漏最久的后区号码，主动留重复尾。',
    function (ctx) {
      var tails = {};
      ctx.seqs.slice(-10).forEach(function (arr) {
        arr.forEach(function (n) { tails[n % 10] = 1; });
      });
      var pool = ctx.cands.filter(function (n) { return tails[n % 10]; });
      return L.bestOf(ctx, pool.length ? pool : ctx.cands, function (n) { return L.omission(ctx, n); }, 'freq10');
    });

  add('back', '反思维', '后区反三区均分',
    '大众习惯在后区各段均匀分布；统计近30期三段出号量，从最多的一段推荐遗漏最久的号码，让分布主动偏斜。',
    function (ctx) {
      var counts = [0, 0, 0];
      ctx.seqs.slice(-30).forEach(function (arr) {
        arr.forEach(function (n) { counts[L.zoneIndex(n, ctx.min, ctx.max, 3)]++; });
      });
      var maxZ = 0;
      for (var z = 1; z < 3; z++) if (counts[z] > counts[maxZ]) maxZ = z;
      var pool = ctx.cands.filter(function (n) { return L.zoneIndex(n, ctx.min, ctx.max, 3) === maxZ; });
      return L.bestOf(ctx, pool.length ? pool : ctx.cands, function (n) { return L.omission(ctx, n); }, 'freq10');
    });

  add('back', '反思维', '后区反忌大号',
    '手选票很少选后区最大的几个号；在区间最后 10% 的号码里推荐遗漏最久者，专捡大众不敢选的号。',
    function (ctx) {
      var cut = ctx.max - Math.max(1, Math.round((ctx.max - ctx.min + 1) * 0.1));
      var pool = ctx.cands.filter(function (n) { return n > cut; });
      return L.bestOf(ctx, pool.length ? pool : ctx.cands, function (n) { return L.omission(ctx, n); }, 'freq10');
    });

  add('back', '反思维', '后区反补冷直觉',
    '大众看到后区某号久未出现就想“该补了”；这条公式反过来只从近 3 期刚开出的后区号码里挑遗漏最短者。',
    function (ctx) {
      var pool = [];
      ctx.seqs.slice(-3).forEach(function (arr) { pool = pool.concat(arr); });
      return L.bestOf(ctx, pool.length ? pool : ctx.cands, function (n) { return -L.omission(ctx, n); }, 'recent');
    });

  add('back', '反思维', '后区反回补直觉',
    '大众总想“上期奇数多、这期该补偶数”，被补的一侧反而挤满票；从上期偏多的一侧继续选遗漏最久的后区号码。',
    function (ctx) {
      var odd = ctx.last.filter(function (n) { return n % 2 === 1; }).length;
      var wantOdd = odd > Math.floor(ctx.pick / 2);
      var pool = ctx.cands.filter(function (n) { return (n % 2 === 1) === wantOdd; });
      return L.bestOf(ctx, pool.length ? pool : ctx.cands, function (n) { return L.omission(ctx, n); }, 'freq10');
    });

  add('back', '统计模型', '泊松低温',
    '以近30期理论出现次数为均值，推荐泊松 Z 值偏低最明显的号码。',
    function (ctx) {
      var w = 30, exp = w * ctx.pick / ctx.cands.length;
      return L.best(ctx, function (n) { return -L.poissonZ(L.countLast(ctx, n, w), exp); }, 'cold');
    });

  add('back', '统计模型', '遗漏 Z-Score',
    '用当前遗漏减去历史平均间隔并除以间隔标准差，推荐标准化后最超期的号码。',
    function (ctx) {
      return L.best(ctx, function (n) {
        var g = L.gapStats(ctx, n);
        return (L.omission(ctx, n) - g.avg) / g.std;
      }, 'cold');
    });

  add('back', '统计模型', '共现提升度',
    '统计上期号码到下期候选号的条件概率，除以基础概率，推荐提升度最高者。',
    function (ctx) {
      return L.best(ctx, function (n) { return L.cooccurLift(ctx, n, ctx.last, 120); }, 'recent');
    });

  add('back', '统计模型', '相似期匹配',
    '寻找历史上和值、跨度、奇偶数最接近上期的 12 期，统计下一期号码，推荐出现最多者。',
    function (ctx) {
      var scores = L.similarScores(ctx, 120, 12);
      return L.best(ctx, function (n) { return scores[n] || 0; }, 'recent');
    });

  add('back', '统计模型', 'AR(1) 自回归',
    '对近50期出现序列拟合 AR(1)，推荐下一期预测值最高的号码。',
    function (ctx) {
      return L.best(ctx, function (n) { return L.ar1(ctx, n, 50); }, 'recent');
    });

  add('back', '统计模型', 'Holt 趋势',
    '对近50期出现序列做 Holt 水平+趋势平滑，推荐下一期预测值最高的号码。',
    function (ctx) {
      return L.best(ctx, function (n) { return L.holt(ctx, n, 50, 0.3, 0.1); }, 'recent');
    });

  add('back', '统计模型', '正弦周期',
    '对近50期出现序列拟合周期为 10 的正弦分量，推荐下一期周期相位最高的号码。',
    function (ctx) {
      return L.best(ctx, function (n) { return L.sinFit(ctx, n, 50, 10); }, 'recent');
    });

  add('back', '统计模型', '分位数上沿',
    '取近10期全部号码的 75% 分位数，推荐最接近该分位且上期未出的号码。',
    function (ctx) {
      var flat = [];
      ctx.draws.slice(-10).forEach(function (d) { flat = flat.concat(d[ctx.zone]); });
      return nearestOf(ctx, ctx.cands, L.quantile(flat, 0.75), true);
    });

  add('back', '统计模型', '后区二项 Z',
    '把每个后区号码近30期的出现次数看成二项分布，推荐实际次数低于理论期望最明显的号码。',
    function (ctx) { return L.best(ctx, function (n) { return -binomZ(ctx, n, 30); }, 'cold'); });

  add('back', '统计模型', '后区游程检验',
    '对每个后区号码近40期的出现序列做游程检验，推荐游程 Z 值最低、连续空缺最长的号码。',
    function (ctx) { return L.best(ctx, function (n) { return runsZ(ctx, n, 40); }, 'cold'); });

  add('back', '统计模型', '后区几何等待分位',
    '按几何分布计算当前遗漏的累积概率，推荐最接近“该出现了”的后区号码。',
    function (ctx) { return L.best(ctx, function (n) { return geomCdf(ctx, n); }, 'cold'); });

  add('back', '统计模型', '后区核密度低谷',
    '把近20期后区号码看成高斯核密度，推荐核密度最低、位置最空的那个号码。',
    function (ctx) { return L.best(ctx, function (n) { return -kdeDensity(ctx, n, 20, 1.5); }, 'cold'); });

  add('back', '统计模型', '后区威布尔风险率',
    '以历史平均间隔为尺度构造威布尔风险率，推荐超期程度最高的后区号码。',
    function (ctx) { return L.best(ctx, function (n) { return weibullHazard(ctx, n, 1.2); }, 'cold'); });

  add('back', '统计模型', '后区长短期似然比',
    '比较近10期与近100期出现率，推荐短期降温最明显的后区号码，等待均值回归。',
    function (ctx) { return L.best(ctx, function (n) { return likelihoodRatio(ctx, n); }, 'cold'); });

  add('back', '统计模型', '后区经验贝叶斯',
    '用后区全体平均出现率做先验，把每个号码近30期频率向先验收缩，推荐收缩后概率最低的号码。',
    function (ctx) { return L.best(ctx, function (n) { return -shrinkRate(ctx, n, 30, 12); }, 'cold'); });

  add('back', '统计模型', '后区卡尔曼滤波',
    '把每期“出现/未出”当带噪观测，用一维卡尔曼滤波估计后区每个号码的隐藏出现率，推荐状态最低者。',
    function (ctx) { return L.best(ctx, function (n) { return -kalman(ctx, n, 40); }, 'cold'); });

  add('back', '统计模型', '后区 CUSUM 变点',
    '对每个后区号码做 CUSUM 累积和，推荐近期正向偏差峰值最小（持续缺席最久）的号码。',
    function (ctx) { return L.best(ctx, function (n) { return -cusum(ctx, n, 40); }, 'cold'); });

  add('back', '统计模型', '后区 Hurst 指数',
    '用 R/S 法计算后区近40期出现序列的 Hurst 指数，推荐指数最低（反持续性最强）的号码。',
    function (ctx) { return L.best(ctx, function (n) { return -hurst(ctx, n, 40); }, 'cold'); });

  add('back', '统计模型', '后区互信息',
    '计算“上期是否出现某号”与“下期该号是否出现”的互信息，推荐与上期后区关联最强的号码。',
    function (ctx) { return L.best(ctx, function (n) { return mutualInfo(ctx, n, ctx.last, 120); }, 'recent'); });

  add('back', '统计模型', '后区前后半分位差',
    '把近40期切成前后两半分别算出现率，推荐后半减前半差值最小（近期降温）的后区号码。',
    function (ctx) { return L.best(ctx, function (n) { return driftDiff(ctx, n, 40); }, 'cold'); });

  /* 3D / 排列五：0–9 单位数字公式，从后区公式派生，去掉无意义的跨度/跨区公式 */
  var DIGIT_SKIP = ['后区跨度均值', '前区和值映射', '前区跨度映射'];
  var digit = formulas
    .filter(function (f) { return f.zone === 'back' && DIGIT_SKIP.indexOf(f.name) === -1; })
    .map(function (f, i) {
      return {
        id: 'D' + String(i + 1).padStart(3, '0'),
        zone: 'digit',
        cat: f.cat,
        name: f.name.replace(/^后区/, '位置').replace(/后区/g, '位置'),
        desc: f.desc.replace(/后区/g, '该位置').replace(/蓝球/g, '数字'),
        run: f.run
      };
    });
  digit.forEach(function (f) { formulas.push(f); });

  var byZone = { front: [], back: [], digit: [] };
  formulas.forEach(function (f) { byZone[f.zone].push(f); });

  var API = {
    all: formulas,
    front: byZone.front,
    back: byZone.back,
    digit: byZone.digit,
    stats: {
      total: byZone.front.length + byZone.back.length,
      front: byZone.front.length,
      back: byZone.back.length,
      digit: byZone.digit.length,
      allTotal: formulas.length,
      categories: formulas.reduce(function (acc, f) {
        acc[f.cat] = (acc[f.cat] || 0) + 1;
        return acc;
      }, {})
    }
  };

  root.LotteryFormulas = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof globalThis !== 'undefined' ? globalThis : this);
