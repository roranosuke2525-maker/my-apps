// 劇の立ち絵を WebGL の網目（メッシュ）で描いて、なめらかに動かす（Live2D 風）。
// 息づかい・体のゆれ・髪やマントのはためき・話すときのうなずき・表情の切り替え（ふわっと入れ替え）・跳ねる動き。
// しぐさ：前のめり（lean）・首かしげ（tilt）・つぶれ伸び（squash）・向き（turn）・歩く（walk）・ふるえ（shake）。
// 目標の姿勢へばねのように追いつくので、動きがつながる。
// 立ち絵の置き場所と大きさは、これまでどおり .actor の要素（CSS）が決める。ここはその四角の中を描くだけ。
//   const gl = createActorGL(canvas)  … 使えなければ null（そのときは <img> のまま）。立ち絵の位置は canvas からの相対で測る
//   gl.add(el, img, { float, boss, stance }) / gl.remove(el)（stance：格闘ゲームの構えでその場に弾む） / gl.talk(el, on) / gl.hop(el) / gl.destroy()
//   gl.pose(el, { lean, tilt, turn, slump }) / gl.emote(el, "surprised"|"angry"|"sad"|"smile") / gl.walk(el, ms)
//   gl.act(el, "idle"|"run"|"windup"|"strike"|"jump"|"cast"|"hit"|"talk", ms?) … 関節の動き（下を参照）
// canvas が画面から外されると、自分で片づける（あいぼう・ボスの大きな絵にも使う）
//
// 関節（rig）：1枚の立ち絵を、人の体のつくり（腰・ひざ・肩・ひじ・首）に見立てて部分ごとに回す。
// 人物の枠（絵の中で人物がいる四角）を絵から測り、その中の割合で関節の位置を決める（正面向きの立ち絵を前提）。
// 角度は、プラスで手先・足先が右（ボスのほう）へ動く。関節はばねで目標に追いつくので、動きに勢いと余韻が出る。
// 胸（chest）：体の上下・左右の動きに遅れてついてくる、ばねの揺れ

const GRID_X = 18;
const GRID_Y = 28;

const VS = `
attribute vec2 a_p;
uniform vec4 u_rect;
uniform float u_t, u_phase, u_breath, u_sway, u_talk, u_hop, u_flutter;
uniform float u_lean, u_tilt, u_squash, u_turn, u_bob, u_shake, u_slump, u_stance;
uniform vec4 u_fig;
uniform float u_rig, u_legL, u_legR, u_kneeL, u_kneeR, u_armL, u_armR, u_elbL, u_elbR, u_head, u_twist;
uniform vec2 u_jig, u_chest;
uniform float u_jigOn;
uniform float u_tempo, u_bounce, u_shift;
varying vec2 v_uv;
varying float v_shade;
vec2 F(vec2 f) { return u_fig.xy + f * (u_fig.zw - u_fig.xy); }
vec2 rot(vec2 q, vec2 c, float a) { vec2 d = q - c; float s = sin(a), k = cos(a); return c + vec2(d.x * k - d.y * s, d.x * s + d.y * k); }
void main() {
  vec2 p = a_p;
  vec2 f = (a_p - u_fig.xy) / max(vec2(0.001), u_fig.zw - u_fig.xy);
  float figH = u_fig.w - u_fig.y;
  // ---- 関節（子から親の順に回す：ひざ→腰、ひじ→肩、首）----
  float sideL = 1.0 - smoothstep(0.44, 0.56, f.x);
  float sideR = 1.0 - sideL;
  float legW = 1.0 - smoothstep(0.40, 0.50, f.y);
  float kneeW = 1.0 - smoothstep(0.19, 0.27, f.y);
  p = mix(p, rot(p, F(vec2(0.42, 0.24)), u_kneeL), kneeW * sideL * u_rig);
  p = mix(p, rot(p, F(vec2(0.58, 0.24)), u_kneeR), kneeW * sideR * u_rig);
  p = mix(p, rot(p, F(vec2(0.44, 0.47)), u_legL), legW * sideL * u_rig);
  p = mix(p, rot(p, F(vec2(0.56, 0.47)), u_legR), legW * sideR * u_rig);
  float ax = abs(f.x - 0.5);
  float armBand = smoothstep(0.38, 0.47, f.y) * (1.0 - smoothstep(0.77, 0.83, f.y));
  float armW = smoothstep(0.13, 0.21, ax) * armBand;
  float lowW = armW * (1.0 - smoothstep(0.53, 0.61, f.y));
  float aL = 1.0 - step(0.5, f.x), aR = 1.0 - aL;
  p = mix(p, rot(p, F(vec2(0.29, 0.58)), u_elbL), lowW * aL * u_rig);
  p = mix(p, rot(p, F(vec2(0.71, 0.58)), u_elbR), lowW * aR * u_rig);
  p = mix(p, rot(p, F(vec2(0.33, 0.79)), u_armL), armW * aL * u_rig);
  p = mix(p, rot(p, F(vec2(0.67, 0.79)), u_armR), armW * aR * u_rig);
  float headJ = smoothstep(0.80, 0.87, f.y);
  p = mix(p, rot(p, F(vec2(0.5, 0.83)), u_head), headJ * u_rig);
  // 胴のひねり（立体に見せる：上半身の幅を少し詰め、向いた側へずらし、陰をつける）
  float upper = smoothstep(0.40, 0.56, f.y) * u_rig;
  float cx = F(vec2(0.5, 0.0)).x;
  p.x = mix(p.x, cx + (p.x - cx) * (1.0 - 0.14 * abs(u_twist)) + u_twist * 0.025 * figH, upper);
  v_shade = 1.0 + 0.18 * u_twist * (f.x - 0.5) * 2.0 * upper;
  // 胸の揺れ
  vec2 cd = (f - u_chest) / vec2(0.13, 0.055);
  p += u_jig * figH * exp(-dot(cd, cd)) * u_jigOn;
  float up = smoothstep(0.12, 1.0, p.y);
  // 向き：胴を少し細くして、横を向いたように見せる
  p.x = 0.5 + (p.x - 0.5) * (1.0 - 0.10 * abs(u_turn));
  // 前のめり・のけぞり：上にいくほど横へ。しょんぼり：肩から上を少し下げて前へ
  float body = up * up;
  p.x += u_lean * 0.07 * body;
  p.y -= u_slump * 0.03 * body;
  p.x += u_slump * 0.02 * body;
  // 首かしげ：首から上を回す
  float headW = smoothstep(0.66, 0.90, a_p.y);
  vec2 piv = vec2(0.5, 0.70);
  float ang = u_tilt * 0.14 * headW;
  vec2 d = p - piv;
  p = piv + vec2(d.x * cos(ang) - d.y * sin(ang), d.x * sin(ang) + d.y * cos(ang)) * headW + d * (1.0 - headW);
  // つぶれ・伸び（足元を軸に）
  p.y *= 1.0 + u_squash;
  p.x = 0.5 + (p.x - 0.5) * (1.0 - u_squash * 0.6);
  // 歩く：上下に弾み、左右の足が交互に出るように少し傾く
  p.y += u_bob * 0.012 * abs(sin(u_t * 9.0)) * up;
  p.x += u_bob * 0.012 * sin(u_t * 9.0) * body;
  // ふるえ
  p.x += u_shake * 0.008 * sin(u_t * 60.0) * up;
  // 構え（格闘ゲームの待機）：足は地面につけたまま、ひざを曲げて体ごと沈む→戻る、をリズムよく。
  // ひざから上は伸び縮みさせず、まとめて動かす（拡大して見えないように）
  float knee = mix(smoothstep(0.06, 0.34, a_p.y), smoothstep(0.08, 0.30, f.y), u_rig);
  float beat = 0.5 - 0.5 * cos(u_t * u_tempo + u_phase);
  p.y -= u_stance * 0.022 * u_bounce * beat * knee;
  p.x += u_stance * 0.010 * u_bounce * beat * knee;
  // 体重の移しかた：弾みの半分のはやさで左右に
  p.x += u_stance * 0.010 * u_shift * sin(u_t * u_tempo * 0.27 + u_phase) * knee;
  p.x += u_stance * 0.006 * sin(u_t * u_tempo * 0.5 + u_phase) * smoothstep(0.55, 0.9, a_p.y);
  float s = sin(u_t * 1.7 + u_phase);
  float chest = exp(-pow((p.y - 0.62) / 0.18, 2.0));
  p.x = 0.5 + (p.x - 0.5) * (1.0 + u_breath * 0.018 * s * chest);
  p.y += u_breath * 0.007 * s * up;
  p.x += u_sway * 0.013 * sin(u_t * 0.8 + u_phase) * up * up;
  float head = smoothstep(0.68, 0.95, a_p.y);
  p.y += u_talk * 0.005 * abs(sin(u_t * 7.0)) * head;
  p.x += u_talk * 0.004 * sin(u_t * 3.1) * head;
  float edge = abs(a_p.x - 0.5) * 2.0;
  p.x += u_flutter * 0.010 * sin(u_t * 2.6 + a_p.y * 7.0 + u_phase) * up * edge * edge;
  p.y += u_hop;
  v_uv = vec2(a_p.x, 1.0 - a_p.y);
  gl_Position = vec4(u_rect.x + p.x * u_rect.z, u_rect.y + p.y * u_rect.w, 0.0, 1.0);
}`;

const FS = `
precision mediump float;
uniform sampler2D u_a, u_b;
uniform float u_mix, u_bright, u_sat, u_alpha, u_shadow;
varying vec2 v_uv;
varying float v_shade;
void main() {
  if (u_shadow > 0.5) {
    vec2 d = (v_uv - vec2(0.5, 0.97)) * vec2(2.2, 14.0);
    gl_FragColor = vec4(0.0, 0.0, 0.0, 0.35 * u_alpha * smoothstep(1.0, 0.0, length(d)));
    return;
  }
  vec4 c = mix(texture2D(u_a, v_uv), texture2D(u_b, v_uv), u_mix);
  float g = dot(c.rgb, vec3(0.3, 0.59, 0.11));
  c.rgb = mix(vec3(g), c.rgb, u_sat) * u_bright * v_shade;
  gl_FragColor = c * u_alpha;
}`;

export function createActorGL(canvas) {
  const gl = canvas.getContext("webgl", { premultipliedAlpha: true, alpha: true, antialias: true });
  if (!gl) return null;
  const compile = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  let prog;
  try {
    prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
  } catch {
    return null;
  }
  gl.useProgram(prog);
  const U = {};
  for (const n of ["u_rect", "u_t", "u_phase", "u_breath", "u_sway", "u_talk", "u_hop", "u_flutter", "u_a", "u_b", "u_mix", "u_bright", "u_sat", "u_alpha", "u_shadow",
    "u_lean", "u_tilt", "u_squash", "u_turn", "u_bob", "u_shake", "u_slump", "u_stance",
    "u_fig", "u_rig", "u_legL", "u_legR", "u_kneeL", "u_kneeR", "u_armL", "u_armR", "u_elbL", "u_elbR", "u_head", "u_twist", "u_jig", "u_chest", "u_jigOn", "u_tempo", "u_bounce", "u_shift"]) U[n] = gl.getUniformLocation(prog, n);

  // 網目：(GRID_X+1)×(GRID_Y+1) の点と三角形
  const pts = [];
  for (let y = 0; y <= GRID_Y; y++) for (let x = 0; x <= GRID_X; x++) pts.push(x / GRID_X, y / GRID_Y);
  const idx = [];
  for (let y = 0; y < GRID_Y; y++) {
    for (let x = 0; x < GRID_X; x++) {
      const i = y * (GRID_X + 1) + x;
      idx.push(i, i + 1, i + GRID_X + 1, i + 1, i + GRID_X + 2, i + GRID_X + 1);
    }
  }
  const vbuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pts), gl.STATIC_DRAW);
  const ibuf = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibuf);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, "a_p");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  gl.uniform1i(U.u_a, 0);
  gl.uniform1i(U.u_b, 1);
  const empty = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, empty);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));

  const texCache = new Map();
  const imgCache = new Map(); // 差分の絵（口・まばたき・手ぶり）：URL → Image
  function loadImg(url) {
    if (!imgCache.has(url)) {
      const im = new Image();
      im.decoding = "async";
      im.src = url;
      imgCache.set(url, im);
    }
    return imgCache.get(url);
  }
  const readyImg = (im) => im && im.complete && im.naturalWidth > 0;
  function texOf(img) {
    const key = img.currentSrc || img.src;
    if (texCache.has(key)) return texCache.get(key);
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    texCache.set(key, t);
    return t;
  }

  // 絵の中で人物がいる四角（網目の座標・下が0）。小さく描いて不透明なところを探す
  const figCache = new Map();
  const probe = document.createElement("canvas");
  probe.width = probe.height = 64;
  const pctx = probe.getContext("2d", { willReadFrequently: true });
  function figOf(img) {
    const key = img.currentSrc || img.src;
    if (figCache.has(key)) return figCache.get(key);
    let box = [0, 0, 1, 1];
    try {
      pctx.clearRect(0, 0, 64, 64);
      pctx.drawImage(img, 0, 0, 64, 64);
      const d = pctx.getImageData(0, 0, 64, 64).data;
      let x0 = 64, y0 = 64, x1 = -1, y1 = -1;
      for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
        if (d[(y * 64 + x) * 4 + 3] > 40) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      }
      if (x1 >= 0) box = [x0 / 64, 1 - (y1 + 1) / 64, (x1 + 1) / 64, 1 - y0 / 64];
    } catch { /* 読めない絵は全体を人物とみなす */ }
    figCache.set(key, box);
    return box;
  }

  // 関節の目標（動きの種類と、その動きが始まってからの時間 u で決める）
  const FID0 = { armL: 0, armR: 0, elbL: 0, elbR: 0, head: 0 };
  const PERSONA0 = { tempo: 10, bounce: 1, shift: 0.6, sway: 0.6, arms: 0.08, lean: 0, tilt: 0, fidget: 1 };
  const JOINTS = ["legL", "legR", "kneeL", "kneeR", "armL", "armR", "elbL", "elbR", "head", "twist"];
  function targetsOf(a, t) {
    const m = a.act.mode, u = t - a.act.t0, ph = a.phase;
    const s1 = Math.sin(t * 1.6 + ph), s2 = Math.sin(t * 2.3 + ph * 1.7);
    const P = a.persona;
    const beat = a.stance ? 0.5 - 0.5 * Math.cos(t * P.tempo + ph) : 0;
    const sh = Math.sin(t * P.tempo * 0.27 + ph);
    // ふだん：腕は体の横で揺れ、ひざは構えのリズムで曲がる。体重を移す側のひざが深く曲がる（人ごとの個性つき）
    const fid = a.fidgetJ;
    const g = {
      legL: -0.05 - 0.04 * P.shift * sh, legR: 0.05 - 0.04 * P.shift * sh,
      kneeL: -0.12 * P.bounce * beat - 0.08 * P.shift * Math.max(0, sh), kneeR: -0.12 * P.bounce * beat - 0.08 * P.shift * Math.max(0, -sh),
      armL: -P.arms + 0.04 * P.sway * s1 + fid.armL, armR: P.arms - 0.04 * P.sway * s2 + fid.armR,
      elbL: 0.06 * s2 + fid.elbL, elbR: -0.06 * s1 + fid.elbR,
      head: 0.04 * P.sway * s1 + P.tilt * 0.3 + fid.head, twist: a.stance ? 0.25 + 0.08 * P.sway * Math.sin(t * 0.9 + ph) : 0,
    };
    // 角度は控えめに（1枚の絵を曲げるので、大きく回すとマントや服が裂けたように見える）
    if (m === "run") {
      const c = Math.sin(u * 14);
      Object.assign(g, { legL: 0.32 * c, legR: -0.32 * c, kneeL: -0.55 * Math.max(0, -c), kneeR: -0.55 * Math.max(0, c), armL: -0.3 * c, armR: 0.3 * c, elbL: 0.3, elbR: 0.3, head: 0.05, twist: 0.4 });
    } else if (m === "windup") {
      Object.assign(g, { legL: 0.2, legR: -0.2, kneeL: -0.12, kneeR: -0.3, armL: 0.3, armR: -1.15, elbR: -0.45, elbL: 0.25, head: 0.1, twist: -0.5 });
    } else if (m === "strike") {
      Object.assign(g, { legL: 0.32, legR: -0.3, kneeL: -0.08, kneeR: -0.25, armL: -0.35, armR: 0.95, elbR: 0.15, elbL: -0.2, head: -0.08, twist: 0.6 });
    } else if (m === "jump") {
      Object.assign(g, { legL: 0.35, legR: 0.12, kneeL: -0.8, kneeR: -0.9, armL: -1.0, armR: 1.0, elbL: -0.25, elbR: 0.25, head: -0.08, twist: 0.1 });
    } else if (m === "cast") {
      Object.assign(g, { legL: 0.22, legR: -0.18, kneeR: -0.2, armL: 0.45, armR: 1.2, elbL: 0.2, elbR: -0.3, head: -0.08, twist: 0.4 });
    } else if (m === "hit") {
      Object.assign(g, { legL: -0.12, legR: 0.14, kneeL: -0.25, kneeR: -0.12, armL: -0.5, armR: 0.5, elbL: -0.3, elbR: 0.3, head: -0.18, twist: -0.35 });
    } else if (m === "talk") {
      Object.assign(g, { armR: 0.18 + 0.1 * Math.sin(u * 3.2), elbR: 0.35 + 0.2 * Math.sin(u * 4.1), armL: -0.1 + 0.04 * s1, head: 0.06 * Math.sin(u * 2.4) });
    }
    return g;
  }

  const actors = new Map();
  let raf = 0;
  let last = performance.now();
  const ease = (cur, target, dt, speed) => cur + (target - cur) * (1 - Math.exp(-dt * speed));

  let seen = false;
  const born = performance.now();
  function frame(now) {
    // 画面から外されたら（または5秒たっても画面に出なければ）片づける
    if (canvas.isConnected) seen = true;
    else if (seen || now - born > 5000) return api.destroy();
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const t = now / 1000;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const box = canvas.getBoundingClientRect();
    const W = Math.round(box.width * dpr);
    const H = Math.round(box.height * dpr);
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    gl.viewport(0, 0, W, H);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!box.width || !box.height) return;
    // 奥の人から（話している人を最後＝手前に）
    const list = [...actors.values()].sort((a, b) => a.el.classList.contains("speaking") - b.el.classList.contains("speaking"));
    for (const a of list) {
      const img = a.img;
      const ready = img.complete && img.naturalWidth > 0;
      if (!ready && !a.tex) continue;
      // 絵が変わったら（読み終わってから）、前の絵からふわっと入れ替える
      const src = img.currentSrc || img.src;
      if (ready && src !== a.src) {
        a.base = texOf(img);
        a.src = src;
        a.ratio = img.naturalWidth / img.naturalHeight;
        a.fig = figOf(img);
        swapTex(a, a.base, a.tex ? 0.28 : 0);
      }
      // 口パク・まばたき・手ぶり：差分の絵があれば、それに切り替える（短い時間でふわっと）
      if (t > a.blinkAt + 0.13) a.blinkAt = t + 2 + Math.random() * 4;
      const blinking = t >= a.blinkAt && t < a.blinkAt + 0.13;
      if (t > a.mouthNext) {
        a.mouthOpen = !a.mouthOpen;
        a.mouthNext = t + (a.mouthOpen ? 0.08 + Math.random() * 0.1 : 0.06 + Math.random() * 0.14);
      }
      const fr = a.frames;
      const talkF = readyImg(fr.talk) ? texOf(fr.talk) : null;
      const blinkF = readyImg(fr.blink) ? texOf(fr.blink) : null;
      const gestF = readyImg(fr.gesture) ? texOf(fr.gesture) : null;
      const want = blinking && blinkF ? blinkF : a.talking && a.mouthOpen && talkF ? talkF : t < a.gestureUntil && gestF ? gestF : a.base;
      if (want && want !== a.tex) swapTex(a, want, want === gestF || a.tex === gestF ? 0.22 : 0.05);
      a.mix = Math.min(1, a.mix + dt / Math.max(0.001, a.mixDur));
      const speaking = a.el.classList.contains("speaking");
      const flashAge = t - a.flashAt;
      const fl = flashAge < 0.35 ? Math.exp(-flashAge * 9) : 0; // 命中の閃光：白く光って戻る
      a.bright = ease(a.bright, speaking || !a.anyone() ? 1 : 0.74, dt, 6) + fl * 2.2;
      a.sat = ease(a.sat, speaking || !a.anyone() ? 1 : 0.85, dt, 6) * (1 - fl);
      a.talkAmp = ease(a.talkAmp, a.talking ? 1 : 0, dt, a.talking ? 12 : 5);
      const hopAge = t - a.hopAt;
      const hop = hopAge < 1.2 ? 0.05 * Math.exp(-hopAge * 4) * Math.abs(Math.sin(hopAge * 11)) : 0;
      // しぐさ：目標へ追いつく（ばね）。ときどき体重をかけ直す・首をかしげる（じっとしていても生きて見える）
      if (t > a.fidgetAt) {
        a.fidgetAt = t + (2.5 + Math.random() * 4) / Math.max(0.3, a.persona.fidget);
        a.idle = { lean: (Math.random() - 0.5) * 0.5, tilt: (Math.random() - 0.5) * 0.5 };
        // 手を少し上げる・首を振る・腕を組みなおす、のどれか（すぐ元へもどる）
        const r = Math.random();
        a.fidgetJ = r < 0.33 ? { armL: 0, armR: 0.35, elbL: 0, elbR: 0.5, head: 0 } : r < 0.66 ? { armL: 0, armR: 0, elbL: 0, elbR: 0, head: (Math.random() - 0.5) * 0.3 } : { armL: -0.25, armR: 0, elbL: -0.4, elbR: 0, head: 0 };
        a.fidgetEnd = t + 0.8 + Math.random() * 0.8;
      }
      if (t > a.fidgetEnd) a.fidgetJ = FID0;
      const pose = a.pose;
      const goal = {
        lean: pose.lean + a.idle.lean * 0.6 + a.persona.lean, tilt: pose.tilt + a.idle.tilt + a.persona.tilt, squash: pose.squash, turn: pose.turn, slump: pose.slump,
      };
      for (const k of Object.keys(goal)) a.cur[k] = ease(a.cur[k], goal[k], dt, k === "squash" ? 16 : 5);
      // 驚き：ぴょんとつぶれて伸びる。怒り：ふるえ。歩き：入ってくるあいだだけ
      const jumpAge = t - a.jumpAt;
      const jump = jumpAge < 0.6 ? Math.sin(jumpAge * 10.5) * 0.09 * Math.exp(-jumpAge * 3) : 0;
      const shake = t < a.shakeUntil ? 1 : 0;
      const bob = t < a.walkUntil ? 1 : 0;
      const r = a.el.getBoundingClientRect();
      // 関節：目標へばねで追いつく（勢いと余韻）
      if (a.rig) {
        if (a.act.until && t > a.act.until) a.act = { mode: a.talking ? "talk" : "idle", t0: t };
        if (a.act.mode === "idle" && a.talking) a.act = { mode: "talk", t0: t };
        if (a.act.mode === "talk" && !a.talking) a.act = { mode: "idle", t0: t };
        const g = targetsOf(a, t);
        const k = a.act.mode === "strike" ? 520 : a.act.mode === "run" ? 380 : 200, c = 2 * Math.sqrt(k) * 0.72;
        for (const j of JOINTS) {
          a.jv[j] += (k * (g[j] - a.j[j]) - c * a.jv[j]) * dt;
          a.j[j] += a.jv[j] * dt;
        }
      }
      // 胸：体の動きの加速度に、遅れてついてくる
      if (a.chest) {
        const beat = a.stance ? 0.5 - 0.5 * Math.cos(t * a.persona.tempo + a.phase) : 0;
        const by = -r.bottom / Math.max(1, box.height) - 0.022 * a.persona.bounce * beat + hop + Math.max(0, jump) * 0.5 + (a.talking ? 0.004 * Math.abs(Math.sin(t * 7)) : 0) + 0.004 * Math.sin(t * 1.7 + a.phase);
        const bx = (r.left + r.width / 2) / Math.max(1, box.width);
        if (a.prevBy == null) { a.prevBy = by; a.prevBx = bx; a.vBy = 0; a.vBx = 0; }
        const vy = (by - a.prevBy) / Math.max(dt, 0.001), vx = (bx - a.prevBx) / Math.max(dt, 0.001);
        const ay = (vy - a.vBy) / Math.max(dt, 0.001), axx = (vx - a.vBx) / Math.max(dt, 0.001);
        a.prevBy = by; a.prevBx = bx; a.vBy = vy; a.vBx = vx;
        const K = 260, C = 9;
        a.jigV.y += (-K * a.jig.y - C * a.jigV.y - Math.max(-60, Math.min(60, ay)) * 0.9) * dt;
        a.jigV.x += (-K * a.jig.x - C * a.jigV.x - Math.max(-60, Math.min(60, axx)) * 0.35) * dt;
        a.jig.y = Math.max(-0.035, Math.min(0.035, a.jig.y + a.jigV.y * dt));
        a.jig.x = Math.max(-0.02, Math.min(0.02, a.jig.x + a.jigV.x * dt));
      }
      const alpha = parseFloat(getComputedStyle(a.el).opacity) || 0;
      if (alpha < 0.01) continue;
      // 絵の縦横比を保って、要素の四角の中に下寄せで収める（object-fit: contain; object-position: bottom と同じ）
      let rw = r.width, rh = r.height;
      if (a.ratio) { const sc = Math.min(r.width / a.ratio, r.height); rh = sc; rw = sc * a.ratio; }
      const rl = r.left + (r.width - rw) / 2;
      const x = ((rl - box.left) / box.width) * 2 - 1;
      const y = 1 - ((r.bottom - box.top) / box.height) * 2;
      const w = (rw / box.width) * 2;
      const h = (rh / box.height) * 2;
      gl.uniform4f(U.u_rect, x, y, w, h);
      gl.uniform1f(U.u_t, t);
      gl.uniform1f(U.u_phase, a.phase);
      // still：絵を曲げない（あいぼう）。上下の移動（hop）だけ
      gl.uniform1f(U.u_breath, a.still || a.stance ? 0 : a.boss ? 1.6 : a.float ? 1.3 : 1);
      gl.uniform1f(U.u_sway, a.still || a.stance ? 0 : a.boss ? 1.4 : 1);
      gl.uniform1f(U.u_flutter, a.still ? 0 : a.float ? 1.6 : 1);
      gl.uniform1f(U.u_talk, a.still ? 0 : a.talkAmp * (talkF ? 0.5 : 1));
      gl.uniform1f(U.u_hop, hop + Math.max(0, jump) * 0.5);
      gl.uniform1f(U.u_alpha, alpha);
      gl.uniform1f(U.u_lean, a.cur.lean);
      gl.uniform1f(U.u_tilt, a.cur.tilt);
      gl.uniform1f(U.u_squash, a.cur.squash + jump);
      gl.uniform1f(U.u_turn, a.cur.turn);
      gl.uniform1f(U.u_slump, a.cur.slump);
      gl.uniform1f(U.u_bob, bob);
      gl.uniform1f(U.u_shake, shake);
      gl.uniform1f(U.u_stance, a.stance ? (a.boss ? 0.7 : 1) : 0);
      if (a.still) for (const n of ["u_lean", "u_tilt", "u_squash", "u_turn", "u_slump", "u_bob", "u_shake"]) gl.uniform1f(U[n], 0);
      const fg = a.fig || [0, 0, 1, 1];
      gl.uniform4f(U.u_fig, fg[0], fg[1], fg[2], fg[3]);
      gl.uniform1f(U.u_rig, a.rig && a.fig ? 1 : 0);
      for (const j of JOINTS) gl.uniform1f(U[`u_${j}`], a.j[j]);
      gl.uniform2f(U.u_jig, a.jig.x, a.jig.y);
      gl.uniform2f(U.u_chest, a.chest ? a.chest[0] : 0.5, a.chest ? a.chest[1] : 0.66);
      gl.uniform1f(U.u_jigOn, a.chest ? 1 : 0);
      gl.uniform1f(U.u_tempo, a.persona.tempo);
      gl.uniform1f(U.u_bounce, a.persona.bounce);
      gl.uniform1f(U.u_shift, a.persona.shift);
      // 足元の影（浮いている人には描かない）
      if (!a.float) {
        gl.uniform1f(U.u_shadow, 1);
        gl.uniform1f(U.u_hop, 0);
        gl.drawElements(gl.TRIANGLES, idx.length, gl.UNSIGNED_SHORT, 0);
        gl.uniform1f(U.u_hop, hop);
      }
      gl.uniform1f(U.u_shadow, 0);
      gl.uniform1f(U.u_mix, a.mix);
      gl.uniform1f(U.u_bright, a.bright);
      gl.uniform1f(U.u_sat, a.sat);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, a.prev || a.tex || empty);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, a.tex || empty);
      gl.drawElements(gl.TRIANGLES, idx.length, gl.UNSIGNED_SHORT, 0);
    }
  }
  raf = requestAnimationFrame(frame);

  const anyone = () => [...actors.values()].some((x) => x.el.classList.contains("speaking"));
  function swapTex(a, tex, dur) {
    a.prev = a.tex;
    a.tex = tex;
    a.mix = dur > 0 ? 0 : 1;
    a.mixDur = dur;
  }
  const api = {
    add(el, img, { float = false, boss = false, stance = false, rig = !boss && !float, chest = null, persona = null, still = false } = {}) {
      const zero = () => Object.fromEntries(JOINTS.map((j) => [j, 0]));
      actors.set(el, {
        el, img, float, boss, stance, rig, chest, still, j: zero(), jv: zero(), act: { mode: "idle", t0: performance.now() / 1000 }, fig: null,
        jig: { x: 0, y: 0 }, jigV: { x: 0, y: 0 }, prevBy: null,
        persona: { ...PERSONA0, ...(persona || {}), ...(boss ? { tempo: 3.5, bounce: 0.9, shift: 0.4 } : {}) }, fidgetJ: FID0, fidgetEnd: 0, phase: Math.random() * 6.28, mix: 1, bright: 1, sat: 1, talkAmp: 0, talking: false, hopAt: -10, src: "", prev: null, anyone,
        pose: { lean: 0, tilt: 0, squash: 0, turn: 0, slump: 0 }, cur: { lean: 0, tilt: 0, squash: 0, turn: 0, slump: 0 }, tex: null,
        idle: { lean: 0, tilt: 0 }, fidgetAt: performance.now() / 1000 + 1 + Math.random() * 3, jumpAt: -10, shakeUntil: 0, walkUntil: 0, flashAt: -10,
        base: null, ratio: 0, mixDur: 0.28, frames: {}, blinkAt: performance.now() / 1000 + 1 + Math.random() * 3, mouthOpen: false, mouthNext: 0, gestureUntil: 0,
      });
    },
    // 差分の絵：{ talk: url, blink: url, gesture: url }（ないものは省く）。先に読んでおく
    frames(el, f) { const a = actors.get(el); if (a) a.frames = Object.fromEntries(Object.entries(f).filter(([, u]) => u).map(([k, u]) => [k, loadImg(u)])); },
    preload(urls) { for (const u of urls) loadImg(u); },
    blink(el) { const a = actors.get(el); if (a) a.blinkAt = performance.now() / 1000; },
    gesture(el, ms = 1200) { const a = actors.get(el); if (a) a.gestureUntil = performance.now() / 1000 + ms / 1000; },
    // 姿勢の目標（-1〜1）：lean 前のめり(+は右へ)、tilt 首かしげ、squash つぶれ、turn 向き、slump しょんぼり
    pose(el, p) { const a = actors.get(el); if (a) Object.assign(a.pose, p); },
    // 気持ちのしぐさ：驚く（跳ねる）、怒る（ふるえる）、悲しむ（しょんぼり）、笑う（はずむ）
    emote(el, emo) {
      const a = actors.get(el);
      if (!a) return;
      const now = performance.now() / 1000;
      if (emo === "surprised") { a.jumpAt = now; a.pose.slump = 0; if (a.rig) a.act = { mode: "hit", t0: now, until: now + 0.35 }; }
      else if (emo === "angry") { a.shakeUntil = now + 0.5; a.pose.slump = 0; }
      else if (emo === "sad") a.pose.slump = 1;
      else if (emo === "smile") { a.hopAt = now; a.pose.slump = 0; }
      else a.pose.slump = 0;
    },
    act(el, mode, ms = 0) { const a = actors.get(el); if (a) { const t = performance.now() / 1000; a.act = { mode, t0: t, until: ms ? t + ms / 1000 : 0 }; } },
    flash(el) { const a = actors.get(el); if (a) a.flashAt = performance.now() / 1000; },
    walk(el, ms = 600) { const a = actors.get(el); if (a) a.walkUntil = performance.now() / 1000 + ms / 1000; },
    remove(el) { actors.delete(el); },
    talk(el, on) { const a = actors.get(el); if (a) a.talking = on; },
    talkAll(on) { for (const a of actors.values()) a.talking = on && a.el.classList.contains("speaking"); },
    hop(el) { const a = actors.get(el); if (a) a.hopAt = performance.now() / 1000; },
    destroy() {
      cancelAnimationFrame(raf);
      for (const t of texCache.values()) gl.deleteTexture(t);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
  return api;
}
