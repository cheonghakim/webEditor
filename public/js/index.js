import { CodePlayground } from "./codePlayground.js";
import { LayoutManager } from "./layoutManager.js";

(function () {
  const layout = new LayoutManager();
  layout.init();
  const tabs = new Tabby("[data-tabs]");

  const code = new CodePlayground({
    meta: "WebGL2 Ocean — Gerstner Waves",
    tabs,
    html: `
<canvas id="gl"></canvas>
<div class="hud">
  WebGL2 Ocean — Gerstner Waves<br/>
  • 드래그: 카메라 회전 / 휠: 줌<br/>
  • 파라미터는 JS 상단에서 조절 가능
</div>`,

    css: `
html,body { height:100%; margin:0; background:#0a0f18; overflow:hidden; }
#gl { width:100%; height:100%; display:block; }
.hud {
  position: fixed; left:12px; bottom:12px; color:#cbd5e1;
  font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  background: rgba(0,0,0,.35); padding:10px 12px;
  border:1px solid rgba(255,255,255,.08); border-radius:10px;
}`,

    // ⚠️ await 사용 → async IIFE로 감싸기
    js: `
(async () => {
// 러스트 모듈 초기화가 끝날 때까지 기다린다
const rust = await window.__rust;
console.log('rust ok:', rust);
console.log('add(2,3)=', rust.add?.(2, 3));

// ====== Config ======
const GRID_RES = 256; // plane 분할 수 (256~512 권장, 성능에 맞춰 조절)
const FOV = (55 * Math.PI) / 180;
const CAMERA = { dist: 8.0, azim: Math.PI * 0.25, elev: 0.35 };
const SUN_DIR = normalize([-0.5, 0.8, 0.2]); // 태양 방향
const SUN_COLOR = [1.0, 0.95, 0.9];
const WATER_BASE = [0.02, 0.16, 0.24]; // 심해색 베이스
const SKY_TOP = [0.08, 0.23, 0.45];
const SKY_HORZ = [0.4, 0.58, 0.8];

// Gerstner 파도 파라미터(최대 4개 사용)
const WAVES = [
  // dir(x,z), amplitude, wavelength, speed, steepness
  {
    dir: normalize([1.0, 0.4]),
    amp: 0.18,
    lambda: 4.0,
    speed: 1.0,
    steep: 0.75,
  },
  {
    dir: normalize([0.7, -1.0]),
    amp: 0.1,
    lambda: 2.2,
    speed: 1.4,
    steep: 0.75,
  },
  {
    dir: normalize([-0.8, 0.2]),
    amp: 0.06,
    lambda: 1.1,
    speed: 1.8,
    steep: 0.7,
  },
  {
    dir: normalize([0.2, 1.0]),
    amp: 0.03,
    lambda: 0.6,
    speed: 2.2,
    steep: 0.65,
  },
];

// ====== WebGL bootstrap ======
const canvas = document.getElementById("gl");
const gl = canvas.getContext("webgl2", { antialias: true });
if (!gl) {
  alert("WebGL2를 지원하지 않습니다.");
  return;
}

// Resize
function fit() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.floor(canvas.clientWidth * dpr);
  const h = Math.floor(canvas.clientHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  gl.viewport(0, 0, canvas.width, canvas.height);
}
function onResize() {
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  fit();
}
window.addEventListener("resize", onResize);
onResize();

// ====== Shaders ======
const vertSrc = \`#version 300 es
precision highp float;

layout(location=0) in vec2 a_pos; // grid on XZ plane (unit)
uniform mat4 u_proj, u_view;
uniform float u_time;
uniform vec3 u_wavesDir[4];
uniform float u_wavesAmp[4];
uniform float u_wavesLambda[4];
uniform float u_wavesSpeed[4];
uniform float u_wavesSteep[4];
uniform int u_waveCount;

out vec3 v_worldPos;
out vec3 v_worldNormal;
out float v_choppy;  // for foam cue

// Gerstner helpers
// Given base position p (x,z, y=0), apply N waves (analytic)
vec3 gerstnerDisplace(vec3 p, out vec3 normal, out float choppy) {
  // Start with flat normal up
  vec3 n = vec3(0.0, 1.0, 0.0);
  vec3 pos = p;
  choppy = 0.0;

  for (int i=0; i<4; ++i) {
    if (i >= u_waveCount) break;
    vec2 D = normalize(u_wavesDir[i].xz);
    float A = u_wavesAmp[i];
    float L = u_wavesLambda[i];
    float S = u_wavesSpeed[i];
    float steep = u_wavesSteep[i];

    float k = 2.0 * 3.14159265 / L; // wave number
    float w = sqrt(9.81 * k);       // deep water dispersion (approx), can scale
    float phase = k * dot(D, p.xz) - (w * S) * u_time;

    float cosP = cos(phase);
    float sinP = sin(phase);

    // Horizontal choppiness via steepness
    pos.x += (steep * A) * D.x * cosP;
    pos.z += (steep * A) * D.y * cosP;

    // Vertical displacement
    pos.y += A * sinP;

    // Normal using partial derivatives of Gerstner (analytic)
    // See Tessendorf notes / Gerstner formulation
    vec3 tx = vec3(1.0
      - (steep * A * k) * D.x * D.x * sinP,
      A * k * D.x * cosP,
      - (steep * A * k) * D.x * D.y * sinP);

    vec3 tz = vec3(
      - (steep * A * k) * D.x * D.y * sinP,
      A * k * D.y * cosP,
      1.0 - (steep * A * k) * D.y * D.y * sinP);

    // Combine normals by TBN cross (approx accumulate)
    n += normalize(cross(tz, tx));

    // For foam cue: large slopes / crests
    choppy += (steep * A * k) * abs(cosP);
  }

  normal = normalize(n);
  return pos;
}

void main() {
  // Place grid in world space, scale to cover area
  // a_pos in [-1,1]x[-1,1] -> scale to tile of size 40 (adjust as needed)
  vec2 tile = a_pos * 20.0;
  vec3 base = vec3(tile.x, 0.0, tile.y);

  float c;
  vec3 N;
  vec3 worldPos = gerstnerDisplace(base, N, c);

  v_worldPos = worldPos;
  v_worldNormal = N;
  v_choppy = c;

  gl_Position = u_proj * u_view * vec4(worldPos, 1.0);
}
\`;

const fragSrc = \`#version 300 es
precision highp float;

in vec3 v_worldPos;
in vec3 v_worldNormal;
in float v_choppy;
out vec4 o_color;

uniform vec3 u_camPos;
uniform vec3 u_sunDir;
uniform vec3 u_sunColor;
uniform vec3 u_waterBase;
uniform vec3 u_skyTop;
uniform vec3 u_skyHorz;

uniform float u_time;

// Utility
float saturate(float x){ return clamp(x,0.0,1.0); }
vec3  saturate(vec3 v){ return clamp(v,vec3(0.0),vec3(1.0)); }

// Schlick Fresnel
float fresnelSchlick(float cosTheta, float F0){
  return F0 + (1.0-F0)*pow(1.0 - cosTheta, 5.0);
}

// Simple sky gradient for reflections
vec3 skyColor(vec3 dir){
  float t = saturate(dir.y*0.5 + 0.5);
  return mix(u_skyHorz, u_skyTop, t);
}

void main(){
  vec3 N = normalize(v_worldNormal);
  vec3 V = normalize(u_camPos - v_worldPos);
  vec3 L = normalize(u_sunDir);
  vec3 H = normalize(L + V);

  // Fresnel
  float cosV = saturate(dot(N, V));
  float F = fresnelSchlick(cosV, 0.04); // dielectric water ~0.02-0.06

  // Reflection (env)
  vec3 R = reflect(-V, N);
  vec3 env = skyColor(R);

  // Base water color (absorption tint) & diffuse (very subtle)
  vec3 base = u_waterBase;
  float NdotL = saturate(dot(N, L));
  vec3 diffuse = base * (0.08 + 0.22 * NdotL);

  // Specular highlight
  float spec = pow(saturate(dot(N, H)), 120.0) * (0.35 + 0.65 * NdotL);
  vec3 specular = u_sunColor * spec;

  // Foam at crests: use slope cue + facing
  float foamCrest = saturate(v_choppy * 0.08 - 0.15);
  float facing = 1.0 - cosV; // more foam when seen grazing
  float foam = saturate(foamCrest * (0.3 + 0.7 * facing));

  // Small sparkle/foam flicker (cheap)
  float flick = fract(sin(dot(v_worldPos.xz, vec2(12.9898,78.233))) * 43758.5453);
  foam *= smoothstep(0.4, 1.0, flick + 0.15*sin(u_time*1.7 + v_worldPos.x*0.2));

  // Combine: reflection via Fresnel, plus base/foam/spec
  vec3 color = mix(diffuse, env, F) + specular + foam*vec3(0.9,0.95,1.0);

  // Simple distance fog
  float dist = length(u_camPos - v_worldPos);
  float fog = saturate(1.0 - exp(-0.02 * dist));
  vec3 fogCol = mix(u_skyHorz, u_skyTop, 0.5);
  color = mix(color, fogCol, fog*0.35);

  o_color = vec4(saturate(color), 1.0);
}
\`;

// ====== GL helpers ======
function compileShader(type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.error(gl.getShaderInfoLog(sh));
    throw new Error("Shader compile failed");
  }
  return sh;
}
function createProgram(vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    console.error(gl.getProgramInfoLog(p));
    throw new Error("Program link failed");
  }
  return p;
}
function normalize(v) {
  const l = Math.hypot(...v);
  return v.map((x) => x / l);
}

// ====== Geometry: indexed grid on XZ [-1,1]^2 ======
function makeGrid(N) {
  const verts = new Float32Array((N + 1) * (N + 1) * 2);
  let k = 0;
  for (let j = 0; j <= N; j++) {
    for (let i = 0; i <= N; i++) {
      const x = (i / N) * 2 - 1;
      const z = (j / N) * 2 - 1;
      verts[k++] = x;
      verts[k++] = z;
    }
  }
  const indices = new Uint32Array(N * N * 6);
  let t = 0;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const a = j * (N + 1) + i;
      const b = a + 1;
      const c = a + (N + 1);
      const d = c + 1;
      indices[t++] = a;
      indices[t++] = c;
      indices[t++] = b;
      indices[t++] = b;
      indices[t++] = c;
      indices[t++] = d;
    }
  }
  return { verts, indices };
}
const grid = makeGrid(GRID_RES);

// ====== Program & buffers ======
const prog = createProgram(
  compileShader(gl.VERTEX_SHADER, vertSrc),
  compileShader(gl.FRAGMENT_SHADER, fragSrc)
);
gl.useProgram(prog);

const vao = gl.createVertexArray();
gl.bindVertexArray(vao);

const vbo = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
gl.bufferData(gl.ARRAY_BUFFER, grid.verts, gl.STATIC_DRAW);
gl.enableVertexAttribArray(0);
gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);

const ibo = gl.createBuffer();
gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, grid.indices, gl.STATIC_DRAW);

// Uniform locations
const loc = (name) => gl.getUniformLocation(prog, name);
const u_proj = loc("u_proj");
const u_view = loc("u_view");
const u_time = loc("u_time");
const u_camPos = loc("u_camPos");
const u_sunDir = loc("u_sunDir");
const u_sunColor = loc("u_sunColor");
const u_waterBase = loc("u_waterBase");
const u_skyTop = loc("u_skyTop");
const u_skyHorz = loc("u_skyHorz");

const u_wavesDir = loc("u_wavesDir");
const u_wavesAmp = loc("u_wavesAmp");
const u_wavesLambda = loc("u_wavesLambda");
const u_wavesSpeed = loc("u_wavesSpeed");
const u_wavesSteep = loc("u_wavesSteep");
const u_waveCount = loc("u_waveCount");

// Upload static uniforms
gl.uniform3fv(u_sunDir, SUN_DIR);
gl.uniform3fv(u_sunColor, SUN_COLOR);
gl.uniform3fv(u_waterBase, WATER_BASE);
gl.uniform3fv(u_skyTop, SKY_TOP);
gl.uniform3fv(u_skyHorz, SKY_HORZ);

// Waves
const WN = Math.min(4, WAVES.length);
const wavesDirArr = new Float32Array(4 * 3); // xyz (use xz)
const wavesAmpArr = new Float32Array(4);
const wavesLamArr = new Float32Array(4);
const wavesSpdArr = new Float32Array(4);
const wavesStpArr = new Float32Array(4);
for (let i = 0; i < 4; i++) {
  const w = WAVES[i] || { dir: [1, 0], amp: 0, lambda: 1, speed: 0, steep: 0 };
  wavesDirArr.set([w.dir[0], 0, w.dir[1]], i * 3);
  wavesAmpArr[i] = w.amp;
  wavesLamArr[i] = w.lambda;
  wavesSpdArr[i] = w.speed;
  wavesStpArr[i] = w.steep;
}
gl.uniform3fv(u_wavesDir, wavesDirArr);
gl.uniform1fv(u_wavesAmp, wavesAmpArr);
gl.uniform1fv(u_wavesLambda, wavesLamArr);
gl.uniform1fv(u_wavesSpeed, wavesSpdArr);
gl.uniform1fv(u_wavesSteep, wavesStpArr);
gl.uniform1i(u_waveCount, WN);

// ====== Camera & matrices ======
function perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
  const out = new Float32Array(16);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) * nf;
  out[11] = -1;
  out[14] = 2 * far * near * nf;
  return out;
}
function lookAt(eye, target, up) {
  const z = normalize3(sub3(eye, target));
  const x = normalize3(cross(up, z));
  const y = cross(z, x);
  const m = new Float32Array(16);
  m[0] = x[0]; m[1] = y[0]; m[2] = z[0]; m[3] = 0;
  m[4] = x[1]; m[5] = y[1]; m[6] = z[1]; m[7] = 0;
  m[8] = x[2]; m[9] = y[2]; m[10] = z[2]; m[11] = 0;
  m[12] = -dot(x, eye); m[13] = -dot(y, eye); m[14] = -dot(z, eye); m[15] = 1;
  return m;
}
function sub3(a, b) { return [a[0]-b[0], a[1]-b[1], a[2]-b[2]]; }
function cross(a, b) {
  return [ a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0] ];
}
function dot(a, b) { return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]; }
function len(a) { return Math.hypot(a[0], a[1], a[2]); }
function normalize3(a) { const l = len(a) || 1; return [a[0]/l, a[1]/l, a[2]/l]; }

// Orbit controls (마우스로 회전/줌)
let isDrag = false, px = 0, py = 0;
canvas.addEventListener("mousedown", (e) => {
  isDrag = true; px = e.clientX; py = e.clientY;
});
window.addEventListener("mouseup", () => (isDrag = false));
window.addEventListener("mousemove", (e) => {
  if (!isDrag) return;
  const dx = (e.clientX - px) / canvas.clientWidth;
  const dy = (e.clientY - py) / canvas.clientHeight;
  CAMERA.azim -= dx * 3.0;
  CAMERA.elev = Math.max(-1.2, Math.min(1.2, CAMERA.elev - dy * 2.0));
  px = e.clientX; py = e.clientY;
});
canvas.addEventListener("wheel", (e) => {
  CAMERA.dist *= 1 + Math.sign(e.deltaY) * 0.08;
  CAMERA.dist = Math.max(2.5, Math.min(30.0, CAMERA.dist));
}, { passive: true });

// ====== Render loop ======
gl.enable(gl.DEPTH_TEST);
gl.enable(gl.CULL_FACE);
gl.cullFace(gl.BACK);

let t0 = performance.now();
function frame() {
  fit();
  const t = (performance.now() - t0) / 1000;

  gl.clearColor(0.02, 0.04, 0.08, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  // Camera
  const aspect = canvas.width / canvas.height;
  const proj = perspective(FOV, aspect, 0.01, 100.0);

  // Spherical to Cartesian
  const ce = Math.cos(CAMERA.elev), se = Math.sin(CAMERA.elev);
  const ca = Math.cos(CAMERA.azim), sa = Math.sin(CAMERA.azim);
  const eye = [
    CAMERA.dist * ce * ca,
    Math.max(1.2, CAMERA.dist * se),
    CAMERA.dist * ce * sa,
  ];
  const view = lookAt(eye, [0, 0, 0], [0, 1, 0]);

  gl.useProgram(prog);
  gl.uniformMatrix4fv(u_proj, false, proj);
  gl.uniformMatrix4fv(u_view, false, view);
  gl.uniform1f(u_time, t * 0.75);
  gl.uniform3fv(u_camPos, new Float32Array(eye));

  gl.bindVertexArray(vao);
  gl.drawElements(gl.TRIANGLES, grid.indices.length, gl.UNSIGNED_INT, 0);

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
})();`,

    // 러스트 소스는 그냥 문자열로
    rust: `
    use wasm_bindgen::prelude::*;

    #[wasm_bindgen]
    pub fn add(a: i32, b: i32) -> i32 {
        a + b
    }
`,
  });
})();
