  // ================= 俯瞰：タスク全体を立体の柱で見る =================
  // 横＝流れの段（収集→AI→次にやる→予定→今日→待ち→いつか）、奥行き＝ジャンルなど、高さ＝件数など。
  // ドラッグで回す、柱を押すと中身の一覧。外部の部品は使わず canvas に自分で描く
  const OV = { z: "tag", h: "count", yaw: -0.62, pitch: 0.6, sel: "", grow: 1 };
  const OV_STAGES = ["inbox", "ai", "next", "plan", "today", "wait", "some"];
  const OV_Z = {
    tag: { name: "ジャンル", key: (t) => t.tag || "なし" },
    waku: { name: "場所", key: (t) => t.waku || "枠なし", order: () => [...WAKU, "枠なし"] },
    weight: { name: "重さ", key: (t) => t.weight || "なし", order: () => ["S", "M", "L", "XL", "なし"] },
    age: { name: "滞留", key: (t) => (AGE_G.find(([, a, b]) => ageOf(t) >= a && ageOf(t) <= b) || AGE_G[4])[0], order: () => AGE_G.map((g) => g[0]) },
  };
  const OV_H = {
    count: { name: "件数", val: (l) => l.length, fmt: (v) => `${v}` },
    weight: { name: "重さ", val: (l) => load8(l), fmt: (v) => `${v}` },
    age: { name: "古さ", val: (l) => (l.length ? Math.round(l.reduce((a, t) => a + ageOf(t), 0) / l.length) : 0), fmt: (v) => `${v}日` },
  };
  const cssv = (v) => { const m = /var\((--[\w-]+)\)/.exec(v || ""); return m ? getComputedStyle(document.documentElement).getPropertyValue(m[1]).trim() : v; };
  function overData() {
    const tasks = S.tasks.filter((t) => OV_STAGES.includes(stageOf(t)));
    const Z = OV_Z[OV.z]; const cnt = new Map(); for (const t of tasks) cnt.set(Z.key(t), (cnt.get(Z.key(t)) || 0) + 1);
    let groups = Z.order ? Z.order().filter((g) => cnt.has(g)) : [...cnt.keys()].sort((a, b) => cnt.get(b) - cnt.get(a));
    let other = null; if (groups.length > 7) { other = new Set(groups.slice(6)); groups = [...groups.slice(0, 6), "ほか"]; }
    const gOf = (t) => (other?.has(Z.key(t)) ? "ほか" : Z.key(t));
    const cells = []; let max = 0;
    OV_STAGES.forEach((st, i) => groups.forEach((g, j) => { const list = tasks.filter((t) => stageOf(t) === st && gOf(t) === g); const v = OV_H[OV.h].val(list); if (v > max) max = v; cells.push({ i, j, st, g, list, v, id: `${st}|${g}` }); }));
    return { tasks, groups, cells, max: max || 1 };
  }
  function renderOver(view) {
    const D = overData(); const sel = D.cells.find((c) => c.id === OV.sel && c.list.length); if (!sel) OV.sel = "";
    const byStage = OV_STAGES.map((st) => [st, D.tasks.filter((t) => stageOf(t) === st)]);
    const top = D.cells.filter((c) => c.list.length).sort((a, b) => b.v - a.v).slice(0, 3);
    const old = D.tasks.filter((t) => ageOf(t) >= 14 && ["next", "inbox", "wait"].includes(stageOf(t))).length;
    view.insertAdjacentHTML("beforeend", `<div class="ovctl"><div class="seg">${Object.entries(OV_Z).map(([k, z]) => `<button type="button" data-ovz="${k}" aria-pressed="${OV.z === k}">${z.name}</button>`).join("")}</div><div class="seg">${Object.entries(OV_H).map(([k, h]) => `<button type="button" data-ovh="${k}" aria-pressed="${OV.h === k}">高さ：${h.name}</button>`).join("")}</div></div>
      <div class="card ovcard"><canvas id="ovcv" aria-label="タスク全体の立体グラフ"></canvas><div class="ovlegend">${byStage.map(([st, l]) => `<span style="--c:${STAGES[st].c}"><i></i>${STAGES[st].name}<b>${l.length}</b></span>`).join("")}</div><p class="ovhint mute">ドラッグで回す・柱を押すと中身</p></div>
      <div class="card panel"><div class="scroll swipey" id="ovlist"></div></div>`);
    const box = $("#ovlist");
    if (sel) box.innerHTML = `<div class="sech"><span>${esc(STAGES[sel.st].name)} × ${esc(sel.g)}</span><small>${sel.list.length}</small><button type="button" class="qc" data-ovclear="1">選択を外す</button></div>${sel.list.slice().sort((a, b) => ageOf(b) - ageOf(a)).map((t, i) => rowHtml(t, i, { meta: "weight" })).join("")}`;
    else box.innerHTML = `<div class="rules"><b>全体 ${D.tasks.length}件・重さ ${load8(D.tasks)}</b>${top.length ? `いちばん高い柱：${top.map((c) => `${STAGES[c.st].name}×${c.g}（${OV_H[OV.h].fmt(c.v)}）`).join("、")}。` : ""}${old ? `2週間以上動いていない 収集・次にやる・待ち が ${old}件。` : ""}柱を押すと、その中身がここに並びます。</div>${top.map((c) => `<div class="sech"><span>${esc(STAGES[c.st].name)} × ${esc(c.g)}</span><small>${c.list.length}</small><button type="button" class="qc" data-ovsel="${esc(c.id)}">見る</button></div>`).join("")}`;
    const cv = $("#ovcv"); overBind(cv, D);
    if (view.classList.contains("warp")) { OV.grow = 0; const t0 = performance.now(); const step = (now) => { if (!cv.isConnected) return; OV.grow = Math.min(1, (now - t0) / 650); OV.grow = 1 - Math.pow(1 - OV.grow, 3); overDraw(cv, D); if (OV.grow < 1) requestAnimationFrame(step); }; requestAnimationFrame(step); }
    else { OV.grow = 1; overDraw(cv, D); }
  }
  // 立体 → 画面（回転 yaw・見下ろし pitch の平行投影）
  function overDraw(cv, D) {
    const r = cv.getBoundingClientRect(); const dpr = Math.min(3, window.devicePixelRatio || 1);
    if (cv.width !== Math.round(r.width * dpr)) { cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr); }
    const g = cv.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, r.width, r.height);
    const nx = OV_STAGES.length, nz = D.groups.length, H = 3.2; const cy = Math.cos(OV.yaw), sy = Math.sin(OV.yaw), cp = Math.cos(OV.pitch), sp = Math.sin(OV.pitch);
    // 箱全体（地面＋いちばん高い柱＋見出しの余白）が入る大きさと位置を決める
    const raw = (x, y, z) => { const xr = x * cy - z * sy, zr = x * sy + z * cy; return [xr, -y * cp - zr * sp, zr]; };
    const ex = nx / 2 + 0.5, ez = nz / 2 + 0.5; const cs = [];
    for (const x of [-ex, ex]) for (const z of [-ez, ez]) for (const y of [0, H]) cs.push(raw(x, y, z));
    const minX = Math.min(...cs.map((c) => c[0])), maxX = Math.max(...cs.map((c) => c[0])), minY = Math.min(...cs.map((c) => c[1])), maxY = Math.max(...cs.map((c) => c[1]));
    const scale = Math.min((r.width - 64) / (maxX - minX), (r.height - 40) / (maxY - minY));
    const ox = r.width / 2 - ((minX + maxX) / 2) * scale, oy = r.height / 2 - ((minY + maxY) / 2) * scale + 4;
    const P = (x, y, z) => { const q = raw(x, y, z); return [ox + q[0] * scale, oy + q[1] * scale, q[2]]; };
    const ink = cssv("var(--ink)"), mute = cssv("var(--mute)"), line = cssv("var(--line)");
    const poly = (pts, fill, shade, stroke) => { g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); if (fill) { g.fillStyle = fill; g.fill(); } if (shade) { g.fillStyle = `rgba(0,0,0,${shade})`; g.fill(); } if (stroke) { g.strokeStyle = stroke; g.lineWidth = 1; g.stroke(); } };
    // 地面とマス目
    const x0 = -nx / 2, z0 = -nz / 2;
    poly([P(x0, 0, z0), P(-x0, 0, z0), P(-x0, 0, -z0), P(x0, 0, -z0)], cssv("var(--sunk)"), 0, line);
    g.strokeStyle = line; g.lineWidth = 1; g.beginPath();
    for (let i = 1; i < nx; i++) { const a = P(x0 + i, 0, z0), b = P(x0 + i, 0, -z0); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); }
    for (let j = 1; j < nz; j++) { const a = P(x0, 0, z0 + j), b = P(-x0, 0, z0 + j); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); }
    g.stroke();
    // 柱（遠い順に描く）
    const hits = []; const pad = 0.16;
    const bars = D.cells.filter((c) => c.v > 0).map((c) => ({ c, d: P(x0 + c.i + 0.5, 0, z0 + c.j + 0.5)[2] })).sort((a, b) => b.d - a.d);
    for (const { c } of bars) {
      const h = Math.max(0.06, (c.v / D.max) * H * OV.grow); const col = cssv(STAGES[c.st].c);
      const xa = x0 + c.i + pad, xb = x0 + c.i + 1 - pad, za = z0 + c.j + pad, zb = z0 + c.j + 1 - pad;
      const polys = [];
      const side = (p1, p2, shade) => { const pts = [P(p1[0], 0, p1[1]), P(p2[0], 0, p2[1]), P(p2[0], h, p2[1]), P(p1[0], h, p1[1])]; poly(pts, col, shade); polys.push(pts); };
      if (sy < 0) side([xb, za], [xb, zb], 0.38); else side([xa, za], [xa, zb], 0.38);
      if (cy > 0) side([xa, za], [xb, za], 0.2); else side([xa, zb], [xb, zb], 0.2);
      const topP = [P(xa, h, za), P(xb, h, za), P(xb, h, zb), P(xa, h, zb)]; poly(topP, col, 0, OV.sel === c.id ? ink : null); polys.push(topP);
      if (OV.sel === c.id) { g.lineWidth = 2; g.strokeStyle = ink; g.stroke(); }
      hits.push({ c, polys });
      if (OV.grow >= 1) { const m = P((xa + xb) / 2, h, (za + zb) / 2); g.fillStyle = ink; g.font = "600 10px Inter, sans-serif"; g.textAlign = "center"; g.textBaseline = "bottom"; g.fillText(OV_H[OV.h].fmt(c.v), m[0], m[1] - 2); }
    }
    // 見出し（手前の辺に）
    g.textBaseline = "middle"; g.font = "10px 'Zen Kaku Gothic New', sans-serif";
    const zEdge = cy > 0 ? z0 - 0.45 : -z0 + 0.45, xEdge = sy < 0 ? -x0 + 0.45 : x0 - 0.45;
    OV_STAGES.forEach((st, i) => { const p = P(x0 + i + 0.5, 0, zEdge); g.fillStyle = cssv(STAGES[st].c); g.textAlign = "center"; g.fillText(STAGES[st].name, p[0], p[1] + 6); });
    D.groups.forEach((gr, j) => { const p = P(xEdge, 0, z0 + j + 0.5); g.fillStyle = mute; g.textAlign = p[0] > ox ? "left" : "right"; g.fillText(String(gr).slice(0, 8), p[0] + (p[0] > ox ? 4 : -4), p[1]); });
    cv._hits = hits;
  }
  function overBind(cv, D) {
    let d = null;
    const inPoly = (pts, x, y) => { let ins = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const [xi, yi] = pts[i], [xj, yj] = pts[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) ins = !ins; } return ins; };
    cv.addEventListener("pointerdown", (e) => { d = { x: e.clientX, y: e.clientY, yaw: OV.yaw, pitch: OV.pitch, moved: false }; try { cv.setPointerCapture(e.pointerId); } catch { /* 無視 */ } });
    cv.addEventListener("pointermove", (e) => { if (!d) return; const dx = e.clientX - d.x, dy = e.clientY - d.y; if (!d.moved && Math.hypot(dx, dy) < 6) return; d.moved = true; OV.yaw = d.yaw + dx * 0.01; OV.pitch = Math.max(0.25, Math.min(1.25, d.pitch + dy * 0.006)); overDraw(cv, D); });
    const up = (e) => {
      if (!d) return; const moved = d.moved; d = null; if (moved) return;
      const r = cv.getBoundingClientRect(); const x = e.clientX - r.left, y = e.clientY - r.top; const hits = cv._hits || [];
      for (let i = hits.length - 1; i >= 0; i--) if (hits[i].polys.some((p) => inPoly(p, x, y))) { OV.sel = OV.sel === hits[i].c.id ? "" : hits[i].c.id; buzz(8); render(); return; }
      if (OV.sel) { OV.sel = ""; render(); }
    };
    cv.addEventListener("pointerup", up); cv.addEventListener("pointercancel", () => { d = null; });
  }
