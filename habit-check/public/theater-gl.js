// 劇の立ち絵を WebGL の網目（メッシュ）で描いて、なめらかに動かす（Live2D 風）。
// 息づかい・体のゆれ・髪やマントのはためき・話すときのうなずき・表情の切り替え（ふわっと入れ替え）・跳ねる動き。
// 立ち絵の置き場所と大きさは、これまでどおり .actor の要素（CSS）が決める。ここはその四角の中を描くだけ。
//   const gl = createActorGL(canvas)  … 使えなければ null（そのときは <img> のまま）。立ち絵の位置は canvas からの相対で測る
//   gl.add(el, img, { float, boss }) / gl.remove(el) / gl.talk(el, on) / gl.hop(el) / gl.destroy()
// canvas が画面から外されると、自分で片づける（あいぼう・ボスの大きな絵にも使う）

const GRID_X = 18;
const GRID_Y = 28;

const VS = `
attribute vec2 a_p;
uniform vec4 u_rect;
uniform float u_t, u_phase, u_breath, u_sway, u_talk, u_hop, u_flutter;
varying vec2 v_uv;
void main() {
  vec2 p = a_p;
  float up = smoothstep(0.12, 1.0, p.y);
  float s = sin(u_t * 1.7 + u_phase);
  float chest = exp(-pow((p.y - 0.62) / 0.18, 2.0));
  p.x = 0.5 + (p.x - 0.5) * (1.0 + u_breath * 0.018 * s * chest);
  p.y += u_breath * 0.007 * s * up;
  p.x += u_sway * 0.013 * sin(u_t * 0.8 + u_phase) * up * up;
  float head = smoothstep(0.68, 0.95, a_p.y);
  p.y += u_talk * 0.010 * abs(sin(u_t * 10.0)) * head;
  p.x += u_talk * 0.004 * sin(u_t * 4.7) * head;
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
void main() {
  if (u_shadow > 0.5) {
    vec2 d = (v_uv - vec2(0.5, 0.97)) * vec2(2.2, 14.0);
    gl_FragColor = vec4(0.0, 0.0, 0.0, 0.35 * u_alpha * smoothstep(1.0, 0.0, length(d)));
    return;
  }
  vec4 c = mix(texture2D(u_a, v_uv), texture2D(u_b, v_uv), u_mix);
  float g = dot(c.rgb, vec3(0.3, 0.59, 0.11));
  c.rgb = mix(vec3(g), c.rgb, u_sat) * u_bright;
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
  for (const n of ["u_rect", "u_t", "u_phase", "u_breath", "u_sway", "u_talk", "u_hop", "u_flutter", "u_a", "u_b", "u_mix", "u_bright", "u_sat", "u_alpha", "u_shadow"]) U[n] = gl.getUniformLocation(prog, n);

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
      if (!ready && !a.cur) continue;
      // 絵が変わったら（読み終わってから）、前の絵からふわっと入れ替える
      const src = img.currentSrc || img.src;
      if (ready && src !== a.src) {
        a.prev = a.cur || texOf(img);
        a.cur = texOf(img);
        a.mix = a.src ? 0 : 1;
        a.src = src;
      }
      a.mix = Math.min(1, a.mix + dt / 0.28);
      const speaking = a.el.classList.contains("speaking");
      a.bright = ease(a.bright, speaking || !a.anyone() ? 1 : 0.74, dt, 6);
      a.sat = ease(a.sat, speaking || !a.anyone() ? 1 : 0.85, dt, 6);
      a.talkAmp = ease(a.talkAmp, a.talking ? 1 : 0, dt, a.talking ? 12 : 5);
      const hopAge = t - a.hopAt;
      const hop = hopAge < 1.2 ? 0.05 * Math.exp(-hopAge * 4) * Math.abs(Math.sin(hopAge * 11)) : 0;
      const r = a.el.getBoundingClientRect();
      const alpha = parseFloat(getComputedStyle(a.el).opacity) || 0;
      if (alpha < 0.01) continue;
      const x = ((r.left - box.left) / box.width) * 2 - 1;
      const y = 1 - ((r.bottom - box.top) / box.height) * 2;
      const w = (r.width / box.width) * 2;
      const h = (r.height / box.height) * 2;
      gl.uniform4f(U.u_rect, x, y, w, h);
      gl.uniform1f(U.u_t, t);
      gl.uniform1f(U.u_phase, a.phase);
      gl.uniform1f(U.u_breath, a.boss ? 1.6 : a.float ? 1.3 : 1);
      gl.uniform1f(U.u_sway, a.boss ? 1.4 : 1);
      gl.uniform1f(U.u_flutter, a.float ? 1.6 : 1);
      gl.uniform1f(U.u_talk, a.talkAmp);
      gl.uniform1f(U.u_hop, hop);
      gl.uniform1f(U.u_alpha, alpha);
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
      gl.bindTexture(gl.TEXTURE_2D, a.prev || a.cur || empty);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, a.cur || empty);
      gl.drawElements(gl.TRIANGLES, idx.length, gl.UNSIGNED_SHORT, 0);
    }
  }
  raf = requestAnimationFrame(frame);

  const anyone = () => [...actors.values()].some((x) => x.el.classList.contains("speaking"));
  const api = {
    add(el, img, { float = false, boss = false } = {}) {
      actors.set(el, { el, img, float, boss, phase: Math.random() * 6.28, mix: 1, bright: 1, sat: 1, talkAmp: 0, talking: false, hopAt: -10, src: "", cur: null, prev: null, anyone });
    },
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
