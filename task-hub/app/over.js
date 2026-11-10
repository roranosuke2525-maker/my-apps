  // ================= 俯瞰：夜空の中に立って、タスクの星を見渡す =================
  // 自分が真ん中に立ち、タスクは星としてまわりに浮かぶ。星座＝段（またはジャンル・場所）ごとの方角。
  // 近い星＝今日やる・新しいもの、遠い星＝長く動いていないもの。大きさ＝重さ、色＝段、遅れは赤い輪。
  // ドラッグで見回す、▲▼で歩く、星を押すと中身。canvas に自前で描く（外部の部品なし）
  const OV = { z: "stage", yaw: 0, pitch: 0.42, x: 0, zpos: 0, sel: "", target: null, walk: 0, idle: 0 };
  const OV_STAGES = ["today", "next", "plan", "inbox", "ai", "wait", "some"];
  const OV_Z = {
    stage: { name: "段", key: (t) => STAGES[stageOf(t)].name, order: () => OV_STAGES.map((k) => STAGES[k].name) },
    tag: { name: "ジャンル", key: (t) => t.tag || "なし" },
    waku: { name: "場所", key: (t) => t.waku || "枠なし", order: () => [...WAKU, "枠なし"] },
  };
  const cssv = (v) => { const m = /var\((--[\w-]+)\)/.exec(v || ""); return m ? getComputedStyle(document.documentElement).getPropertyValue(m[1]).trim() : v; };
  const hash01 = (s, salt) => { let h = 2166136261 ^ salt; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return ((h >>> 0) % 10000) / 10000; };
  function skyData() {
    const tasks = S.tasks.filter((t) => OV_STAGES.includes(stageOf(t)));
    const Z = OV_Z[OV.z] || OV_Z.stage; const cnt = new Map(); for (const t of tasks) cnt.set(Z.key(t), (cnt.get(Z.key(t)) || 0) + 1);
    let groups = Z.order ? Z.order().filter((g) => cnt.has(g)) : [...cnt.keys()].sort((a, b) => cnt.get(b) - cnt.get(a));
    let other = null; if (groups.length > 8) { other = new Set(groups.slice(7)); groups = [...groups.slice(0, 7), "ほか"]; }
    const gOf = (t) => (other?.has(Z.key(t)) ? "ほか" : Z.key(t));
    const n = Math.max(1, groups.length); const half = (Math.PI / n) * 0.78; const d = TODAY();
    const stars = tasks.map((t) => {
      const gi = groups.indexOf(gOf(t)); const st = stageOf(t); const late = st === "today" && t.date < d;
      const a = (gi / n) * Math.PI * 2 + (hash01(t.id, 1) * 2 - 1) * half;
      const r = st === "today" ? 5 + hash01(t.id, 2) * 4 : 9 + (Math.min(ageOf(t), 45) / 45) * 19 + hash01(t.id, 2) * 3;
      const el = (7 + hash01(t.id, 3) * 46) * (Math.PI / 180);
      return { t, gi, st, late, a, x: r * Math.cos(el) * Math.sin(a), y: r * Math.sin(el), z: r * Math.cos(el) * Math.cos(a), size: { S: 1, M: 1.35, L: 1.8, XL: 2.4 }[t.weight] || 1.2, col: cssv(STAGES[st].c) };
    });
    return { tasks, groups, stars, counts: groups.map((g, i) => stars.filter((s) => s.gi === i).length) };
  }
  function renderOver(view) {
    const D = skyData(); const sel = D.stars.find((s) => s.t.id === OV.sel); if (!sel) OV.sel = "";
    const late = D.stars.filter((s) => s.late).length; const old = D.stars.filter((s) => ageOf(s.t) >= 14 && s.st !== "some").length;
    view.insertAdjacentHTML("beforeend", `<div class="sky"><canvas id="ovcv" aria-label="タスクの夜空"></canvas>
      <div class="skytop"><div class="seg">${Object.entries(OV_Z).map(([k, z]) => `<button type="button" data-ovz="${k}" aria-pressed="${OV.z === k}">${z.name}</button>`).join("")}</div>
        <div class="skychips">${D.groups.map((g, i) => `<button type="button" class="qc" data-ovgo="${i}">${esc(g)}<small>${D.counts[i]}</small></button>`).join("")}</div></div>
      <div class="skywalk"><button type="button" data-ovwalk="1" aria-label="前へ歩く">▲</button><button type="button" data-ovhome="1" aria-label="真ん中に戻る">◎</button><button type="button" data-ovwalk="-1" aria-label="後ろへ下がる">▼</button></div>
      <div class="skybot swipey">${sel ? `<div class="skysel">${rowHtml(sel.t, 0, { meta: "weight" })}</div>` : `<p class="skyhint">星 ${D.stars.length}${late ? `・<em>遅れ ${late}</em>` : ""}${old ? `・2週間以上 ${old}` : ""}　ドラッグで見回す・▲▼で歩く・星を押すと中身<br>近い星＝今日や新しいもの　遠い星＝長く動いていないもの　大きさ＝重さ</p>`}</div></div>`);
    skyRun($("#ovcv"), D);
  }
  function skyRun(cv, D) {
    const g = cv.getContext("2d"); const ink = cssv("var(--ink)"), mute = cssv("var(--mute)"), lateC = cssv("var(--late)");
    const bg = Array.from({ length: 150 }, (_, i) => { const a = hash01(`b${i}`, 7) * Math.PI * 2, el = (hash01(`b${i}`, 8) * 1.5 - 0.25); return { x: Math.cos(el) * Math.sin(a), y: Math.sin(el), z: Math.cos(el) * Math.cos(a), m: 0.2 + hash01(`b${i}`, 9) * 0.5, p: hash01(`b${i}`, 10) * 6.28 }; });
    let W = 0, H = 0, f = 1, last = performance.now(), drag = null;
    const proj = (px, py, pz, noMove) => {
      const dx = noMove ? px : px - OV.x, dz = noMove ? pz : pz - OV.zpos; const cy = Math.cos(OV.yaw), sy = Math.sin(OV.yaw), cp = Math.cos(OV.pitch), sp = Math.sin(OV.pitch);
      const x1 = dx * cy - dz * sy, z1 = dx * sy + dz * cy; const y2 = py * cp - z1 * sp, z2 = py * sp + z1 * cp;
      return z2 > 0.2 ? [W / 2 + (f * x1) / z2, H * 0.56 - (f * y2) / z2, z2] : null;
    };
    const draw = (now) => {
      const r = cv.getBoundingClientRect(); const dpr = Math.min(3, window.devicePixelRatio || 1);
      if (cv.width !== Math.round(r.width * dpr) || cv.height !== Math.round(r.height * dpr)) { cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr); }
      W = r.width; H = r.height; f = Math.min(W, H) * 0.74; g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const sky = g.createLinearGradient(0, 0, 0, H); sky.addColorStop(0, "#05070d"); sky.addColorStop(0.7, "#0b1322"); sky.addColorStop(1, "#131c30"); g.fillStyle = sky; g.fillRect(0, 0, W, H);
      // 地平線と地面
      const hy = H * 0.56 + f * Math.tan(OV.pitch);
      if (hy < H + 40) { const gr = g.createLinearGradient(0, hy - 30, 0, hy + 60); gr.addColorStop(0, "rgba(120,150,200,0)"); gr.addColorStop(0.35, "rgba(120,150,200,.16)"); gr.addColorStop(0.36, "#080b12"); gr.addColorStop(1, "#05070b"); g.fillStyle = gr; g.fillRect(0, hy - 30, W, H - hy + 60); }
      // 遠くの小さな星（向きだけで動く）
      for (const b of bg) { const p = proj(b.x * 100, b.y * 100, b.z * 100, true); if (!p || p[1] > hy) continue; g.globalAlpha = b.m * (reduce ? 1 : 0.7 + 0.3 * Math.sin(now / 900 + b.p)); g.fillStyle = "#cfd8ea"; g.fillRect(p[0], p[1], 1.2, 1.2); }
      g.globalAlpha = 1;
      // 星を画面へ
      const vis = []; for (const s of D.stars) { const p = proj(s.x, s.y, s.z); if (p) vis.push({ s, x: p[0], y: p[1], z: p[2], r: Math.max(1.6, Math.min(20, (s.size * f * 0.035) / p[2] * 5)) }); }
      // 星座の線（同じ組を方角の順につなぐ）
      g.lineWidth = 1;
      for (let gi = 0; gi < D.groups.length; gi++) { const l = vis.filter((v) => v.s.gi === gi).sort((a, b) => a.s.a - b.s.a); if (l.length < 2) continue; g.strokeStyle = "rgba(170,190,230,.13)"; g.beginPath(); l.forEach((v, i) => (i ? g.lineTo(v.x, v.y) : g.moveTo(v.x, v.y))); g.stroke(); }
      // 星（遠い順）
      vis.sort((a, b) => b.z - a.z);
      for (const v of vis) {
        const a = Math.max(0.28, Math.min(1, 1.25 - v.z / 34)); const tw = reduce ? 1 : 0.85 + 0.15 * Math.sin(now / 600 + v.s.a * 9);
        const gl = g.createRadialGradient(v.x, v.y, 0, v.x, v.y, v.r * 3.2); gl.addColorStop(0, v.s.col); gl.addColorStop(1, "rgba(0,0,0,0)");
        g.globalAlpha = a * 0.38 * tw; g.fillStyle = gl; g.beginPath(); g.arc(v.x, v.y, v.r * 3.2, 0, 6.3); g.fill();
        g.globalAlpha = a; g.fillStyle = v.s.col; g.beginPath(); g.arc(v.x, v.y, v.r, 0, 6.3); g.fill();
        g.globalAlpha = a * 0.9; g.fillStyle = "#fff"; g.beginPath(); g.arc(v.x, v.y, v.r * 0.3, 0, 6.3); g.fill();
        if (v.s.late) { g.globalAlpha = reduce ? 0.9 : 0.5 + 0.5 * Math.sin(now / 300); g.strokeStyle = lateC; g.lineWidth = 1.6; g.beginPath(); g.arc(v.x, v.y, v.r + 4, 0, 6.3); g.stroke(); }
        if (v.s.t.id === OV.sel) { g.globalAlpha = 1; g.strokeStyle = ink; g.lineWidth = 1.6; g.beginPath(); g.arc(v.x, v.y, v.r + 7, 0, 6.3); g.stroke(); }
      }
      g.globalAlpha = 1;
      // 名前：正面・近くの星だけ
      const lab = vis.filter((v) => v.x > 20 && v.x < W - 20 && v.y > 70 && v.y < H - 70).map((v) => ({ v, k: Math.hypot(v.x - W / 2, v.y - H * 0.5) + v.z * 7 - (v.s.t.id === OV.sel ? 1e4 : 0) })).sort((a, b) => a.k - b.k).slice(0, 7);
      g.font = "11px 'Zen Kaku Gothic New', sans-serif"; g.textAlign = "center"; g.textBaseline = "top";
      for (const { v } of lab) { const nm = v.s.t.name.length > 13 ? `${v.s.t.name.slice(0, 13)}…` : v.s.t.name; g.globalAlpha = v.s.t.id === OV.sel ? 1 : Math.max(0.45, Math.min(0.95, 1.2 - v.z / 26)); g.fillStyle = "rgba(5,7,13,.55)"; const tw2 = g.measureText(nm).width; g.fillRect(v.x - tw2 / 2 - 3, v.y + v.r + 5, tw2 + 6, 15); g.fillStyle = ink; g.fillText(nm, v.x, v.y + v.r + 7); }
      // 星座の名前（方角の目印）
      g.font = "600 12px 'Zen Kaku Gothic New', sans-serif"; g.textBaseline = "middle";
      D.groups.forEach((gr, i) => { const a = (i / D.groups.length) * Math.PI * 2; const p = proj(Math.sin(a) * 60 * Math.cos(1.0), 60 * Math.sin(1.0), Math.cos(a) * 60 * Math.cos(1.0), true); if (!p) return; g.globalAlpha = 0.55; g.fillStyle = OV.z === "stage" ? cssv(STAGES[OV_STAGES.find((k) => STAGES[k].name === gr)]?.c || "var(--mute)") : mute; g.fillText(`${gr} ${D.counts[i]}`, p[0], Math.max(64, p[1])); });
      g.globalAlpha = 1;
      cv._stars = vis;
    };
    const tick = (now) => {
      if (!cv.isConnected) return; const dt = Math.min(0.05, (now - last) / 1000); last = now;
      if (OV.walk) { const nx = OV.x + Math.sin(OV.yaw) * OV.walk * 7 * dt, nz = OV.zpos + Math.cos(OV.yaw) * OV.walk * 7 * dt; if (Math.hypot(nx, nz) < 26) { OV.x = nx; OV.zpos = nz; } OV.idle = 0; }
      if (OV.target != null) { let d = OV.target - OV.yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); if (Math.abs(d) < 0.004) { OV.yaw = OV.target; OV.target = null; } else OV.yaw += d * Math.min(1, dt * 6); OV.idle = 0; }
      else if (!drag && !OV.sel && !reduce) { OV.idle += dt; if (OV.idle > 5) OV.yaw += 0.025 * dt; }
      draw(now); if (!reduce || OV.walk || OV.target != null) requestAnimationFrame(tick); else cv._wake = () => { last = performance.now(); requestAnimationFrame(tick); };
    };
    const wake = () => { if (cv._wake) { const w = cv._wake; cv._wake = null; w(); } };
    cv.addEventListener("pointerdown", (e) => { drag = { x: e.clientX, y: e.clientY, yaw: OV.yaw, pitch: OV.pitch, moved: false }; OV.target = null; OV.idle = 0; try { cv.setPointerCapture(e.pointerId); } catch { /* 無視 */ } });
    cv.addEventListener("pointermove", (e) => { if (!drag) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y; if (!drag.moved && Math.hypot(dx, dy) < 6) return; drag.moved = true; OV.yaw = drag.yaw - dx * 0.0045; OV.pitch = Math.max(-0.15, Math.min(1.35, drag.pitch + dy * 0.0045)); wake(); if (reduce) draw(performance.now()); });
    cv.addEventListener("pointerup", (e) => {
      if (!drag) return; const moved = drag.moved; drag = null; OV.idle = 0; if (moved) return;
      const r = cv.getBoundingClientRect(); const x = e.clientX - r.left, y = e.clientY - r.top; let best = null;
      for (const v of cv._stars || []) { const d = Math.hypot(v.x - x, v.y - y); if (d < Math.max(18, v.r + 10) && (!best || d < best.d)) best = { v, d }; }
      const id = best ? best.v.s.t.id : ""; if (id === OV.sel && !id) return; OV.sel = id === OV.sel ? "" : id; buzz(8); render();
    });
    cv.addEventListener("pointercancel", () => { drag = null; });
    cv.addEventListener("wheel", (e) => { e.preventDefault(); const k = -e.deltaY * 0.02; const nx = OV.x + Math.sin(OV.yaw) * k, nz = OV.zpos + Math.cos(OV.yaw) * k; if (Math.hypot(nx, nz) < 26) { OV.x = nx; OV.zpos = nz; } OV.idle = 0; wake(); if (reduce) draw(performance.now()); }, { passive: false });
    for (const b of document.querySelectorAll("[data-ovwalk]")) {
      const on = (e) => { e.preventDefault(); OV.walk = Number(b.dataset.ovwalk); wake(); }; const off = () => { OV.walk = 0; };
      b.addEventListener("pointerdown", on); b.addEventListener("pointerup", off); b.addEventListener("pointerleave", off); b.addEventListener("pointercancel", off);
    }
    cv._face = (i) => { const a = (i / D.groups.length) * Math.PI * 2; OV.target = Math.atan2(Math.sin(a) * 15 - OV.x, Math.cos(a) * 15 - OV.zpos); if (OV.pitch < 0.25 || OV.pitch > 0.7) OV.pitch = 0.42; wake(); };
    cv._redraw = () => { wake(); if (reduce) draw(performance.now()); };
    OV.walk = 0; requestAnimationFrame(tick);
  }
