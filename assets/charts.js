/* 数彩实验室 · 轻量 Canvas 图表（无第三方依赖） */
(function (root) {
  'use strict';

  var COLORS = {
    gold: '#ffc45c',
    red: '#ff5f6d',
    red2: '#ff9a62',
    blue: '#4da3ff',
    blue2: '#7c6bff',
    teal: '#3fd6b5',
    grid: 'rgba(255,255,255,0.065)',
    text: 'rgba(255,255,255,0.42)',
    textStrong: 'rgba(255,255,255,0.72)'
  };
  var FONT = '10px -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Helvetica Neue", sans-serif';

  function prepare(canvas, height) {
    var parent = canvas.parentElement;
    var width = Math.max(220, Math.floor((parent ? parent.clientWidth : 320)));
    var dpr = Math.min(root.devicePixelRatio || 1, 3);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = '100%';
    canvas.style.height = height + 'px';
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.font = FONT;
    ctx.textBaseline = 'middle';
    return { ctx: ctx, w: width, h: height };
  }

  function niceRange(values) {
    var min = Math.min.apply(null, values), max = Math.max.apply(null, values);
    if (!isFinite(min) || !isFinite(max)) return [0, 1];
    if (min === max) { min -= 1; max += 1; }
    var pad = (max - min) * 0.16;
    return [min - pad, max + pad];
  }

  function line(canvas, opts) {
    var height = opts.height || 150;
    var p = prepare(canvas, height);
    var ctx = p.ctx, w = p.w, h = p.h;
    var values = opts.values || [];
    if (!values.length) return;
    var labels = opts.labels || [];
    var pad = { l: 32, r: 12, t: 14, b: 20 };
    var plotW = w - pad.l - pad.r, plotH = h - pad.t - pad.b;
    var range = opts.range || niceRange(values);
    var y0 = range[0], y1 = range[1];

    // 网格与纵轴刻度
    ctx.textAlign = 'right';
    for (var g = 0; g <= 3; g++) {
      var gy = pad.t + (plotH * g) / 3;
      var val = y1 - ((y1 - y0) * g) / 3;
      ctx.strokeStyle = COLORS.grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(pad.l, gy + 0.5);
      ctx.lineTo(w - pad.r, gy + 0.5);
      ctx.stroke();
      ctx.fillStyle = COLORS.text;
      ctx.fillText(String(Math.round(val)), pad.l - 6, gy);
    }

    var n = values.length;
    var X = function (i) { return pad.l + (n === 1 ? plotW / 2 : (plotW * i) / (n - 1)); };
    var Y = function (v) { return pad.t + plotH - ((v - y0) / (y1 - y0)) * plotH; };

    // 面积渐变
    var grad = ctx.createLinearGradient(0, pad.t, 0, pad.t + plotH);
    grad.addColorStop(0, opts.fill || 'rgba(255,196,92,0.30)');
    grad.addColorStop(1, 'rgba(255,196,92,0)');
    ctx.beginPath();
    ctx.moveTo(X(0), Y(values[0]));
    for (var i = 1; i < n; i++) ctx.lineTo(X(i), Y(values[i]));
    ctx.lineTo(X(n - 1), pad.t + plotH);
    ctx.lineTo(X(0), pad.t + plotH);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // 折线
    ctx.beginPath();
    ctx.moveTo(X(0), Y(values[0]));
    for (var j = 1; j < n; j++) ctx.lineTo(X(j), Y(values[j]));
    ctx.strokeStyle = opts.color || COLORS.gold;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.shadowColor = (opts.color || COLORS.gold) + '88';
    ctx.shadowBlur = 8;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // 数据点
    if (n <= 40) {
      for (var k = 0; k < n; k++) {
        ctx.beginPath();
        ctx.arc(X(k), Y(values[k]), 1.8, 0, Math.PI * 2);
        ctx.fillStyle = opts.color || COLORS.gold;
        ctx.fill();
      }
    }

    // 均值虚线
    if (opts.mean !== false) {
      var mean = values.reduce(function (a, b) { return a + b; }, 0) / n;
      var my = Y(mean);
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = 'rgba(255,255,255,0.22)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(pad.l, my);
      ctx.lineTo(w - pad.r, my);
      ctx.stroke();
      ctx.setLineDash([]);
      var meanTxt = '均 ' + (Math.round(mean * 10) / 10);
      ctx.textAlign = 'left';
      var tw = ctx.measureText(meanTxt).width;
      var tx = pad.l + 4;
      var ty = Math.max(10, my - 8);
      ctx.fillStyle = 'rgba(8,12,22,0.82)';
      ctx.fillRect(tx - 3, ty - 7, tw + 7, 14);
      ctx.fillStyle = COLORS.text;
      ctx.fillText(meanTxt, tx, ty);
    }

    // 横轴标签
    ctx.fillStyle = COLORS.text;
    ctx.textAlign = 'center';
    var step = Math.max(1, Math.ceil(n / 6));
    for (var m = 0; m < n; m += step) {
      var label = labels[m] == null ? String(m + 1) : String(labels[m]);
      ctx.fillText(label, X(m), h - 7);
    }
  }

  function bars(canvas, opts) {
    var height = opts.height || 150;
    var p = prepare(canvas, height);
    var ctx = p.ctx, w = p.w, h = p.h;
    var values = opts.values || [];
    if (!values.length) return;
    var labels = opts.labels || [];
    var pad = { l: 8, r: 8, t: 12, b: 20 };
    var plotW = w - pad.l - pad.r, plotH = h - pad.t - pad.b;
    var max = Math.max.apply(null, values) || 1;
    var n = values.length;
    var slot = plotW / n;
    var bw = Math.max(3, Math.min(16, slot * 0.62));

    for (var g = 0; g <= 2; g++) {
      var gy = pad.t + (plotH * g) / 2;
      ctx.strokeStyle = COLORS.grid;
      ctx.beginPath();
      ctx.moveTo(pad.l, gy + 0.5);
      ctx.lineTo(w - pad.r, gy + 0.5);
      ctx.stroke();
    }

    for (var i = 0; i < n; i++) {
      var bh = Math.max(2, (values[i] / max) * plotH);
      var x = pad.l + slot * i + (slot - bw) / 2;
      var y = pad.t + plotH - bh;
      var isTop = values[i] === max;
      var grad = ctx.createLinearGradient(0, y, 0, y + bh);
      if (isTop) {
        grad.addColorStop(0, '#ffd88a');
        grad.addColorStop(1, '#ff9a3c');
      } else {
        grad.addColorStop(0, opts.color || 'rgba(255,196,92,0.85)');
        grad.addColorStop(1, 'rgba(255,196,92,0.18)');
      }
      ctx.fillStyle = grad;
      var r = Math.min(3, bw / 2);
      ctx.beginPath();
      ctx.moveTo(x, y + bh);
      ctx.lineTo(x, y + r);
      ctx.quadraticCurveTo(x, y, x + r, y);
      ctx.lineTo(x + bw - r, y);
      ctx.quadraticCurveTo(x + bw, y, x + bw, y + r);
      ctx.lineTo(x + bw, y + bh);
      ctx.closePath();
      ctx.fill();
    }

    ctx.fillStyle = COLORS.text;
    ctx.textAlign = 'center';
    var step = Math.max(1, Math.ceil(n / 10));
    for (var j = 0; j < n; j += step) {
      ctx.fillText(String(labels[j] == null ? j + 1 : labels[j]), pad.l + slot * j + slot / 2, h - 7);
    }
  }

  function stack(canvas, opts) {
    var height = opts.height || 150;
    var p = prepare(canvas, height);
    var ctx = p.ctx, w = p.w, h = p.h;
    var series = opts.series || [];
    if (!series.length) return;
    var n = series[0].values.length;
    if (!n) return;
    var labels = opts.labels || [];
    var pad = { l: 8, r: 8, t: 12, b: 20 };
    var plotW = w - pad.l - pad.r, plotH = h - pad.t - pad.b;
    var totals = [];
    for (var i = 0; i < n; i++) {
      var t = 0;
      for (var s = 0; s < series.length; s++) t += series[s].values[i] || 0;
      totals.push(t);
    }
    var max = Math.max.apply(null, totals) || 1;
    var slot = plotW / n;
    var bw = Math.max(3, Math.min(15, slot * 0.6));

    for (var g = 0; g <= 2; g++) {
      var gy = pad.t + (plotH * g) / 2;
      ctx.strokeStyle = COLORS.grid;
      ctx.beginPath();
      ctx.moveTo(pad.l, gy + 0.5);
      ctx.lineTo(w - pad.r, gy + 0.5);
      ctx.stroke();
    }

    for (var k = 0; k < n; k++) {
      var x = pad.l + slot * k + (slot - bw) / 2;
      var yBottom = pad.t + plotH;
      for (var q = 0; q < series.length; q++) {
        var v = series[q].values[k] || 0;
        if (!v) continue;
        var bh = (v / max) * plotH;
        ctx.fillStyle = series[q].color;
        ctx.fillRect(x, yBottom - bh, bw, Math.max(1, bh - 1));
        yBottom -= bh;
      }
    }

    ctx.fillStyle = COLORS.text;
    ctx.textAlign = 'center';
    var step = Math.max(1, Math.ceil(n / 6));
    for (var j = 0; j < n; j += step) {
      ctx.fillText(String(labels[j] == null ? j + 1 : labels[j]), pad.l + slot * j + slot / 2, h - 7);
    }
  }

  root.Charts = { line: line, bars: bars, stack: stack, COLORS: COLORS };
})(typeof globalThis !== 'undefined' ? globalThis : this);
