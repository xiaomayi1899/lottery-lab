/* 数彩实验室 · 核心引擎（可在浏览器与 Node 中运行） */
(function (root) {
  'use strict';

  var GAMES = {
    ssq: {
      key: 'ssq',
      name: '双色球',
      en: 'SSQ',
      price: 2,
      schedule: '每周二、四、日 21:15 开奖',
      ticketZones: ['front', 'back'],
      front: { min: 1, max: 33, pick: 6, label: '红球', short: '红', color: 'red' },
      back: { min: 1, max: 16, pick: 1, label: '蓝球', short: '蓝', color: 'blue' }
    },
    dlt: {
      key: 'dlt',
      name: '大乐透',
      en: 'DLT',
      price: 3,
      schedule: '每周一、三、六 21:25 开奖',
      ticketZones: ['front', 'back'],
      front: { min: 1, max: 35, pick: 5, label: '前区', short: '前', color: 'red' },
      back: { min: 1, max: 12, pick: 2, label: '后区', short: '后', color: 'blue' }
    },
    fc3d: {
      key: 'fc3d',
      name: '福彩3D',
      en: '3D',
      price: 2,
      schedule: '每日 21:15 开奖',
      ticketZones: ['hundreds', 'tens', 'units'],
      hundreds: { min: 0, max: 9, pick: 1, label: '百位', short: '百', color: 'gold' },
      tens: { min: 0, max: 9, pick: 1, label: '十位', short: '十', color: 'gold' },
      units: { min: 0, max: 9, pick: 1, label: '个位', short: '个', color: 'gold' }
    },
    kl8: {
      key: 'kl8',
      name: '快乐8',
      en: 'KL8',
      price: 2,
      schedule: '每日 21:30 开奖',
      ticketZones: ['main'],
      main: { min: 1, max: 80, pick: 10, drawPick: 20, label: '号码', short: '号', color: 'red' }
    },
    pl5: {
      key: 'pl5',
      name: '排列五',
      en: 'PL5',
      price: 2,
      schedule: '每日 21:25 开奖',
      ticketZones: ['pos1', 'pos2', 'pos3', 'pos4', 'pos5'],
      pos1: { min: 0, max: 9, pick: 1, label: '万位', short: '万', color: 'gold' },
      pos2: { min: 0, max: 9, pick: 1, label: '千位', short: '千', color: 'gold' },
      pos3: { min: 0, max: 9, pick: 1, label: '百位', short: '百', color: 'gold' },
      pos4: { min: 0, max: 9, pick: 1, label: '十位', short: '十', color: 'gold' },
      pos5: { min: 0, max: 9, pick: 1, label: '个位', short: '个', color: 'gold' }
    }
  };

  var L = {};
  var EPS = 1e-9;

  L.range = function (min, max) {
    var out = [];
    for (var n = min; n <= max; n++) out.push(n);
    return out;
  };
  L.sum = function (a) {
    var s = 0;
    for (var i = 0; i < a.length; i++) s += a[i];
    return s;
  };
  L.mean = function (a) {
    return a.length ? L.sum(a) / a.length : 0;
  };
  L.median = function (a) {
    if (!a.length) return 0;
    var b = a.slice().sort(function (x, y) { return x - y; });
    var m = b.length >> 1;
    return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2;
  };
  L.std = function (a) {
    if (a.length < 2) return 0;
    var m = L.mean(a), s = 0;
    for (var i = 0; i < a.length; i++) s += Math.pow(a[i] - m, 2);
    return Math.sqrt(s / (a.length - 1));
  };
  L.span = function (a) {
    return a.length ? Math.max.apply(null, a) - Math.min.apply(null, a) : 0;
  };
  L.tail = function (n) { return n % 10; };
  L.isPrime = function (n) {
    if (n < 2) return false;
    if (n % 2 === 0) return n === 2;
    for (var i = 3; i * i <= n; i += 2) if (n % i === 0) return false;
    return true;
  };
  /* AC 值：所有两两差值中不同值的个数减去 (球数 - 1) */
  L.ac = function (a) {
    var seen = {};
    for (var i = 0; i < a.length; i++)
      for (var j = i + 1; j < a.length; j++) seen[Math.abs(a[i] - a[j])] = 1;
    return Math.max(0, Object.keys(seen).length - (a.length - 1));
  };
  L.zoneIndex = function (n, min, max, parts) {
    parts = parts || 3;
    var size = (max - min + 1) / parts;
    return Math.min(parts - 1, Math.max(0, Math.floor((n - min) / size)));
  };
  L.mod3 = function (n) { return n % 3; };
  L.clamp = function (n, min, max) { return Math.min(max, Math.max(min, n)); };
  L.wrap = function (n, min, max) {
    var size = max - min + 1;
    return ((Math.round(n) - min) % size + size) % size + min;
  };
  L.uniq = function (a) {
    var seen = {}, out = [];
    for (var i = 0; i < a.length; i++) if (!seen[a[i]]) { seen[a[i]] = 1; out.push(a[i]); }
    return out;
  };
  L.hash = function (str) {
    var h = 2166136261;
    str = String(str);
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  };
  L.rand = function (seed) {
    var x = (seed >>> 0) || 0x9e3779b9;
    x ^= x << 13; x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5; x >>>= 0;
    return x / 4294967296;
  };

  L.countLast = function (ctx, n, w) {
    var seqs = w >= ctx.seqs.length ? ctx.seqs : ctx.seqs.slice(-w);
    var c = 0;
    for (var i = 0; i < seqs.length; i++) if (seqs[i].indexOf(n) !== -1) c++;
    return c;
  };
  L.totalCount = function (ctx, n) { return L.countLast(ctx, n, Infinity); };
  L.lastSeenIndex = function (ctx, n) {
    for (var i = ctx.seqs.length - 1; i >= 0; i--) if (ctx.seqs[i].indexOf(n) !== -1) return i;
    return -1;
  };
  L.omission = function (ctx, n) {
    var i = L.lastSeenIndex(ctx, n);
    return i < 0 ? ctx.n : ctx.n - 1 - i;
  };
  L.avgGap = function (ctx, n) {
    var idx = [];
    for (var i = 0; i < ctx.seqs.length; i++) if (ctx.seqs[i].indexOf(n) !== -1) idx.push(i);
    if (idx.length < 2) return ctx.n;
    var gaps = 0;
    for (var j = 1; j < idx.length; j++) gaps += idx[j] - idx[j - 1];
    return gaps / (idx.length - 1);
  };
  L.repeatScore = function (ctx, n) {
    var c = 0;
    for (var i = 0; i < ctx.seqs.length - 1; i++)
      if (ctx.seqs[i].indexOf(n) !== -1 && ctx.seqs[i + 1].indexOf(n) !== -1) c++;
    return c;
  };
  L.trendSlope = function (ctx, n, w) {
    var seqs = ctx.seqs.slice(-w), m = seqs.length;
    if (m < 2) return 0;
    var sx = 0, sy = 0, sxy = 0, sxx = 0;
    for (var i = 0; i < m; i++) {
      var y = seqs[i].indexOf(n) !== -1 ? 1 : 0;
      sx += i; sy += y; sxy += i * y; sxx += i * i;
    }
    var den = m * sxx - sx * sx;
    return den ? (m * sxy - sx * sy) / den : 0;
  };
  L.autocorr = function (ctx, n, w) {
    var seqs = ctx.seqs.slice(-w), m = seqs.length;
    if (m < 4) return 0;
    var xs = [], mean = 0, i;
    for (i = 0; i < m; i++) { xs.push(seqs[i].indexOf(n) !== -1 ? 1 : 0); mean += xs[i]; }
    mean /= m;
    var num = 0, den = 0;
    for (i = 0; i < m; i++) den += Math.pow(xs[i] - mean, 2);
    for (i = 1; i < m; i++) num += (xs[i] - mean) * (xs[i - 1] - mean);
    return den ? num / den : 0;
  };
  /* 条件转移：按号码在最近 order 期的出现状态分组，估计下一期出现概率（拉普拉斯平滑） */
  L.transition = function (ctx, n, order) {
    order = order || 1;
    var a = 0, b = 0, c = 0, d = 0, t, k;
    var refs = [ctx.last, ctx.prev];
    for (t = order; t < ctx.seqs.length - 1; t++) {
      var match = true;
      for (k = 0; k < order; k++) {
        var seq = ctx.seqs[t - k];
        var ref = refs[k];
        if (!seq || !ref) { match = false; break; }
        if ((seq.indexOf(n) !== -1) !== (ref.indexOf(n) !== -1)) { match = false; break; }
      }
      var next = ctx.seqs[t + 1].indexOf(n) !== -1;
      if (match) { if (next) a++; else b++; }
      else { if (next) c++; else d++; }
    }
    var inState = ctx.last.indexOf(n) !== -1;
    return inState ? (a + 1) / (a + b + 2) : (c + 1) / (c + d + 2);
  };

  function tieBreak(ctx, mode, n, best) {
    if (mode === 'recent') return L.lastSeenIndex(ctx, n) > L.lastSeenIndex(ctx, best);
    if (mode === 'cold') return L.omission(ctx, n) > L.omission(ctx, best);
    if (mode === 'small') return n < best;
    if (mode === 'large') return n > best;
    if (mode === 'freq10') return L.countLast(ctx, n, 10) > L.countLast(ctx, best, 10);
    return false;
  }

  L.best = function (ctx, score, tie) {
    var list = ctx.cands, bn = list[0], bs = Number(score(bn));
    if (!isFinite(bs)) bs = -Infinity;
    for (var i = 1; i < list.length; i++) {
      var n = list[i], s = Number(score(n));
      if (!isFinite(s)) s = -Infinity;
      if (s > bs + EPS) { bn = n; bs = s; }
      else if (Math.abs(s - bs) <= EPS && tieBreak(ctx, tie, n, bn)) bn = n;
    }
    return bn;
  };
  L.worst = function (ctx, score, tie) {
    return L.best(ctx, function (n) { return -Number(score(n)); }, tie);
  };
  L.bestOf = function (ctx, list, score, tie) {
    var uniq = L.uniq(list.filter(function (n) { return n >= ctx.min && n <= ctx.max; }));
    if (!uniq.length) return ctx.min;
    var view = { cands: uniq, seqs: ctx.seqs, n: ctx.n, last: ctx.last, min: ctx.min, max: ctx.max };
    return L.best(view, score, tie);
  };
  L.worstOf = function (ctx, list, score, tie) {
    return L.bestOf(ctx, list, function (n) { return -Number(score(n)); }, tie);
  };

  function makeCtx(draws, cfg, zone) {
    var seqs = [], i;
    for (i = 0; i < draws.length; i++) seqs.push(draws[i][zone]);
    return {
      draws: draws,
      seqs: seqs,
      zone: zone,
      cfg: cfg,
      min: cfg.min,
      max: cfg.max,
      pick: cfg.pick,
      cands: L.range(cfg.min, cfg.max),
      last: seqs.length ? seqs[seqs.length - 1] : [],
      prev: seqs.length > 1 ? seqs[seqs.length - 2] : [],
      n: seqs.length,
      lib: L
    };
  }

  function safeRun(formula, ctx) {
    try {
      var n = Math.round(formula.run(ctx));
      if (!isFinite(n)) return ctx.min;
      return L.clamp(n, ctx.min, ctx.max);
    } catch (err) {
      return ctx.min;
    }
  }

  /* 对每个公式做滚动回测：在未知当期的情况下给出一个号，看是否命中开奖号码集合 */
  function backtestContexts(draws, cfg, zone, window) {
    var start = Math.max(8, draws.length - (window || 40));
    var out = [];
    for (var t = start; t < draws.length; t++) out.push(makeCtx(draws.slice(0, t), cfg, zone));
    return out;
  }

  function repeatPolicy(cfg) {
    if (cfg.pick >= 8) return { penalty: 0.8, max: Math.max(2, Math.round(cfg.pick * 0.4)) };
    if (cfg.pick >= 6) return { penalty: 0.7, max: 2 };
    if (cfg.pick >= 2) return { penalty: 0.6, max: 1 };
    return { penalty: 1, max: 1 };
  }

  function assemble(game, zoneKey, cfg, details, meta) {
    var ctx = makeCtx(game.draws, cfg, zoneKey);
    var lastDraw = game.draws[game.draws.length - 1] || {};
    var lastNumbers = lastDraw[zoneKey] || [];
    var repeat = repeatPolicy(cfg);
    var totalWeight = 0;
    var byNumber = {};
    ctx.cands.forEach(function (n) { byNumber[n] = { n: n, votes: [], weight: 0 }; });

    details.forEach(function (d) {
      if (meta.penalty) {
        if (meta.penalty.numbers.indexOf(d.rec) !== -1) {
          d.weight *= meta.penalty.factor;
        }
        if (meta.penalty.avoid && meta.penalty.avoid.indexOf(d.rec) !== -1) {
          d.weight *= meta.penalty.avoidFactor;
        }
      }
      totalWeight += d.weight;
      var bucket = byNumber[d.rec];
      if (!bucket) return;
      bucket.votes.push(d);
      bucket.weight += d.weight;
      d.score = bucket.weight;
    });

    var ranking = ctx.cands.map(function (n) {
      var b = byNumber[n];
      var hitWeighted = 0;
      b.votes.forEach(function (d) { hitWeighted += d.rate * d.weight; });
      var rawWeight = b.weight;
      var adjusted = lastNumbers.indexOf(n) !== -1 ? rawWeight * repeat.penalty : rawWeight;
      return {
        n: n,
        votes: b.votes.length,
        weight: adjusted,
        rawWeight: rawWeight,
        hitRate: b.weight ? hitWeighted / b.weight : 0,
        contributors: b.votes.slice().sort(function (a, c) { return c.weight - a.weight; }),
        omission: L.omission(ctx, n),
        freq10: L.countLast(ctx, n, 10),
        repeat: lastNumbers.indexOf(n) !== -1
      };
    }).sort(function (a, b) {
      return (b.weight - a.weight) || (b.votes - a.votes) || (b.freq10 - a.freq10) || (a.n - b.n);
    });

    var weightOf = {};
    ranking.forEach(function (r) { weightOf[r.n] = r.weight; });
    var avoidNumbers = (meta.penalty && meta.penalty.avoid) ? meta.penalty.avoid : [];
    var chosen = ranking.slice(0, cfg.pick).map(function (r) { return r.n; }).sort(function (a, b) { return a - b; });

    /* 备选票：若仍撞上要避开的号码，强制用排名最高的未避开号码替换 */
    if (avoidNumbers.length) {
      var selected = chosen.slice();
      var guard = 0;
      while (selected.some(function (n) { return avoidNumbers.indexOf(n) !== -1; }) && guard++ < cfg.pick) {
        var dropPool = selected.filter(function (n) { return avoidNumbers.indexOf(n) !== -1; });
        if (!dropPool.length) dropPool = selected.slice();
        dropPool.sort(function (a, b) { return weightOf[a] - weightOf[b]; });
        var drop = dropPool[0];
        var add = null;
        for (var ri = 0; ri < ranking.length; ri++) {
          var cand = ranking[ri].n;
          if (selected.indexOf(cand) === -1 && avoidNumbers.indexOf(cand) === -1) { add = cand; break; }
        }
        if (add === null) break;
        selected = selected.filter(function (n) { return n !== drop; }).concat(add);
      }
      chosen = selected.sort(function (a, b) { return a - b; });
    }

    /* 重号抑制：限制与上期开奖号码的最大重复个数，避免推荐过度依赖刚开出的号码 */
    var repeatCount = chosen.filter(function (n) { return lastNumbers.indexOf(n) !== -1; }).length;
    if (repeatCount > repeat.max) {
      var selectedRepeat = chosen.slice();
      var repeatGuard = 0;
      while (repeatCount > repeat.max && repeatGuard++ < cfg.pick) {
        var repeatPool = selectedRepeat.filter(function (n) { return lastNumbers.indexOf(n) !== -1; });
        repeatPool.sort(function (a, b) { return weightOf[a] - weightOf[b]; });
        var dropRepeat = repeatPool[0];
        var addRepeat = null;
        for (var rj = 0; rj < ranking.length; rj++) {
          var candRepeat = ranking[rj].n;
          if (
            selectedRepeat.indexOf(candRepeat) === -1 &&
            lastNumbers.indexOf(candRepeat) === -1 &&
            avoidNumbers.indexOf(candRepeat) === -1
          ) { addRepeat = candRepeat; break; }
        }
        if (addRepeat === null) break;
        selectedRepeat = selectedRepeat.filter(function (n) { return n !== dropRepeat; }).concat(addRepeat);
        repeatCount = selectedRepeat.filter(function (n) { return lastNumbers.indexOf(n) !== -1; }).length;
      }
      chosen = selectedRepeat.sort(function (a, b) { return a - b; });
    }

    return {
      game: game.key,
      zone: zoneKey,
      cfg: cfg,
      numbers: chosen,
      ranking: ranking,
      details: details,
      summary: describe(chosen, cfg),
      stats: {
        formulaCount: details.length,
        totalWeight: totalWeight,
        avgRate: totalWeight ? details.reduce(function (s, d) { return s + d.rate * d.weight; }, 0) / totalWeight : 0,
        backtestWindow: meta.window,
        salt: meta.salt || 0,
        maxVotes: ranking.length ? ranking[0].votes : 0,
        maxWeight: ranking.length ? ranking[0].weight : 0,
        repeatLimit: repeat.max,
        repeatPenalty: repeat.penalty,
        repeatCount: chosen.filter(function (n) { return lastNumbers.indexOf(n) !== -1; }).length
      }
    };
  }

  /**
   * 核心：每个公式推荐一个号码 -> 按回测命中率加权投票 -> 取票数最高的 N 个号码
   */
  function analyze(game, zoneKey, formulas, opts) {
    opts = opts || {};
    var cfg = game[zoneKey];
    var draws = game.draws;
    if (!draws || draws.length < 10) throw new Error('历史数据不足');
    var window = Math.min(opts.window || 40, Math.max(10, draws.length - 10));
    var salt = opts.salt || 0;
    var ctx = makeCtx(draws, cfg, zoneKey);
    var contexts = backtestContexts(draws, cfg, zoneKey, window);
    var details = [];
    var prior = cfg.pick / (cfg.max - cfg.min + 1);

    for (var i = 0; i < formulas.length; i++) {
      var f = formulas[i];
      var hits = 0;
      var weightedHits = 0;
      var weightedTries = 0;
      for (var j = 0; j < contexts.length; j++) {
        var t = draws.length - contexts.length + j;
        var rec = safeRun(f, contexts[j]);
        /* 越近的期数权重越高：半衰期 20 期，避免用很久以前的走势主导当前投票 */
        var recency = Math.pow(0.5, (contexts.length - 1 - j) / 20);
        weightedTries += recency;
        if (draws[t][zoneKey].indexOf(rec) !== -1) {
          hits++;
          weightedHits += recency;
        }
      }
      var rate = contexts.length ? hits / contexts.length : 0;
      /* 贝叶斯平滑：40 期样本太少，直接命中率容易过拟合；向随机命中率收缩 */
      var smoothed = (weightedHits + prior * 8) / (weightedTries + 8);
      var weight = 0.3 + smoothed * 2.2;
      if (salt) weight *= 0.78 + 0.44 * L.rand(L.hash(f.id + '|' + salt));
      details.push({
        id: f.id, name: f.name, cat: f.cat, desc: f.desc,
        rec: safeRun(f, ctx), hits: hits, tries: contexts.length, rate: rate,
        recentRate: weightedTries ? weightedHits / weightedTries : 0,
        smoothed: smoothed, weight: weight, score: 0
      });
    }

    return assemble(game, zoneKey, cfg, details, { window: contexts.length, salt: salt });
  }

  /* 用不同的盐值重新加权：不重跑回测，毫秒级生成“备选一注” */
  function reweight(game, base, salt, avoid) {
    if (!salt) return base;
    var details = base.details.map(function (d) {
      /* 同一号码的公式获得同一扰动系数，让票数真正重新分布，而不是被大数平均掉 */
      var numberFactor = 0.45 + 1.10 * L.rand(L.hash(d.rec + '|' + salt));
      return {
        id: d.id, name: d.name, cat: d.cat, desc: d.desc,
        rec: d.rec, hits: d.hits, tries: d.tries, rate: d.rate,
        smoothed: d.smoothed,
        weight: (0.3 + d.smoothed * 2.2) * numberFactor,
        score: 0
      };
    });
    return assemble(game, base.zone, game[base.zone], details, {
      window: base.stats.backtestWindow,
      salt: salt,
      /* 备选票：对主推号码整体降权，让票数自然流向次优号码，保证“换一注”真的换得动 */
      penalty: {
        numbers: base.numbers,
        factor: base.cfg.pick === 1 ? 0.16 : (base.cfg.pick === 2 ? 0.28 : 0.44),
        avoid: avoid || [],
        avoidFactor: 0.3
      }
    });
  }

  function describe(numbers, cfg) {
    var sum = L.sum(numbers), span = L.span(numbers);
    var odd = 0, prime = 0, big = 0, tails = [], zones = [0, 0, 0];
    var mid = (cfg.min + cfg.max) / 2;
    numbers.forEach(function (n) {
      if (n % 2) odd++;
      if (L.isPrime(n)) prime++;
      if (n > mid) big++;
      tails.push(n % 10);
      zones[L.zoneIndex(n, cfg.min, cfg.max, 3)]++;
    });
    return {
      sum: sum,
      span: span,
      odd: odd,
      even: numbers.length - odd,
      big: big,
      small: numbers.length - big,
      prime: prime,
      composite: numbers.length - prime,
      ac: L.ac(numbers),
      zones: zones,
      tails: tails,
      avg: numbers.length ? sum / numbers.length : 0
    };
  }

  /* 走势图：逐期维护每个号码的遗漏值，返回按时间正序的行 */
  function trend(draws, zoneKey, cfg, limit) {
    limit = limit || 30;
    var start = Math.max(0, draws.length - limit);
    var lastIdx = new Map(), rows = [];
    draws.forEach(function (d, i) {
      var set = {}, hit = {};
      d[zoneKey].forEach(function (n) { set[n] = 1; });
      L.range(cfg.min, cfg.max).forEach(function (n) {
        if (set[n]) { lastIdx.set(n, i); hit[n] = true; }
        else hit[n] = false;
      });
      if (i >= start) {
        var cells = L.range(cfg.min, cfg.max).map(function (n) {
          var li = lastIdx.has(n) ? lastIdx.get(n) : -1;
          return { n: n, hit: !!hit[n], omission: li < 0 ? i + 1 : i - li };
        });
        rows.push({ issue: d.issue, date: d.date, numbers: d[zoneKey], cells: cells });
      }
    });
    return rows;
  }

  function baseStats(draws, zoneKey, cfg, window) {
    var recent = draws.slice(-window);
    var seqs = draws.map(function (d) { return d[zoneKey]; });
    var omitCtx = { seqs: seqs, n: draws.length };
    var freq = {}, omission = {}, tails = {};
    L.range(cfg.min, cfg.max).forEach(function (n) { freq[n] = 0; });
    recent.forEach(function (d) {
      d[zoneKey].forEach(function (n) { freq[n]++; tails[n % 10] = (tails[n % 10] || 0) + 1; });
    });
    L.range(cfg.min, cfg.max).forEach(function (n) { omission[n] = L.omission(omitCtx, n); });
    return { freq: freq, omission: omission, tails: tails, window: window };
  }

  var Core = {
    GAMES: GAMES,
    Lib: L,
    makeCtx: makeCtx,
    safeRun: safeRun,
    analyze: analyze,
    reweight: reweight,
    describe: describe,
    trend: trend,
    baseStats: baseStats
  };

  root.LotteryCore = Core;
  if (typeof module !== 'undefined' && module.exports) module.exports = Core;
})(typeof globalThis !== 'undefined' ? globalThis : this);
