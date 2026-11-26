/*
 * Order Fulfillment Lab — interactive explainer engine.
 *
 * A page calls OFL.mount(config) with:
 *   nodes      components drawn on the diagram (id, label, sub, x, y, w, h, type, info)
 *   groups     dashed containers (process boundaries, plugin scopes)
 *   links      faint static connections [fromId, toId]
 *   scenarios  ordered steps; each step moves a packet between nodes and
 *              may patch the "world state" (order, payment, stock, jobs, UI)
 *
 * No build step and no dependencies: open the HTML file directly.
 */
(function () {
  'use strict';
  const OFL = (window.OFL = window.OFL || {});
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const KIND_LABEL = { http: 'HTTP', sql: 'SQL', ws: 'WS', notify: 'NOTIFY', job: 'JOB', internal: 'IN-PROC', ui: 'UI', error: 'ERROR' };
  const PAGES = [
    ['index.html', 'Overview'],
    ['express.html', 'Express'],
    ['fastify.html', 'Fastify'],
    ['nextjs.html', 'Next.js'],
    ['nestjs.html', 'NestJS'],
    ['core.html', 'Shared core & worker'],
  ];

  // ---------------------------------------------------------------- helpers
  const $ = (sel, root = document) => root.querySelector(sel);
  const el = (tag, attrs = {}, html) => {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') node.className = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    }
    if (html !== undefined) node.innerHTML = html;
    return node;
  };
  const svg = (tag, attrs = {}) => {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    return node;
  };
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const clone = (o) => JSON.parse(JSON.stringify(o ?? {}));
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function statusTone(v) {
    const s = String(v ?? '');
    if (/^(CONFIRMED|SHIPPED|CAPTURED|DONE|REFUNDED|SUCCEEDED|processed|OK|signed in|replayed)/i.test(s)) return 'ok';
    if (/^(CANCELLED|DECLINED|FAILED|RELEASED|InsufficientStock|NothingToShip|401|403|SEARCH_UNAVAILABLE|PriceChanged|down)/i.test(s)) return 'bad';
    if (s === '—' || s === '') return '';
    return 'warn';
  }
  const badge = (v) => `<span class="badge ${statusTone(v)}">${esc(v ?? '—')}</span>`;

  // ---------------------------------------------------------------- theme + top bar
  function initTheme() {
    let saved = null;
    try { saved = localStorage.getItem('ofl-theme'); } catch (_) { /* storage unavailable */ }
    if (saved) document.documentElement.setAttribute('data-theme', saved);
  }
  function toggleTheme() {
    const cur = document.documentElement.getAttribute('data-theme')
      || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('ofl-theme', next); } catch (_) { /* storage unavailable */ }
  }
  OFL.topbar = function (active) {
    initTheme();
    const bar = el('header', { class: 'topbar' });
    bar.appendChild(el('div', { class: 'brand' }, 'Order Fulfillment Lab<small>interactive architecture</small>'));
    const nav = el('nav', { class: 'nav' });
    for (const [href, label] of PAGES) nav.appendChild(el('a', { href, class: href === active ? 'active' : '' }, label));
    bar.appendChild(nav);
    bar.appendChild(el('div', { class: 'spacer' }));
    bar.appendChild(el('button', { class: 'theme-btn', onclick: toggleTheme, title: 'Switch light / dark' }, '◐ Theme'));
    document.body.prepend(bar);
  };
  OFL.esc = esc;
  OFL.badge = badge;

  // ---------------------------------------------------------------- geometry
  const center = (n) => [n.x + n.w / 2, n.y + n.h / 2];
  function edgePoint(n, tx, ty) {
    const [cx, cy] = center(n);
    const dx = tx - cx, dy = ty - cy;
    if (!dx && !dy) return [cx, cy];
    const s = Math.min(dx ? (n.w / 2) / Math.abs(dx) : Infinity, dy ? (n.h / 2) / Math.abs(dy) : Infinity);
    return [cx + dx * s, cy + dy * s];
  }
  function segment(a, b, bend) {
    const [bx, by] = center(b), [ax, ay] = center(a);
    const p0 = edgePoint(a, bx, by), p1 = edgePoint(b, ax, ay);
    const mx = (p0[0] + p1[0]) / 2, my = (p0[1] + p1[1]) / 2;
    const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) || 1;
    const nx = -(p1[1] - p0[1]) / len, ny = (p1[0] - p0[0]) / len;
    const c = [mx + nx * bend, my + ny * bend];
    return { p0, p1, d: `M${p0[0].toFixed(1)},${p0[1].toFixed(1)} Q${c[0].toFixed(1)},${c[1].toFixed(1)} ${p1[0].toFixed(1)},${p1[1].toFixed(1)}` };
  }

  // ---------------------------------------------------------------- mount
  OFL.mount = function (cfg) {
    OFL.topbar(cfg.page);
    const nodes = new Map(cfg.nodes.map((n) => [n.id, n]));
    const scenarios = cfg.scenarios;
    for (const s of scenarios) for (const st of s.steps) {
      for (const id of stepPath(st)) if (!nodes.has(id)) console.warn(`[OFL] scenario ${s.id}: unknown node "${id}"`);
    }

    // ----- skeleton
    const intro = el('section', { class: 'intro' });
    intro.innerHTML = `<h1>${cfg.title}</h1><p>${cfg.intro}</p>` +
      (cfg.chips ? `<div class="chips">${cfg.chips.map((c) => `<span class="chip">${c}</span>`).join('')}</div>` : '');
    document.body.appendChild(intro);

    const main = el('main', { class: 'explorer' });
    const left = el('aside', { class: 'card scenarios' }, '<h2>Scenarios</h2>');
    const mid = el('section', { class: 'stage-wrap' });
    const right = el('aside', { class: 'card inspector' });
    main.append(left, mid, right);
    document.body.appendChild(main);

    const head = el('div', { class: 'card scn-head' });
    const stageCard = el('div', { class: 'card stage' });
    const controls = el('div', { class: 'card controls' });
    const tlCard = el('div', { class: 'card' }, '<h2>Steps (click to jump)</h2>');
    const timeline = el('div', { class: 'timeline' });
    tlCard.appendChild(timeline);
    mid.append(head, stageCard, controls, tlCard);

    right.innerHTML = `<div class="tabs"><button class="tab active" data-t="step">Step</button><button class="tab" data-t="node">Component</button><button class="tab" data-t="try">Try it</button></div>
      <div class="pane active" data-p="step"></div><div class="pane" data-p="node"></div><div class="pane" data-p="try"></div>`;
    const panes = { step: $('[data-p=step]', right), node: $('[data-p=node]', right), try: $('[data-p=try]', right) };
    const showTab = (t) => {
      right.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.t === t));
      right.querySelectorAll('.pane').forEach((p) => p.classList.toggle('active', p.dataset.p === t));
    };
    right.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.t)));

    // ----- scenario list
    scenarios.forEach((s) => {
      const b = el('button', { class: 'scn', 'data-id': s.id });
      b.innerHTML = `<span class="t">${s.title}</span><span class="m"><span class="role">${s.role}</span>${(s.tests || []).slice(0, 3).map((t) => `<span>${t}</span>`).join('')}</span>`;
      b.addEventListener('click', () => select(s.id, true));
      left.appendChild(b);
    });

    // ----- diagram
    const [VW, VH] = cfg.viewBox;
    const root = svg('svg', { viewBox: `0 0 ${VW} ${VH}`, role: 'img', 'aria-label': `${cfg.title} component diagram` });
    stageCard.appendChild(root);
    const legend = el('div', { class: 'legend' });
    legend.innerHTML = Object.entries(KIND_LABEL).filter(([k]) => k !== 'error')
      .map(([k, v]) => `<span><span class="kind k-${k}">${v}</span>${{ http: 'request/response', sql: 'database', ws: 'WebSocket', notify: 'LISTEN/NOTIFY', job: 'outbox job', internal: 'function call', ui: 'user / screen' }[k]}</span>`).join('') +
      '<span>Dashed trail = response. Click any box for details.</span>';
    stageCard.appendChild(legend);

    const gGroups = svg('g'), gLinks = svg('g'), gTrails = svg('g'), gNodes = svg('g'), gPackets = svg('g');
    root.append(gGroups, gLinks, gTrails, gNodes, gPackets);

    for (const g of cfg.groups || []) {
      const grp = svg('g', { class: 'g-group' });
      grp.append(svg('rect', { x: g.x, y: g.y, width: g.w, height: g.h, rx: 12 }));
      const t = svg('text', { x: g.x + 12, y: g.y + 18 }); t.textContent = g.label; grp.append(t);
      gGroups.append(grp);
    }
    for (const [a, b] of cfg.links || []) {
      const na = nodes.get(a), nb = nodes.get(b);
      if (na && nb) gLinks.append(svg('path', { class: 'link', d: segment(na, nb, 0).d }));
    }
    const nodeEls = new Map();
    for (const n of cfg.nodes) {
      const g = svg('g', { class: `g-node t-${n.type}`, tabindex: 0, role: 'button', 'aria-label': n.label });
      if (n.type === 'db') {
        const ry = 9;
        g.append(svg('path', { class: 'shape', d: `M${n.x},${n.y + ry} a${n.w / 2},${ry} 0 0,0 ${n.w},0 a${n.w / 2},${ry} 0 0,0 ${-n.w},0 v${n.h - 2 * ry} a${n.w / 2},${ry} 0 0,0 ${n.w},0 v${-(n.h - 2 * ry)}` }));
      } else {
        g.append(svg('rect', { class: 'shape', x: n.x, y: n.y, width: n.w, height: n.h, rx: n.type === 'actor' ? 22 : 9 }));
      }
      const subs = n.sub ? String(n.sub).split('\n') : [];
      const total = 16 + subs.length * 15;
      let ty = n.y + n.h / 2 - total / 2 + 13 + (n.type === 'db' ? 5 : 0);
      const t = svg('text', { class: 'title', x: n.x + n.w / 2, y: ty, 'text-anchor': 'middle' }); t.textContent = n.label; g.append(t);
      for (const line of subs) {
        ty += 15;
        const s = svg('text', { class: 'sub', x: n.x + n.w / 2, y: ty, 'text-anchor': 'middle' }); s.textContent = line; g.append(s);
      }
      g.addEventListener('click', () => showNode(n.id));
      g.addEventListener('keydown', (e) => { if (e.key === 'Enter') showNode(n.id); });
      gNodes.append(g);
      nodeEls.set(n.id, g);
    }

    // ----- controls
    controls.innerHTML = `
      <button class="btn" data-a="reset" title="Reset (R)">↺ Reset</button>
      <button class="btn" data-a="back" title="Previous step (←)">◀ Back</button>
      <button class="btn primary" data-a="play" title="Play / pause (Space)">▶ Play</button>
      <button class="btn" data-a="next" title="Next step (→)">Step ▶</button>
      <div class="progress"><div></div></div>
      <span class="counter">0 / 0</span>
      <label class="speed">Speed <select><option value="0.6">0.6×</option><option value="1" selected>1×</option><option value="1.6">1.6×</option><option value="2.5">2.5×</option></select></label>`;
    const btn = (a) => $(`[data-a=${a}]`, controls);
    const speedSel = $('select', controls);
    btn('reset').addEventListener('click', () => { stop(); go(-1, false); });
    btn('back').addEventListener('click', () => { stop(); go(idx - 1, false); });
    btn('next').addEventListener('click', () => { stop(); go(idx + 1, true); });
    btn('play').addEventListener('click', () => (playing ? stop() : play()));
    document.addEventListener('keydown', (e) => {
      if (e.target.closest && e.target.closest('input,select,textarea')) return;
      if (e.key === ' ') { e.preventDefault(); playing ? stop() : play(); }
      else if (e.key === 'ArrowRight') { stop(); go(idx + 1, true); }
      else if (e.key === 'ArrowLeft') { stop(); go(idx - 1, false); }
      else if (e.key === 'r' || e.key === 'R') { stop(); go(-1, false); }
    });

    // ----- state
    let scn = null, idx = -1, playing = false, animToken = 0, selectedNode = null;

    function stepPath(st) {
      if (st.path) return st.path;
      return st.to && st.to !== st.from ? [st.from, st.to] : [st.from];
    }

    function computeState(i) {
      const s = clone(scn.init);
      s.stock = s.stock || {}; s.jobs = s.jobs || {}; s.kv = s.kv || {};
      let changed = new Set();
      for (let k = 0; k <= i; k++) {
        const patch = scn.steps[k].set;
        if (!patch) continue;
        if (k === i) changed = new Set(Object.keys(patch).flatMap((key) =>
          ['stock', 'jobs', 'kv'].includes(key) ? Object.keys(patch[key]).map((sub) => `${key}.${sub}`) : [key]));
        for (const [key, val] of Object.entries(patch)) {
          if (['stock', 'jobs', 'kv'].includes(key)) {
            for (const [sub, v] of Object.entries(val)) { if (v === null) delete s[key][sub]; else s[key][sub] = v; }
          } else s[key] = val;
        }
      }
      return { s, changed };
    }

    function select(id, fromUser) {
      stop();
      scn = scenarios.find((s) => s.id === id) || scenarios[0];
      left.querySelectorAll('.scn').forEach((b) => b.classList.toggle('active', b.dataset.id === scn.id));
      head.innerHTML = `<h3>${scn.title}</h3><p>${scn.summary}</p>`;
      timeline.innerHTML = '';
      scn.steps.forEach((st, i) => {
        const b = el('button', { class: 'tl', 'data-i': i });
        b.innerHTML = `<span class="n">${i + 1}</span><span class="kind k-${st.kind}">${KIND_LABEL[st.kind]}</span><span>${st.label}</span>`;
        b.addEventListener('click', () => { stop(); go(i, true); });
        timeline.appendChild(b);
      });
      panes.try.innerHTML = scn.try ? `<h4>Try it yourself</h4><div class="body">${scn.try}</div>` : '<p class="empty">No live commands for this scenario.</p>';
      if (fromUser) { try { history.replaceState(null, '', `#${scn.id}`); } catch (_) { /* file:// may refuse */ } }
      showTab('step');
      go(-1, false);
    }

    function setHighlight(st) {
      const on = new Set(st ? [...stepPath(st), ...(st.also || [])] : []);
      for (const [id, g] of nodeEls) {
        g.classList.toggle('on', on.has(id));
        g.classList.toggle('selected', id === selectedNode);
      }
    }

    function clearPackets() { gPackets.innerHTML = ''; gTrails.innerHTML = ''; }

    function drawTrail(st) {
      const ids = stepPath(st);
      if (ids.length < 2) return null;
      const bend = st.back ? -22 : 22;
      let d = '';
      for (let k = 0; k < ids.length - 1; k++) {
        const seg = segment(nodes.get(ids[k]), nodes.get(ids[k + 1]), bend);
        d += k === 0 ? seg.d : seg.d.replace(/^M[^Q]+/, `L${seg.p0[0].toFixed(1)},${seg.p0[1].toFixed(1)} `);
      }
      const color = cssVar(`--k-${st.kind}`);
      const p = svg('path', { class: `trail${st.back ? ' back' : ''}`, d, stroke: color });
      gTrails.appendChild(p);
      return { path: p, color };
    }

    async function animate(st, token) {
      clearPackets();
      const trail = drawTrail(st);
      const ids = stepPath(st);
      if (!trail) {
        const g = nodeEls.get(ids[0]);
        if (g) { g.classList.remove('pulse'); void g.getBBox(); g.classList.add('pulse'); }
        return;
      }
      const speed = Number(speedSel.value);
      const dur = reduceMotion ? 0 : (st.count > 1 ? 1500 : 1050) / speed;
      const len = trail.path.getTotalLength();
      const count = Math.min(st.count || 1, 24);
      const dots = [];
      for (let k = 0; k < count; k++) {
        const c = svg('circle', { r: count > 1 ? 5 : 7, fill: trail.color, stroke: '#fff', 'stroke-width': 1.5 });
        gPackets.appendChild(c); dots.push(c);
      }
      const label = svg('g', { class: 'packet-label' });
      const text = svg('text', { x: 0, y: 0 }); text.textContent = st.count > 1 ? `${st.label}` : st.label;
      const rect = svg('rect', { rx: 5, fill: trail.color, stroke: trail.color });
      label.append(rect, text); gPackets.appendChild(label);
      const bb = text.getBBox();
      rect.setAttribute('x', bb.x - 6); rect.setAttribute('y', bb.y - 3);
      rect.setAttribute('width', bb.width + 12); rect.setAttribute('height', bb.height + 6);
      const place = (t) => {
        dots.forEach((c, k) => {
          const tt = Math.max(0, Math.min(1, t * (1 + count * 0.04) - k * 0.04));
          const pt = trail.path.getPointAtLength(len * ease(tt));
          c.setAttribute('cx', pt.x); c.setAttribute('cy', pt.y);
        });
        const lead = trail.path.getPointAtLength(len * ease(Math.min(1, t)));
        const lx = Math.max(bb.width / 2 + 8, Math.min(VW - bb.width / 2 - 8, lead.x));
        label.setAttribute('transform', `translate(${lx - bb.width / 2 - bb.x},${lead.y - 16 - bb.y - bb.height})`);
      };
      if (dur === 0) { place(1); }
      else {
        const t0 = performance.now();
        await new Promise((resolve) => {
          const frame = (now) => {
            if (token !== animToken) return resolve();
            const t = Math.min(1, (now - t0) / dur);
            place(t);
            if (t < 1) requestAnimationFrame(frame); else resolve();
          };
          requestAnimationFrame(frame);
        });
      }
      if (token !== animToken) return;
      const target = nodeEls.get(ids[ids.length - 1]);
      if (target) { target.classList.remove('pulse'); void target.getBBox(); target.classList.add('pulse'); }
      await sleep(dur ? 250 / speed : 0);
      if (token === animToken) dots.forEach((c) => c.remove());
    }
    const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

    function renderStep() {
      const n = scn.steps.length;
      $('.progress > div', controls).style.width = `${((idx + 1) / n) * 100}%`;
      $('.counter', controls).textContent = `${Math.max(0, idx + 1)} / ${n}`;
      btn('back').disabled = idx < 0;
      btn('next').disabled = idx >= n - 1;
      timeline.querySelectorAll('.tl').forEach((b, i) => {
        b.classList.toggle('done', i < idx);
        b.classList.toggle('current', i === idx);
      });
      const cur = timeline.querySelector('.tl.current');
      if (cur) {
        // Scroll only the step list, never the page.
        const top = cur.offsetTop;
        if (top < timeline.scrollTop) timeline.scrollTop = top;
        else if (top + cur.offsetHeight > timeline.scrollTop + timeline.clientHeight) timeline.scrollTop = top + cur.offsetHeight - timeline.clientHeight;
      }

      const { s, changed } = computeState(idx);
      const st = scn.steps[idx];
      let html = '';
      if (!st) {
        html += `<h4>Ready</h4><div class="body"><p>${scn.summary}</p><p>Press <b>▶ Play</b> to watch the whole flow, or <b>Step ▶</b> to go one hop at a time. Keyboard: Space, ←, →, R.</p></div>`;
      } else {
        const ids = stepPath(st);
        const names = ids.map((id) => `<b>${esc(nodes.get(id)?.label ?? id)}</b>`).join(' → ');
        html += `<h4>${st.title || st.label}</h4><div class="route"><span class="kind k-${st.kind}">${KIND_LABEL[st.kind]}</span>${names}</div>`;
        if (st.body) html += `<div class="body">${st.body}</div>`;
        if (st.code) html += `<pre class="code">${esc(st.code.replace(/^\n/, ''))}</pre>`;
        if (st.file) html += `<div class="file">Code: ${[].concat(st.file).map((f) => `<code>${esc(f)}</code>`).join(' ')}</div>`;
      }
      html += `<div class="section-title">What the user sees</div><div class="screen${changed.has('ui') ? ' flash' : ''}"><div class="bar"><i></i><i></i><i></i><span>${esc(s.url || cfg.defaultUrl || 'browser')}</span></div><div class="content">${s.ui || '<span class="empty">Nothing yet.</span>'}</div></div>`;
      html += '<div class="section-title">World state</div><div class="state-grid">';
      const kvs = [['Order', s.order, 'order'], ['Payment', s.payment, 'payment'], ...Object.entries(s.kv).map(([k, v]) => [k, v, `kv.${k}`])];
      for (const [k, v, key] of kvs) html += `<div class="kv${changed.has(key) ? ' changed' : ''}"><div class="k">${esc(k)}</div><div class="v">${badge(v)}</div></div>`;
      html += '</div>';
      const stock = Object.entries(s.stock);
      if (stock.length) {
        html += '<div class="section-title">Stock (inventory_balances)</div><table class="stock"><tr><th>SKU @ warehouse</th><th>on_hand</th><th>reserved</th><th>available</th></tr>';
        for (const [k, [oh, rs]] of stock) html += `<tr class="${changed.has(`stock.${k}`) ? 'changed' : ''}"><td>${esc(k)}</td><td>${oh}</td><td>${rs}</td><td><b>${oh - rs}</b></td></tr>`;
        html += '</table>';
      }
      const jobs = Object.entries(s.jobs);
      html += '<div class="section-title">Outbox jobs</div>';
      html += jobs.length ? `<div class="jobs">${jobs.map(([t, v]) => `<div class="job${changed.has(`jobs.${t}`) ? ' changed' : ''}"><span class="mono">${esc(t)}</span>${badge(v)}</div>`).join('')}</div>` : '<div class="empty">No jobs.</div>';
      if (scn.tests && scn.tests.length) html += `<div class="section-title">Proved by</div><div class="tests">${scn.tests.map((t) => `<span class="chip">${t}</span>`).join('')}</div>`;
      panes.step.innerHTML = html;
      setHighlight(st);
    }

    async function go(i, withAnim) {
      if (!scn) return;
      const n = scn.steps.length;
      if (i < -1 || i > n - 1) return;
      idx = i;
      const token = ++animToken;
      clearPackets();
      renderStep();
      if (!(right.querySelector('.tab.active')?.dataset.t === 'try')) showTab('step');
      const st = scn.steps[idx];
      if (!st) return;
      if (withAnim) await animate(st, token);
      else { drawTrail(st); }
    }

    async function play() {
      if (!scn) return;
      if (idx >= scn.steps.length - 1) go(-1, false);
      playing = true;
      btn('play').textContent = '❚❚ Pause';
      while (playing && idx < scn.steps.length - 1) {
        await go(idx + 1, true);
        if (!playing) break;
        const st = scn.steps[idx];
        const words = ((st.body || '') + (st.code || '')).length;
        await waitWhilePlaying((900 + Math.min(2600, words * 9)) / Number(speedSel.value));
      }
      stop();
    }
    async function waitWhilePlaying(ms) {
      const end = performance.now() + ms;
      while (playing && performance.now() < end) await sleep(60);
    }
    function stop() {
      playing = false;
      btn('play').textContent = '▶ Play';
    }

    function showNode(id) {
      const n = nodes.get(id);
      selectedNode = id;
      setHighlight(scn?.steps[idx]);
      const info = n.info || {};
      const uses = scn ? scn.steps.map((st, i) => [st, i]).filter(([st]) => [...stepPath(st), ...(st.also || [])].includes(id)) : [];
      let html = `<h4>${esc(n.label)}</h4>`;
      if (n.sub) html += `<div class="route">${esc(n.sub).replace(/\n/g, ' · ')}</div>`;
      html += `<div class="body">${info.does || '<p>No extra notes.</p>'}</div>`;
      if (info.file) html += `<div class="section-title">Code</div><div class="file">${[].concat(info.file).map((f) => `<code>${esc(f)}</code>`).join('<br>')}</div>`;
      if (info.tests) html += `<div class="section-title">Tests</div><div class="file">${[].concat(info.tests).map((f) => `<code>${esc(f)}</code>`).join('<br>')}</div>`;
      if (uses.length) {
        html += `<div class="section-title">In this scenario</div><div class="jobs">${uses.map(([st, i]) => `<button class="tl" data-jump="${i}"><span class="n">${i + 1}</span><span class="kind k-${st.kind}">${KIND_LABEL[st.kind]}</span><span>${st.label}</span></button>`).join('')}</div>`;
      }
      panes.node.innerHTML = html;
      panes.node.querySelectorAll('[data-jump]').forEach((b) => b.addEventListener('click', () => { stop(); go(Number(b.dataset.jump), true); }));
      showTab('node');
    }

    const fromHash = decodeURIComponent(location.hash.slice(1));
    select(scenarios.some((s) => s.id === fromHash) ? fromHash : scenarios[0].id, false);
  };
})();
