/* 数彩实验室 · 界面与交互 */
(function () {
  'use strict';

  var Core = window.LotteryCore;
  var F = window.LotteryFormulas;
  var Charts = window.Charts;
  if (!Core || !F) return;

  var L = Core.Lib;
  var VERSION = '1.2.1';
  var $view = document.getElementById('view');
  var $toast = document.getElementById('toast');
  var $tabbar = document.getElementById('tabbar');
  var $gameSeg = document.getElementById('game-seg');
  var $dataDate = document.getElementById('data-date');

  var storage = {
    get: function (k, d) {
      try { var v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; }
    },
    set: function (k, v) {
      try { localStorage.setItem(k, v); } catch (e) {}
    }
  };

  var state = {
    game: storage.get('sc.game', 'ssq'),
    tab: 'home',
    zone: 'front',
    voteZone: 'front',
    period: 30,
    salt: 0,
    formulaZone: 'front',
    formulaCat: '全部',
    query: '',
    historyLimit: 30,
    data: null,
    loading: true,
    error: null,
    alts: null
  };

  var cache = {};
  var chartJobs = [];
  var resizeTimer = null;
  var toastTimer = null;

  /* ---------------- 工具 ---------------- */
  function pad(n) { return String(n).padStart(2, '0'); }
  function pct(x) { return (x * 100).toFixed(1) + '%'; }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function meta(key) { return Core.GAMES[key]; }
  function zoneKeys(key) { return Core.GAMES[key].ticketZones; }
  function zoneCfg(key, zone) { return Core.GAMES[key][zone]; }
  function isDigitZone(cfg) { return cfg && cfg.min === 0 && cfg.max === 9; }
  function fmt(n, cfg) { return isDigitZone(cfg) ? String(n) : pad(n); }
  function formulasFor(key, zone) {
    if (key === 'kl8') return F.front;
    if (zone === 'front' || zone === 'back') return F[zone];
    return F.digit;
  }
  function formulaCountFor(key) {
    return zoneKeys(key).reduce(function (sum, z) {
      return sum + formulasFor(key, z).length;
    }, 0);
  }
  function gameData(key) {
    var raw = state.data[key];
    return Object.assign({}, Core.GAMES[key], { key: key, draws: raw.draws, updatedAt: state.data.updatedAt });
  }
  function lastDraw(key) {
    var draws = state.data[key].draws;
    return draws[draws.length - 1];
  }
  function normalizeZones() {
    var zs = zoneKeys(state.game);
    if (zs.indexOf(state.zone) === -1) state.zone = zs[0];
    if (zs.indexOf(state.voteZone) === -1) state.voteZone = zs[0];
    if (zs.indexOf(state.formulaZone) === -1) state.formulaZone = zs[0];
  }
  function analysis(key, zone, salt) {
    salt = salt || 0;
    var baseKey = key + '|' + zone + '|0';
    if (!cache[baseKey]) {
      cache[baseKey] = Core.analyze(gameData(key), zone, formulasFor(key, zone), { window: 40 });
    }
    if (!salt) return cache[baseKey];
    var saltedKey = key + '|' + zone + '|' + salt;
    if (!cache[saltedKey]) cache[saltedKey] = Core.reweight(gameData(key), cache[baseKey], salt);
    return cache[saltedKey];
  }
  function resultList(key, salt) {
    return zoneKeys(key).map(function (z) {
      return { zone: z, cfg: zoneCfg(key, z), res: analysis(key, z, salt) };
    });
  }
  function flatResults(results) {
    return results.map(function (r) {
      return { zone: r.zone, numbers: r.res.numbers };
    });
  }
  function ticketNumbers(draw, metaObj) {
    var out = [];
    metaObj.ticketZones.forEach(function (z) {
      (draw[z] || []).forEach(function (n) { out.push(n); });
    });
    return out;
  }
  function ticketBalls(draw, metaObj, size) {
    var html = '';
    var dividers = metaObj.key === 'ssq' || metaObj.key === 'dlt';
    metaObj.ticketZones.forEach(function (z, i) {
      var cfg = metaObj[z];
      if (i && dividers) html += '<span class="divider"></span>';
      (draw[z] || []).forEach(function (n) {
        html += ball(n, cfg.color, { size: size, digit: isDigitZone(cfg) });
      });
    });
    return html;
  }
  function weekdayCN(dateStr) {
    var d = new Date(String(dateStr).replace(/-/g, '/'));
    return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()] || '';
  }
  function ball(n, kind, opts) {
    opts = opts || {};
    return '<span class="ball ' + kind + (opts.size ? ' ' + opts.size : '') + '"' +
      (opts.style ? ' style="' + opts.style + '"' : '') + '>' +
      (opts.digit ? String(n) : pad(n)) + '</span>';
  }
  function balls(nums, kind, offset) {
    return nums.map(function (n, i) {
      return ball(n, kind, { style: '--i:' + ((offset || 0) + i) });
    }).join('');
  }
  function toast(msg) {
    $toast.textContent = msg;
    $toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { $toast.classList.remove('show'); }, 1900);
  }
  function copyText(text) {
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, text.length);
      try { document.execCommand('copy'); toast('已复制到剪贴板'); }
      catch (e) { toast('复制失败，请长按号码手动复制'); }
      document.body.removeChild(ta);
    }
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(function () { toast('已复制到剪贴板'); }, fallback);
    } else {
      fallback();
    }
  }
  function ticketText(results, key) {
    var m = meta(key);
    var lines = results.map(function (r) {
      var cfg = m[r.zone];
      return cfg.label + '：' + r.numbers.map(function (n) { return fmt(n, cfg); }).join(' ');
    });
    return m.name + ' · 数彩实验室公式投票推荐\n' + lines.join('\n') +
      '\n（' + formulaCountFor(key) + ' 个公式独立投票 · 仅供娱乐）';
  }

  /* ---------------- 启动 ---------------- */
  function boot() {
    fetch('data/history.json', { cache: 'no-store' })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        if (!data || ['ssq', 'dlt', 'fc3d', 'kl8', 'pl5'].some(function (k) { return !data[k]; })) {
          throw new Error('数据格式不正确');
        }
        state.data = data;
        state.loading = false;
        if (!Core.GAMES[state.game]) state.game = 'ssq';
        normalizeZones();
        updateChrome();
        render();
        registerSW();
      })
      .catch(function (err) {
        state.error = err;
        state.loading = false;
        render();
      });
  }

  function updateChrome() {
    if (state.data) {
      normalizeZones();
      var last = lastDraw(state.game);
      $dataDate.textContent = '数据 ' + last.date.slice(5);
      $dataDate.title = '最新一期 ' + last.issue + ' · ' + last.date;
    }
    Array.prototype.forEach.call($gameSeg.querySelectorAll('button'), function (btn) {
      btn.classList.toggle('on', btn.getAttribute('data-game') === state.game);
      btn.setAttribute('aria-selected', btn.getAttribute('data-game') === state.game ? 'true' : 'false');
    });
  }

  function render() {
    updateTabbar();
    if (state.loading) {
      $view.innerHTML = '<div class="card" style="margin-top:16px"><div class="skeleton" style="height:140px"></div></div>' +
        '<div class="card"><div class="skeleton"></div><div class="skeleton" style="margin-top:8px"></div></div>';
      return;
    }
    if (state.error) {
      $view.innerHTML = '<div class="error-screen">' +
        '<h2>数据没有加载成功</h2>' +
        '<p>' + esc(state.error.message || '未知错误') + '</p>' +
        '<p style="margin-top:8px">如果你是直接双击打开 index.html，浏览器会拦截本地数据读取；请通过 GitHub Pages 或本地 HTTP 服务器访问。</p>' +
        '<button class="btn ghost" data-action="retry" style="max-width:180px;margin:18px auto 0">重新加载</button>' +
        '</div>';
      return;
    }
    var html;
    if (state.tab === 'home') html = renderHome();
    else if (state.tab === 'trend') html = renderTrend();
    else if (state.tab === 'formulas') html = renderFormulas();
    else if (state.tab === 'history') html = renderHistory();
    else html = renderAbout();
    $view.innerHTML = html;
    $view.classList.remove('fade-in');
    void $view.offsetWidth;
    $view.classList.add('fade-in');
    if (state.tab === 'trend') drawTrendCharts();
  }

  function updateTabbar() {
    Array.prototype.forEach.call($tabbar.querySelectorAll('.tab'), function (btn) {
      var on = btn.getAttribute('data-tab') === state.tab;
      btn.classList.toggle('on', on);
      btn.setAttribute('aria-current', on ? 'page' : 'false');
    });
  }

  function switchTab(tab) {
    if (state.tab === tab) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    state.tab = tab;
    render();
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  /* ---------------- 推荐页 ---------------- */
  function renderHome() {
    var m = meta(state.game);
    var zones = m.ticketZones;
    var results = resultList(state.game, state.salt);
    var baseResults = resultList(state.game, 0);
    var last = lastDraw(state.game);
    var isAlt = state.salt > 0;
    var byZone = {};
    var baseByZone = {};
    results.forEach(function (r) { byZone[r.zone] = r; });
    baseResults.forEach(function (r) { baseByZone[r.zone] = r; });

    var altSalts = [1, 2, 3].filter(function (s) { return s !== state.salt; }).slice(0, 2);
    var avoid = {};
    zones.forEach(function (z) { avoid[z] = byZone[z].res.numbers.slice(); });
    state.alts = altSalts.map(function (salt) {
      var altZones = {};
      zones.forEach(function (z) {
        var alt = Core.reweight(gameData(state.game), baseByZone[z].res, salt, avoid[z].slice());
        altZones[z] = alt.numbers;
        avoid[z] = avoid[z].concat(alt.numbers);
      });
      return { salt: salt, zones: altZones };
    });

    var ticket = [];
    results.forEach(function (r) {
      r.res.numbers.forEach(function (n) { ticket.push(n); });
    });

    var summary;
    var structureSub;
    if (state.game === 'ssq' || state.game === 'dlt') {
      summary = results[0].res.summary;
      structureSub = m.front.label;
    } else if (state.game === 'kl8') {
      summary = results[0].res.summary;
      structureSub = '20 选 10';
    } else {
      summary = Core.describe(ticket, { min: 0, max: 9, pick: ticket.length });
      structureSub = state.game === 'fc3d' ? '三位数字' : '五位数字';
    }

    var structure = statsGrid(summary) + backLine(results);

    var heroBalls = '';
    var ballIndex = 0;
    results.forEach(function (r, i) {
      if (i) heroBalls += '<span class="divider"></span>';
      r.res.numbers.forEach(function (n) {
        heroBalls += ball(n, r.cfg.color, {
          digit: isDigitZone(r.cfg),
          style: '--i:' + ballIndex
        });
        ballIndex++;
      });
    });

    var rateText;
    if ((state.game === 'ssq' || state.game === 'dlt') && zones.length === 2) {
      rateText = m.front.label + '命中率 <b>' + pct(baseResults[0].res.stats.avgRate) + '</b>' +
        ' · ' + m.back.label + ' <b>' + pct(baseResults[1].res.stats.avgRate) + '</b>';
    } else if (state.game === 'kl8') {
      rateText = '加权命中率 <b>' + pct(baseResults[0].res.stats.avgRate) + '</b>';
    } else {
      var rates = baseResults.map(function (r) { return r.res.stats.avgRate; });
      rateText = '每位 ' + formulasFor(state.game, zones[0]).length + ' 个公式 · 平均命中率 <b>' +
        pct(rates.reduce(function (a, b) { return a + b; }, 0) / rates.length) + '</b>';
    }

    var formulaNote;
    if (state.game === 'ssq' || state.game === 'dlt') {
      formulaNote = '前区 ' + F.stats.front + ' 个公式 + 后区 ' + F.stats.back + ' 个公式，各自独立投票';
    } else if (state.game === 'kl8') {
      formulaNote = F.stats.front + ' 个号码公式独立投票';
    } else {
      formulaNote = '每位 ' + formulasFor(state.game, zones[0]).length + ' 个数字公式 × ' +
        zones.length + ' 位，各自独立投票';
    }

    return '' +
      '<section class="hero card">' +
      '<div class="hero-head">' +
      '<span class="eyebrow">' + (isAlt ? '备选方案 · 第 ' + state.salt + ' 组' : '下一期 · 公式投票推荐') + '</span>' +
      '<span class="hero-sub">数据截至 ' + last.date.slice(5) + '</span>' +
      '</div>' +
      '<div class="balls-row' + (state.game === 'kl8' ? ' wrap' : '') + '">' + heroBalls + '</div>' +
      '<div class="hero-meta">' +
      '<span><b>' + formulaCountFor(state.game) + '</b>' + (state.game === 'fc3d' || state.game === 'pl5' ? ' 个位置公式' : ' 个公式') + '</span>' +
      '<span>' + rateText + '</span>' +
      '</div>' +
      '<div class="hero-actions">' +
      '<button class="btn primary" data-action="reroll">换一注</button>' +
      '<button class="btn ghost" data-action="copy-main">复制号码</button>' +
      '</div>' +
      '<p class="hero-note">' + (isAlt
        ? '<button class="link" data-action="reset-main">回到主推</button> · 备选票会对主推号码降权并重排票数，公式判断不变'
        : formulaNote) + '</p>' +
      '</section>' +

      '<section class="card">' +
      '<div class="card-title">号码结构 <span class="sub">' + structureSub + '</span></div>' +
      structure +
      '</section>' +

      '<section class="card" id="vote-card">' + voteCardHTML() + '</section>' +

      '<section class="card">' +
      '<div class="card-title">关键公式 <span class="sub">按回测权重</span></div>' +
      contribHTML(results) +
      '</section>' +

      '<section class="card">' +
      '<div class="card-title">备选票 <span class="sub">主推降权 · 确定性扰动</span></div>' +
      altHTML() +
      '</section>' +

      '<p class="disclaimer">彩票每期开奖都是独立随机事件，历史走势与数学公式不能预测结果。本工具仅用于数据分析与娱乐，请理性购彩、量力而行。</p>';
  }

  function statsGrid(s) {
    return '<div class="stats-grid">' +
      stat('和值', s.sum) +
      stat('跨度', s.span) +
      stat('奇偶比', s.odd + ':' + s.even) +
      stat('大小比', s.big + ':' + s.small) +
      stat('三区比', s.zones.join(':')) +
      stat('AC 值', s.ac) +
      '</div>';
  }

  function backLine(results) {
    if (results.length !== 2) return '';
    var key = state.game;
    if (key !== 'ssq' && key !== 'dlt') return '';
    var m = meta(key);
    var b = results[1];
    return '<div class="back-summary">' +
      '<span class="tag blue">' + m.back.label + '</span>' +
      '<span>' + b.res.numbers.map(function (n) { return fmt(n, m.back); }).join(' · ') + '</span>' +
      '<span class="hint">和值 ' + b.res.summary.sum + ' · 跨度 ' + b.res.summary.span +
      ' · 奇偶 ' + b.res.summary.odd + ':' + b.res.summary.even + '</span>' +
      '</div>';
  }

  function stat(k, v) {
    return '<div class="stat"><div class="k">' + k + '</div><div class="v">' + v + '</div></div>';
  }

  function voteCardHTML() {
    var zones = zoneKeys(state.game);
    var zone = state.voteZone;
    if (zones.indexOf(zone) === -1) zone = zones[0];
    var res = analysis(state.game, zone, state.salt);
    var cfg = zoneCfg(state.game, zone);
    var kind = cfg.color;
    var max = res.ranking[0] ? res.ranking[0].weight : 1;
    var rows = res.ranking.slice(0, 12).map(function (r, i) {
      var width = max ? Math.max(3, (r.weight / max) * 100) : 0;
      return '<div class="vote-row' + (i === 0 ? ' top' : '') + '">' +
        '<span class="vote-rank">' + (i + 1) + '</span>' +
        ball(r.n, kind, { size: 'mini', digit: isDigitZone(cfg) }) +
        '<div class="vote-main">' +
        '<div class="vote-top"><b>' + r.votes + ' 票</b><span>权重 ' + r.weight.toFixed(1) + ' · 遗漏 ' + r.omission + ' 期</span></div>' +
        '<div class="bar' + (kind === 'blue' ? ' blue' : '') + '"><i style="width:' + width + '%"></i></div>' +
        '</div></div>';
    }).join('');

    var buttons = zones.map(function (z) {
      var c = zoneCfg(state.game, z);
      return '<button data-vote-zone="' + z + '" class="' + (zone === z ? 'on' : '') + '">' + c.label + '</button>';
    }).join('');

    return '<div class="vote-head">' +
      '<div class="card-title" style="margin:0">投票榜</div>' +
      '<div class="seg mini">' + buttons + '</div></div>' +
      '<div class="vote-list">' + rows + '</div>' +
      '<p class="hint" style="margin-top:10px">票数 = 推荐该号码的公式数量；权重 = 按贝叶斯平滑后的近 40 期回测命中率加权。</p>';
  }

  function contribHTML(results) {
    var per = results.length <= 2 ? 3 : (results.length === 3 ? 2 : 1);
    var all = [];
    results.forEach(function (r) {
      r.res.details
        .filter(function (d) { return r.res.numbers.indexOf(d.rec) !== -1; })
        .sort(function (a, b) { return b.weight - a.weight; })
        .slice(0, per)
        .forEach(function (d) { all.push({ d: d, cfg: r.cfg }); });
    });
    all.sort(function (a, b) { return b.d.weight - a.d.weight; });
    return '<div class="contrib">' + all.map(function (item) {
      var d = item.d, cfg = item.cfg;
      var isBlue = cfg.color === 'blue';
      return '<div class="contrib-row">' +
        ball(d.rec, cfg.color, { size: 'mini', digit: isDigitZone(cfg) }) +
        '<div class="contrib-main">' +
        '<div class="contrib-name">' + esc(d.name) + '</div>' +
        '<div class="contrib-meta">' + cfg.label + ' · ' + d.cat + ' · 近' + d.tries + '期命中 ' + d.hits + ' 次（' + pct(d.rate) + '）</div>' +
        '</div>' +
        '<span class="tag ' + (isBlue ? 'blue' : 'gold') + '" title="投票权重">' + d.weight.toFixed(2) + '×</span>' +
        '</div>';
    }).join('') + '</div>';
  }

  function altHTML() {
    if (!state.alts) return '';
    var m = meta(state.game);
    return state.alts.map(function (a, i) {
      var html = '';
      m.ticketZones.forEach(function (z, j) {
        var cfg = m[z];
        if (j && (m.key === 'ssq' || m.key === 'dlt')) html += '<span class="divider"></span>';
        (a.zones[z] || []).forEach(function (n) {
          html += ball(n, cfg.color, { size: 'mini', digit: isDigitZone(cfg) });
        });
      });
      return '<div class="alt-row">' +
        '<span class="alt-label">备选' + ['一', '二'][i] + '</span>' +
        '<div class="alt-balls">' + html + '</div>' +
        '<button class="alt-copy" data-action="copy-alt" data-salt="' + a.salt + '">复制</button>' +
        '</div>';
    }).join('') +
      '<p class="hint" style="margin-top:9px">备选票对主推号码整体降权，并按号码加入确定性扰动；仍由同一批公式投票，结果可复现。</p>';
  }

  /* ---------------- 走势页 ---------------- */
  function renderTrend() {
    var m = meta(state.game);
    if (zoneKeys(state.game).indexOf(state.zone) === -1) state.zone = zoneKeys(state.game)[0];
    var cfg = zoneCfg(state.game, state.zone);
    var isBlue = cfg.color === 'blue';
    var isDigit = isDigitZone(cfg);
    var rows = Core.trend(state.data[state.game].draws, state.zone, cfg, state.period);
    var stats = Core.baseStats(state.data[state.game].draws, state.zone, cfg, state.period);
    var nums = L.range(cfg.min, cfg.max);
    var desc = rows.slice().reverse();
    var compact = nums.length <= 16;

    var head = '<tr><th class="col-issue">期号</th>' +
      nums.map(function (n) { return '<th>' + fmt(n, cfg) + '</th>'; }).join('') + '</tr>';

    var body = desc.map(function (row) {
      return '<tr>' +
        '<td class="col-issue" title="' + row.issue + '"><b>' + String(row.issue).slice(-3) + '</b><span>' + row.date.slice(5) + '</span></td>' +
        row.cells.map(function (c) {
          var cls = c.hit
            ? '<td class="hit-cell"><span class="trend-ball' + (isBlue ? ' blue' : (isDigit ? ' gold' : '')) + '">' + fmt(c.n, cfg) + '</span></td>'
            : '<td>' + c.omission + '</td>';
          return cls;
        }).join('') + '</tr>';
    }).join('');

    var footFreq = '<tr><td class="col-issue">出现次数</td>' +
      nums.map(function (n) { return '<td>' + (stats.freq[n] || 0) + '</td>'; }).join('') + '</tr>';
    var footOm = '<tr><td class="col-issue">当前遗漏</td>' +
      nums.map(function (n) { return '<td>' + stats.omission[n] + '</td>'; }).join('') + '</tr>';

    var omissions = nums.map(function (n) { return { n: n, v: stats.omission[n] }; })
      .sort(function (a, b) { return b.v - a.v; }).slice(0, 10);
    var maxOm = omissions[0] ? omissions[0].v : 1;

    var structureCards = cfg.pick === 1
      ? '<section class="card"><div class="card-title">尾数分布 <span class="sub">近 ' + state.period + ' 期 · 尾数 0–9</span></div>' +
        '<div class="canvas-box"><canvas id="chart-tails"></canvas></div></section>'
      : '<section class="card"><div class="card-title">奇偶结构 <span class="sub">奇数 / 偶数个数</span></div><div class="canvas-box"><canvas id="chart-parity"></canvas></div>' +
        '<div class="legend"><span><i style="background:#ff8a5c"></i>奇数</span><span><i style="background:#3f6bff"></i>偶数</span></div></section>' +
        '<section class="card"><div class="card-title">大小结构 <span class="sub">以区间中点为界</span></div><div class="canvas-box"><canvas id="chart-size"></canvas></div>' +
        '<div class="legend"><span><i style="background:#ffc45c"></i>大号</span><span><i style="background:#3fd6b5"></i>小号</span></div></section>' +
        '<section class="card"><div class="card-title">三区分布 <span class="sub">号码区间三等分</span></div><div class="canvas-box"><canvas id="chart-zones"></canvas></div>' +
        '<div class="legend"><span><i style="background:#ffc45c"></i>一区</span><span><i style="background:#3fd6b5"></i>二区</span><span><i style="background:#7c6bff"></i>三区</span></div></section>';

    var zoneButtons = m.ticketZones.map(function (z) {
      return '<button data-trend-zone="' + z + '" class="' + (state.zone === z ? 'on' : '') + '">' +
        zoneCfg(state.game, z).label + '</button>';
    }).join('');

    var legendBall = isBlue
      ? 'linear-gradient(135deg,#a8d3ff,#3a8beb)'
      : (isDigit ? 'linear-gradient(135deg,#ffe3a3,#ffb84a)' : 'linear-gradient(135deg,#ff9d8a,#e63b53)');

    return '<div class="page-head"><h2>走势图</h2><p>' + m.name + ' · 最近 ' + state.period + ' 期 · ' + cfg.label + '</p></div>' +
      '<div class="card" style="margin-top:12px">' +
      '<div class="trend-toolbar">' +
      '<div class="seg">' + zoneButtons + '</div>' +
      '<div class="period-select">' +
      [30, 50, 100].map(function (p) {
        return '<button data-period="' + p + '" class="' + (state.period === p ? 'on' : '') + '">' + p + '</button>';
      }).join('') +
      '</div></div>' +
      '<div class="trend-wrap"><table class="trend' + (compact ? ' compact' : '') + '"><thead>' + head + '</thead><tbody>' + body + '</tbody>' +
      '<tfoot>' + footFreq + footOm + '</tfoot></table></div>' +
      '<div class="legend"><span><i style="background:' + legendBall + '"></i>开出号码</span>' +
      '<span><i style="background:rgba(255,255,255,.18)"></i>数字为遗漏期数</span>' +
      (nums.length > 16 ? '<span>← 左右滑动查看全部号码 →</span>' : '<span>共 ' + nums.length + ' 个号码，已全部展示</span>') + '</div>' +
      '</div>' +

      '<section class="card"><div class="card-title">' + (cfg.pick === 1 ? cfg.label + '走势' : '和值走势') +
      ' <span class="sub">' + (cfg.pick === 1 ? '每期开出的号码' : '每期号码之和') + '</span></div><div class="canvas-box"><canvas id="chart-sum"></canvas></div></section>' +
      (cfg.pick === 1 ? '' : '<section class="card"><div class="card-title">跨度走势 <span class="sub">最大号 − 最小号</span></div><div class="canvas-box"><canvas id="chart-span"></canvas></div></section>') +
      structureCards +
      '<section class="card"><div class="card-title">号码频率 <span class="sub">近 ' + state.period + ' 期出现次数</span></div><div class="canvas-box"><canvas id="chart-freq"></canvas></div></section>' +
      '<section class="card"><div class="card-title">当前遗漏 TOP 10 <span class="sub">距上次开出的期数</span></div>' +
      '<div class="omission-list">' + omissions.map(function (o) {
        return '<div class="omission-row">' + ball(o.n, cfg.color, { size: 'mini', digit: isDigit }) +
          '<div class="bar' + (isBlue ? ' blue' : '') + '"><i style="width:' + Math.max(4, (o.v / maxOm) * 100) + '%"></i></div>' +
          '<span class="v">' + o.v + ' 期</span></div>';
      }).join('') + '</div></section>';
  }

  function drawTrendCharts() {
    var cfg = zoneCfg(state.game, state.zone);
    if (!cfg) return;
    var rows = Core.trend(state.data[state.game].draws, state.zone, cfg, state.period);
    var stats = Core.baseStats(state.data[state.game].draws, state.zone, cfg, state.period);
    var isBlue = cfg.color === 'blue';
    var isPickOne = cfg.pick === 1;
    var labels = rows.map(function (r) { return String(r.issue).slice(-3); });
    var sums = rows.map(function (r) { return L.sum(r.numbers); });
    var spans = rows.map(function (r) { return L.span(r.numbers); });
    var odds = rows.map(function (r) { return r.numbers.filter(function (n) { return n % 2 === 1; }).length; });
    var evens = rows.map(function (r) { return r.numbers.length - r.numbers.filter(function (n) { return n % 2 === 1; }).length; });
    var mid = (cfg.min + cfg.max) / 2;
    var bigs = rows.map(function (r) { return r.numbers.filter(function (n) { return n > mid; }).length; });
    var smalls = rows.map(function (r) { return r.numbers.length - r.numbers.filter(function (n) { return n > mid; }).length; });
    var zoneSeries = [0, 1, 2].map(function (z) {
      return rows.map(function (r) {
        return r.numbers.filter(function (n) { return L.zoneIndex(n, cfg.min, cfg.max, 3) === z; }).length;
      });
    });
    var nums = L.range(cfg.min, cfg.max);
    var freqValues = nums.map(function (n) { return stats.freq[n] || 0; });
    var lineColor = isBlue ? Charts.COLORS.blue : Charts.COLORS.gold;
    var fill = isBlue ? 'rgba(77,163,255,0.26)' : 'rgba(255,196,92,0.26)';

    chartJobs = [];
    requestAnimationFrame(function () {
      function add(id, fn) {
        var canvas = document.getElementById(id);
        if (!canvas) return;
        var job = function () { try { fn(canvas); } catch (e) {} };
        chartJobs.push(job);
        job();
      }
      add('chart-sum', function (c) {
        Charts.line(c, { values: sums, labels: labels, color: lineColor, fill: fill, height: 150 });
      });
      if (!isPickOne) {
        add('chart-span', function (c) {
          Charts.line(c, {
            values: spans,
            labels: labels,
            color: isBlue ? Charts.COLORS.blue2 : Charts.COLORS.red,
            fill: isBlue ? 'rgba(124,107,255,0.24)' : 'rgba(255,95,109,0.24)',
            height: 140
          });
        });
      }
      if (isPickOne) {
        var tailValues = [];
        for (var ti = 0; ti < 10; ti++) tailValues.push(stats.tails[ti] || 0);
        add('chart-tails', function (c) {
          Charts.bars(c, {
            values: tailValues,
            labels: ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'],
            height: 140,
            color: isBlue ? 'rgba(77,163,255,0.9)' : 'rgba(255,196,92,0.9)'
          });
        });
      } else {
        add('chart-parity', function (c) {
          Charts.stack(c, {
            labels: labels, height: 140,
            series: [{ values: odds, color: '#ff8a5c' }, { values: evens, color: '#3f6bff' }]
          });
        });
        add('chart-size', function (c) {
          Charts.stack(c, {
            labels: labels, height: 130,
            series: [{ values: bigs, color: '#ffc45c' }, { values: smalls, color: '#3fd6b5' }]
          });
        });
        add('chart-zones', function (c) {
          Charts.stack(c, {
            labels: labels, height: 140,
            series: [
              { values: zoneSeries[0], color: '#ffc45c' },
              { values: zoneSeries[1], color: '#3fd6b5' },
              { values: zoneSeries[2], color: '#7c6bff' }
            ]
          });
        });
      }
      add('chart-freq', function (c) {
        Charts.bars(c, {
          values: freqValues,
          labels: nums.map(function (n) { return fmt(n, cfg); }),
          height: 150,
          color: 'rgba(255,196,92,0.9)'
        });
      });
    });
  }

  /* ---------------- 公式页 ---------------- */
  function renderFormulas() {
    var zone = state.formulaZone;
    if (zoneKeys(state.game).indexOf(zone) === -1) zone = zoneKeys(state.game)[0];
    var cfg = zoneCfg(state.game, zone);
    var pool = formulasFor(state.game, zone);
    var res = analysis(state.game, zone, 0);
    var detail = {};
    res.details.forEach(function (d) { detail[d.id] = d; });
    var list = pool.slice().sort(function (a, b) {
      return (detail[b.id].weight - detail[a.id].weight) || (a.id < b.id ? -1 : 1);
    });
    var cats = ['全部'];
    var catOrder = ['频率', '遗漏', '上期关联', '和值跨度', '结构形态', '统计模型', '数论映射', '期号日期', '跨区联动'];
    catOrder.forEach(function (c) {
      if (list.some(function (f) { return f.cat === c; })) cats.push(c);
    });
    list.forEach(function (f) { if (cats.indexOf(f.cat) === -1) cats.push(f.cat); });
    var counts = {};
    list.forEach(function (f) { counts[f.cat] = (counts[f.cat] || 0) + 1; });
    var maxRate = 0;
    list.forEach(function (f) { maxRate = Math.max(maxRate, detail[f.id].rate); });
    if (!maxRate) maxRate = 1;
    var kind = cfg.color;
    var q = state.query.trim().toLowerCase();

    var chips = cats.map(function (c) {
      var n = c === '全部' ? list.length : (counts[c] || 0);
      return '<button class="chip' + (state.formulaCat === c ? ' on' : '') + '" data-cat="' + c + '">' +
        c + '<span class="n">' + n + '</span></button>';
    }).join('');

    var cards = list.map(function (f) {
      var d = detail[f.id];
      var hay = (f.name + ' ' + f.desc + ' ' + f.cat).toLowerCase();
      var visible = (!q || hay.indexOf(q) !== -1) && (state.formulaCat === '全部' || f.cat === state.formulaCat);
      return '<article class="formula-card" data-search="' + esc(hay) + '" data-cat="' + esc(f.cat) + '"' + (visible ? '' : ' style="display:none"') + '>' +
        '<div class="f-head"><span class="f-name">' + esc(f.name) + '</span><span class="tag">' + esc(f.cat) + '</span></div>' +
        '<p class="f-desc">' + esc(f.desc) + '</p>' +
        '<div class="f-foot">' +
        ball(d.rec, kind, { size: 'mini', digit: isDigitZone(cfg) }) +
        '<span class="f-meta">近' + d.tries + '期命中 <b>' + d.hits + '</b> 次 · ' + pct(d.rate) + ' · 权重 ' + d.weight.toFixed(2) + '</span>' +
        '<div class="bar f-bar' + (kind === 'blue' ? ' blue' : '') + '"><i style="width:' + Math.max(3, (d.rate / maxRate) * 100) + '%"></i></div>' +
        '</div></article>';
    }).join('');

    var zoneButtons = meta(state.game).ticketZones.map(function (z) {
      var c = zoneCfg(state.game, z);
      return '<button data-formula-zone="' + z + '" class="' + (zone === z ? 'on' : '') + '">' +
        (c.short || c.label) + ' ' + formulasFor(state.game, z).length + '</button>';
    }).join('');

    return '<div class="page-head"><h2>公式库</h2><p>' + meta(state.game).name + ' · ' + cfg.label +
      ' ' + pool.length + ' 个公式 · 每个公式只推荐一个号码</p></div>' +
      '<div class="seg" style="margin-top:12px">' + zoneButtons + '</div>' +
      '<div class="toolbar"><input class="search" id="formula-search" type="search" placeholder="搜索公式名称或说明" value="' + esc(state.query) + '" autocomplete="off"></div>' +
      '<div class="chips">' + chips + '</div>' +
      '<div class="formula-list" id="formula-list">' + cards + '</div>' +
      '<div class="f-empty" id="formula-empty" style="display:none">没有匹配的公式</div>' +
      '<p class="hint" style="margin:12px 2px 0">按近 40 期贝叶斯平滑后的回测权重排序。命中率指该公式单独推荐的一个号码落入当期开奖号码集合的比例。</p>';
  }

  function filterFormulaCards() {
    var q = state.query.trim().toLowerCase();
    var cards = $view.querySelectorAll('.formula-card');
    var shown = 0;
    Array.prototype.forEach.call(cards, function (card) {
      var hay = card.getAttribute('data-search') || '';
      var cat = card.getAttribute('data-cat') || '';
      var catOk = state.formulaCat === '全部' || cat === state.formulaCat;
      var visible = catOk && (!q || hay.indexOf(q) !== -1);
      card.style.display = visible ? '' : 'none';
      if (visible) shown++;
    });
    var empty = document.getElementById('formula-empty');
    if (empty) empty.style.display = shown ? 'none' : 'block';
  }

  /* ---------------- 历史页 ---------------- */
  function renderHistory() {
    var m = meta(state.game);
    var all = state.data[state.game].draws.slice().reverse();
    var rows = all.slice(0, state.historyLimit);
    var last = all[0];
    var body = rows.map(function (d) {
      var nums = ticketNumbers(d, m);
      var sum = L.sum(nums);
      var span = L.span(nums);
      var odd = nums.filter(function (n) { return n % 2 === 1; }).length;
      return '<div class="draw-row">' +
        '<div class="draw-top"><span class="draw-issue">' + d.issue + '</span>' +
        '<span class="draw-date">' + d.date.slice(5) + ' ' + weekdayCN(d.date) + '</span></div>' +
        '<div class="draw-balls">' + ticketBalls(d, m, 'small') + '</div>' +
        '<div class="draw-foot"><span>和值 ' + sum + '</span><span>跨度 ' + span + '</span><span>奇偶 ' + odd + ':' + (nums.length - odd) + '</span></div>' +
        '</div>';
    }).join('');

    return '<div class="page-head"><h2>历史开奖</h2><p>' + m.name + ' · 共 ' + all.length + ' 期 · 最新 ' + last.issue + '（' + last.date + '）</p></div>' +
      '<div class="seg" style="margin-top:12px">' +
      [30, 60, 120].map(function (n) {
        return '<button data-history-limit="' + n + '" class="' + (state.historyLimit === n ? 'on' : '') + '">最近 ' + n + ' 期</button>';
      }).join('') +
      '</div>' +
      '<div class="history-list">' + body + '</div>' +
      (state.historyLimit < all.length
        ? '<button class="load-more" data-action="load-more">加载更多（还剩 ' + (all.length - state.historyLimit) + ' 期）</button>'
        : '<p class="hint" style="text-align:center;margin-top:12px">已展示全部历史数据</p>');
  }

  /* ---------------- 关于页 ---------------- */
  function renderAbout() {
    var data = state.data;
    var updated = '未知';
    if (data.updatedAt) {
      var updatedDate = new Date(data.updatedAt);
      updated = isNaN(updatedDate.getTime())
        ? String(data.updatedAt).slice(0, 16).replace('T', ' ')
        : updatedDate.toLocaleString('zh-CN', { hour12: false });
    }
    var isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    var standalone = window.navigator.standalone === true ||
      (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
    var dataKeys = ['ssq', 'dlt', 'fc3d', 'kl8', 'pl5'];
    var latestText = dataKeys.map(function (k) {
      var g = data[k];
      return g.name + ' ' + g.draws[g.draws.length - 1].issue;
    }).join('<br>');
    var historyText = dataKeys.map(function (k) { return data[k].draws.length; }).join(' / ');

    return '<div class="about-hero">' +
      '<div class="logo big-ball" style="width:64px;height:64px;border-radius:20px;font-size:32px">∑</div>' +
      '<h2>数彩实验室</h2>' +
      '<p>双色球 / 大乐透 ' + F.stats.total + ' 个公式 · 3D/排列五每位 ' + F.stats.digit + ' 个数字公式 · 快乐8 ' + F.stats.front + ' 个号码公式<br>五个彩种 · 走势图与公式透明可查</p>' +
      '</div>' +

      '<section class="card"><div class="card-title">它怎么工作</div><div class="prose">' +
      '<p><b>1. 每个公式只推荐一个号码。</b>双色球/大乐透的前区、后区公式互不混用；3D 按百/十/个位逐位推荐 0–9，排列五按万/千/百/十/个位逐位推荐 0–9；快乐8 在 1–80 中推荐 10 个号码。</p>' +
      '<p><b>2. 滚动回测加权。</b>每个公式用最近 40 期做“假装不知道当期”的回测，越近的期数权重越高（半衰期 20 期），再做贝叶斯平滑，避免小样本过拟合；平滑命中率越高，投票权重越大。</p>' +
      '<p><b>3. 加权投票。</b>所有公式给各自推荐的号码投票，按加权票数从高到低组成一注：双色球 6+1、大乐透 5+2、3D 三位、排列五五位、快乐8 选十。</p>' +
      '<p><b>4. 备选票。</b>“换一注”会对主推号码整体降权，并按号码加入确定性扰动，让票数自然流向次优号码；不使用随机数，同一组编号随时可复现。</p>' +
      '</div></section>' +

      '<section class="card"><div class="card-title">公式体系</div><div class="prose">' +
      '<p>双色球/大乐透 <b>' + F.stats.total + '</b> 个（前区 ' + F.stats.front + ' / 后区 ' + F.stats.back + '）；3D/排列五每位 <b>' + F.stats.digit + '</b> 个数字公式；快乐8 <b>' + F.stats.front + '</b> 个号码公式。覆盖 9 类方法：</p>' +
      '<div class="chips" style="padding-top:8px">' + Object.keys(F.stats.categories).map(function (c) {
        return '<span class="chip">' + c + '<span class="n">' + F.stats.categories[c] + '</span></span>';
      }).join('') + '</div>' +
      '<p style="margin-top:8px">包括频率与衰减热度、遗漏回补、上期重号/邻号、和值与跨度映射、奇偶/大小/质合/三区/012 路结构、线性回归与指数平滑、卡方与贝叶斯、马尔可夫转移、黄金分割/质数/斐波那契等数论映射，以及期号与星期映射。</p>' +
      '</div></section>' +

      '<section class="card"><div class="card-title">数据</div>' +
      '<div class="kv"><span>彩种</span><b>双色球 · 大乐透 · 福彩3D · 快乐8 · 排列五</b></div>' +
      '<div class="kv"><span>历史期数</span><b>' + historyText + ' 期</b></div>' +
      '<div class="kv"><span>最新开奖</span><b>' + latestText + '</b></div>' +
      '<div class="kv"><span>数据来源</span><b>中国福利彩票官网<br>中国体育彩票官网<br>500.com 走势图（备用）</b></div>' +
      '<div class="kv"><span>抓取时间</span><b>' + updated + '</b></div>' +
      '<div class="kv"><span>版本</span><b>v' + VERSION + '</b></div>' +
      '</section>' +

      '<section class="card"><div class="card-title">装到 iPhone 主屏幕</div>' +
      '<div class="install-tip"><span class="ico">📲</span><div>' +
      (standalone
        ? '已经在独立窗口运行。开奖后数据会自动更新（GitHub Actions 每日抓取）。'
        : (isIOS
          ? '用 Safari 打开本页 → 点底部“分享”按钮 → 选择“添加到主屏幕”。之后像 App 一样全屏使用，没网也能看已缓存的数据。'
          : '在手机浏览器菜单里选择“添加到主屏幕”即可。iOS 请使用 Safari。')) +
      '</div></div>' +
      '<p class="hint" style="margin-top:8px">本项目是纯静态网页，托管在 GitHub Pages，用手机流量即可随时打开，不依赖任何电脑常驻运行。</p>' +
      '</section>' +

      '<section class="card"><div class="card-title">更新数据</div><div class="prose">' +
      '<p>仓库内置 <b>.github/workflows/update-data.yml</b>，每天北京时间约 22:40 / 23:40 自动抓取最新开奖并提交。也可以在电脑上运行：</p>' +
      '<p style="margin-top:6px"><code>node scripts/fetch-data.mjs</code>，然后提交 <code>data/history.json</code>。</p>' +
      '</div></section>' +

      '<section class="card"><div class="notice">' +
      '<b>理性购彩提醒：</b>双色球、大乐透、福彩3D、快乐8、排列五均为独立随机事件，任何走势、公式或投票都无法提高中奖概率，更无法预测开奖结果。本工具所有“推荐”仅是对历史数据的数学练习，不构成投注建议。请量力而行，未满 18 周岁禁止购彩。' +
      '</div></section>';
  }

  /* ---------------- 事件 ---------------- */
  document.addEventListener('click', function (e) {
    var el = e.target.closest ? e.target.closest('[data-tab],[data-game],[data-action],[data-vote-zone],[data-trend-zone],[data-period],[data-formula-zone],[data-cat],[data-history-limit]') : null;
    if (!el) return;

    if (el.hasAttribute('data-tab')) {
      switchTab(el.getAttribute('data-tab'));
      return;
    }
    if (el.hasAttribute('data-game')) {
      var game = el.getAttribute('data-game');
      if (game !== state.game) {
        state.game = game;
        state.salt = 0;
        state.formulaCat = '全部';
        state.query = '';
        cache = {};
        storage.set('sc.game', game);
        updateChrome();
        render();
        window.scrollTo({ top: 0, behavior: 'auto' });
      }
      return;
    }
    if (el.hasAttribute('data-vote-zone')) {
      state.voteZone = el.getAttribute('data-vote-zone');
      var card = document.getElementById('vote-card');
      if (card) card.innerHTML = voteCardHTML();
      return;
    }
    if (el.hasAttribute('data-trend-zone')) {
      state.zone = el.getAttribute('data-trend-zone');
      render();
      return;
    }
    if (el.hasAttribute('data-period')) {
      state.period = Number(el.getAttribute('data-period'));
      render();
      return;
    }
    if (el.hasAttribute('data-formula-zone')) {
      state.formulaZone = el.getAttribute('data-formula-zone');
      state.formulaCat = '全部';
      state.query = '';
      render();
      return;
    }
    if (el.hasAttribute('data-cat')) {
      state.formulaCat = el.getAttribute('data-cat');
      render();
      window.scrollTo({ top: 0, behavior: 'auto' });
      return;
    }
    if (el.hasAttribute('data-history-limit')) {
      state.historyLimit = Number(el.getAttribute('data-history-limit'));
      render();
      return;
    }

    var action = el.getAttribute('data-action');
    if (!action) return;
    if (action === 'reroll') {
      state.salt = state.salt >= 9 ? 0 : state.salt + 1;
      render();
      toast(state.salt ? '已换成第 ' + state.salt + ' 组方案' : '已回到主推');
    } else if (action === 'reset-main') {
      state.salt = 0;
      render();
    } else if (action === 'copy-main') {
      var mainResults = resultList(state.game, state.salt);
      copyText(ticketText(flatResults(mainResults), state.game));
    } else if (action === 'copy-alt') {
      var salt = Number(el.getAttribute('data-salt'));
      var alt = (state.alts || []).filter(function (a) { return a.salt === salt; })[0];
      if (alt) {
        var altResults = zoneKeys(state.game).map(function (z) {
          return { zone: z, numbers: alt.zones[z] || [] };
        });
        copyText(ticketText(altResults, state.game));
      }
    } else if (action === 'load-more') {
      state.historyLimit += 60;
      render();
    } else if (action === 'retry') {
      state.loading = true;
      state.error = null;
      render();
      boot();
    }
  });

  document.addEventListener('input', function (e) {
    if (e.target && e.target.id === 'formula-search') {
      state.query = e.target.value;
      filterFormulaCards();
    }
  });

  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      if (state.tab === 'trend') {
        chartJobs.forEach(function (job) { try { job(); } catch (e) {} });
      }
    }, 160);
  });

  /* ---------------- PWA ---------------- */
  function registerSW() {
    if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) return;
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
