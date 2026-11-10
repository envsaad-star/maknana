/* Maknana website: live 3D MR-Series robot cells. Version 3 (three.js r162, ES module).

   Every [data-robot] element becomes a real-time scene built from glTF models made in Blender:
   the MR-Series arm (analytic six-axis inverse kinematics), its tool, and a production cell standing in a dark
   studio: the page's own colour, a floor that fades into it, light built in code (nothing but the models is
   downloaded, and only once a stage comes near the screen).

   Left alone, each cell does its job: welds two seams, cuts parts out of a plate, bends blanks on a press brake,
   palletises cases, loads and unloads a machining centre. Move the pointer over it (or tap "Take control" on a
   phone) and you drive it: weld along the seam, draw on the plate to cut (close a loop and the part drops out),
   point at the pallet and click to place a case, click the press to bend, click a blank to machine it next.
   data-mode="explode" takes the arm apart as the page scrolls. data-assembly="1" (task "solution") hands the stage
   to the page: a whole welding cell builds itself one device at a time as the visitor scrolls (see TASKS.solution;
   the page calls el.__cell.setAssembly(k) and el.__cell.focusPart(name)). An illustration, not an engineering model. */
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { Reflector } from "three/addons/objects/Reflector.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { HorizontalBlurShader } from "three/addons/shaders/HorizontalBlurShader.js";
import { VerticalBlurShader } from "three/addons/shaders/VerticalBlurShader.js";

const T = THREE;
const V = (x = 0, y = 0, z = 0) => new T.Vector3(x, y, z);
const Q = () => new T.Quaternion();
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const quint = u => u * u * u * (u * (u * 6 - 15) + 10);
const WRAP = a => Math.atan2(Math.sin(a), Math.cos(a));
const AX = { X: V(1, 0, 0), Y: V(0, 1, 0), Z: V(0, 0, 1) };
const ONE = V(1, 1, 1);
const rnd = (a = 1) => (Math.random() * 2 - 1) * a;

const STAGES = [...document.querySelectorAll("[data-robot]")];
const RM = matchMedia("(prefers-reduced-motion: reduce)").matches;
const TOUCH = matchMedia("(hover: none), (pointer: coarse)").matches;
const AR = document.documentElement.dir === "rtl";
const VER = new URL(import.meta.url).searchParams.get("v") || "3";
const ASSET = f => new URL(`../3d/${f}?v=${VER}`, import.meta.url).href;
let LABELS = {};
try { LABELS = JSON.parse(document.getElementById("robot-labels").textContent); } catch (e) { /* English fallbacks below */ }
const EN = {
  load: "Loading the cell", show: "Tap to see it move in 3D", take: "Take control", done: "Done", pause: "Pause", play: "Play",
  auto: "Running by itself. Move over the cell to take control.",
  autoT: "Running by itself. Tap Take control to drive it.",
  paused: "Paused. Press play, or move over the cell to take control.", pausedT: "Paused. Tap play or Take control.",
  weld: "Move along the seam to weld it.", cut: "Move over the plate to cut. Close a loop and the part drops out.",
  bend: "Click the press brake to bend the sheet now.", palletise: "Point at the pallet and click to place the case.",
  tend: "Click a blank on the table to machine it next.",
  s_weld: "seams welded", s_cut: "parts cut", s_bend: "parts bent", s_palletise: "cases placed", s_tend: "parts machined",
  angle: "Bend angle",
  st_move: "Moving to the work", st_weld: "Welding the seam", st_cool: "Part cooling", st_swap: "Next part in",
  st_pierce: "Piercing the plate", st_cut: "Cutting the contour", st_plate: "Changing the plate",
  st_pick: "Picking a blank", st_feed: "Feeding the press", st_press: "Bending", st_stack: "Stacking the part",
  st_case: "Picking a case", st_place: "Placing on the pallet", st_full: "Pallet full: swapping",
  st_load: "Loading the machine", st_run: "Machining", st_unload: "Unloading the part", st_drive: "You are driving",
};
const lab = k => LABELS[k] || EN[k] || k;

function supportsGL() {
  try { const c = document.createElement("canvas"); return !!(window.WebGL2RenderingContext && c.getContext("webgl2")); } catch (e) { return false; }
}

/* ------------------------------------------------------------------ shared assets */
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const memo = new Map();
const once = (k, f) => { if (!memo.has(k)) memo.set(k, f()); return memo.get(k); };
/* models load as .glb; a page opened from disk (file://) or a host that refuses binary model files gets the same bytes
   from name.glb.js, a plain script that sets window.__GLB[name] to base64 (tools/filemode.py writes them) */
const FILE = location.protocol === "file:";
const fromB64 = name => new Promise((ok, no) => {
  const s = document.createElement("script"); s.src = ASSET(name + ".glb.js");
  s.onload = () => {
    const b64 = (window.__GLB || {})[name]; if (!b64) return no(new Error("no model data"));
    const bin = atob(b64), buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    delete window.__GLB[name];
    loader.parseAsync(buf.buffer, "").then(ok, no);
  };
  s.onerror = () => no(new Error("no model script")); document.head.appendChild(s);
});
const glb = name => once("glb:" + name, () => (FILE ? fromB64(name) : loader.loadAsync(ASSET(name + ".glb")).catch(() => fromB64(name)))
  .catch(e => { console.warn("3D asset missing:", name); return null; }));

function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement("canvas"); c.width = w; c.height = h; draw(c.getContext("2d"), w, h);
  const t = new T.CanvasTexture(c); if (srgb) t.colorSpace = T.SRGBColorSpace; return t;
}
const radial = stops => (x, w) => { const g = x.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2); stops.forEach(([o, c]) => g.addColorStop(o, c)); x.fillStyle = g; x.fillRect(0, 0, w, w); };
const TEX = {};
const tex = k => TEX[k] || (TEX[k] = ({
  glow: () => canvasTex(128, 128, radial([[0, "rgba(255,255,255,1)"], [0.18, "rgba(255,248,235,.95)"], [0.45, "rgba(255,190,120,.28)"], [1, "rgba(255,140,60,0)"]])),
  blue: () => canvasTex(128, 128, radial([[0, "rgba(255,255,255,1)"], [0.2, "rgba(220,235,255,.9)"], [0.5, "rgba(140,170,255,.25)"], [1, "rgba(120,140,255,0)"]])),
  smoke: () => canvasTex(128, 128, radial([[0, "rgba(255,255,255,.55)"], [0.5, "rgba(255,255,255,.18)"], [1, "rgba(255,255,255,0)"]])),
  beams: () => canvasTex(8, 256, (x, w, h) => { x.fillStyle = "#000"; x.fillRect(0, 0, w, h); for (let i = 0; i < 14; i++) { const y = (i + 0.5) * h / 14, g = x.createLinearGradient(0, y - 5, 0, y + 5); g.addColorStop(0, "#000"); g.addColorStop(0.5, "#fff"); g.addColorStop(1, "#000"); x.fillStyle = g; x.fillRect(0, y - 5, w, 10); } x.fillStyle = "rgba(255,255,255,.1)"; x.fillRect(0, 0, w, h); }),
  floor: () => canvasTex(256, 256, radial([[0, "#fff"], [0.42, "#fff"], [0.72, "#3a3a3a"], [1, "#000"]]), false),
}[k])());

/* materials and shadows on loaded models */
function prep(root, perStage) {
  root.traverse(o => {
    if (!o.isMesh) return;
    const m = o.material;
    o.castShadow = true; o.receiveShadow = true;
    if (/glass/i.test(m.name) || (m.transparent && m.opacity < 1)) {
      m.transparent = true; m.depthWrite = false; o.castShadow = false; m.side = T.DoubleSide; m.envMapIntensity = 1.2;
    } else if (m.alphaTest > 0) { m.side = T.DoubleSide; m.alphaToCoverage = true; }
    else m.side = T.FrontSide;
    if (/^paint/.test(m.name)) m.envMapIntensity = 0.9;
    if (m.map && m.map.anisotropy < 4) m.map.anisotropy = 4;        // floor plates and labels stay sharp at a shallow angle
    if (perStage && /^(lamp|screen|led)/i.test(m.name)) o.material = m.clone();
  });
  return root;
}
/* merge the static meshes under each moving node, per material: far fewer draw calls on phones */
const KEEP = /^(J\d|FLANGE|FEEDER_MOUNT|TCP|TOOL_|FINGER_|ROLLER_|RAM|BACKGAUGE|DOOR|SPINDLE|TOOL_SPIN|WORKPIECE|VISE|BOX_PROTO|PALLET_PROTO|LAMP_|BASE|MR_ROOT|GRP_|RAIL_CARRIAGE|ROBOT_BASE|CHAIN_|POS_ROT|SEAM_|CLEAN_TCP|CAM_EYE|LC_|HMI)/;
const keeps = o => KEEP.test(o.name) || o.userData.keep === true;      // userData.keep: a piece the assembly moves on its own
function mergeStatic(root) {
  root.updateWorldMatrix(true, true);
  const nodes = [root]; root.traverse(o => { if (o !== root && !o.isMesh && keeps(o)) nodes.push(o); });
  for (const node of nodes) {
    const groups = new Map();
    const inv = new T.Matrix4().copy(node.matrixWorld).invert();
    const walk = o => o.children.forEach(c => {
      if (c.isMesh && !c.isSkinnedMesh && !c.morphTargetInfluences) { const k = c.material.uuid; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(c); }
      if (!c.isMesh && keeps(c)) return;                   // another moving node: handled separately
      walk(c);
    });
    walk(node);
    for (const list of groups.values()) {
      if (list.length < 2) continue;
      const geos = list.map(m => { const g = m.geometry.clone(); g.applyMatrix4(new T.Matrix4().multiplyMatrices(inv, m.matrixWorld)); for (const a of Object.keys(g.attributes)) if (!["position", "normal", "uv"].includes(a)) g.deleteAttribute(a); return g; });
      const hasUV = geos.every(g => g.attributes.uv); if (!hasUV) geos.forEach(g => g.deleteAttribute("uv"));
      const merged = mergeGeometries(geos.map(g => g.index ? g : g), false);
      if (!merged) continue;
      merged.userData.own = true;                            // made here: dispose with the stage's teardown
      const m = new T.Mesh(merged, list[0].material); m.name = list[0].name; m.castShadow = list.some(x => x.castShadow); m.receiveShadow = true;
      node.add(m); list.forEach(x => x.parent && x.parent.remove(x));
    }
  }
  return root;
}
function disposeOwned(root) {      /* free GPU buffers this script created; shared glTF geometry stays cached */
  if (!root) return;
  root.traverse(o => { if (o.geometry && o.geometry.userData.own) o.geometry.dispose(); });
}
const relMatrix = (child, anc) => { anc.updateWorldMatrix(true, true); return new T.Matrix4().copy(anc.matrixWorld).invert().multiply(child.matrixWorld); };
function anchor(root, name, fallback) {
  const o = root && root.getObjectByName(name);
  if (!o) return fallback ? fallback.clone() : null;
  root.updateWorldMatrix(true, true);
  return o.getWorldPosition(V());
}
const mesh = (g, m, cast = true) => { const o = new T.Mesh(g, m); o.castShadow = cast; o.receiveShadow = true; return o; };
const stdMat = (c, r = 0.5, mt = 0, ex = {}) => new T.MeshStandardMaterial(Object.assign({ color: c, roughness: r, metalness: mt }, ex));

/* ------------------------------------------------------------------ the arm: analytic IK and motion */
const _m1 = new T.Matrix4(), _m2 = new T.Matrix4(), _m3 = new T.Matrix4(), _mr = new T.Matrix4();
const _qa = Q(), _qb = Q(), _qc = Q(), _p = V(), _p2 = V(), _r = Q();

class Arm {
  constructor(src, model) {
    this.model = model;
    const root = this.root = mergeStatic(prep(src.scene.clone(true)));
    const g = n => root.getObjectByName(n);
    this.J = [1, 2, 3, 4, 5, 6].map(i => g("J" + i));
    this.flange = g("FLANGE"); this.feeder = g("FEEDER_MOUNT");
    const [J1, J2, J3, J4, J5, J6] = this.J;
    this.k = { d1: J1.position.y + J2.position.y, a1: J2.position.x, a2: J3.position.y, a3: J4.position.y,
      d4: J4.position.x + J5.position.x, d6: J6.position.x + this.flange.position.x };
    this.q = [0, 0.15, 0.25, 0, 1.0, 0];
    this.tcpM = new T.Matrix4(); this.tcpInv = new T.Matrix4();
    this.cmdP = V(); this.cmdQ = Q(); this.vel = V();
    this.rest = this.J.map(j => j.position.clone());
    this.apply();
  }
  apply() {
    const [a, b, c, d, e, f] = this.q, J = this.J;
    J[0].rotation.set(0, a, 0); J[1].rotation.set(0, 0, -b); J[2].rotation.set(0, 0, -c);
    J[3].rotation.set(d, 0, 0); J[4].rotation.set(0, 0, -e); J[5].rotation.set(f, 0, 0);
  }
  setTool(obj) {
    if (this.tool) this.flange.remove(this.tool);
    this.tool = obj || null;
    if (!obj) { this.tcpM.identity(); this.tcpInv.identity(); this.tcpObj = this.flange; return; }
    obj.position.set(0, 0, 0); obj.quaternion.identity(); obj.scale.set(1, 1, 1);
    this.flange.add(obj);
    let tcp = null; obj.traverse(o => { if (!tcp && /^TCP(_\d+)?$/.test(o.name)) tcp = o; });   // the loader renames duplicates TCP_1, TCP_2 ...
    this.root.updateWorldMatrix(true, true);
    this.tcpM.copy(tcp ? relMatrix(tcp, this.flange) : new T.Matrix4());
    this.tcpInv.copy(this.tcpM).invert();
    this.tcpObj = tcp || obj;
  }
  reach() { const k = this.k; return k.a1 + k.a2 + Math.hypot(k.d4, k.a3); }
  /* world TCP pose -> joint angles (closest wrist solution to ref). Returns null when out of reach. */
  solve(pos, quat, ref = this.q, strict = false) {
    this.root.updateWorldMatrix(true, false);
    _m1.copy(this.root.matrixWorld).invert();
    _m2.compose(pos, quat, ONE).premultiply(_m1);
    _m3.multiplyMatrices(_m2, this.tcpInv);                       // flange pose in the robot frame
    const fp = _p2.setFromMatrixPosition(_m3), fq = _qc.setFromRotationMatrix(_m3);
    const k = this.k;
    const ax = _p.set(1, 0, 0).applyQuaternion(fq);
    const wx = fp.x - ax.x * k.d6, wy = fp.y - ax.y * k.d6, wz = fp.z - ax.z * k.d6;   // wrist centre
    const q1 = Math.atan2(-wz, wx);
    const r = Math.hypot(wx, wz) - k.a1, h = wy - k.d1;
    const L3 = Math.hypot(k.d4, k.a3), D = Math.hypot(r, h);
    let c = (r * r + h * h + k.a2 * k.a2 - L3 * L3) / (2 * k.a2 * Math.max(D, 1e-6));
    if (strict && (c < -1 || c > 1)) return null;
    c = clamp(c, -1, 1);
    const q2 = Math.atan2(r, h) - Math.acos(c);
    const ex = r - k.a2 * Math.sin(q2), ey = h - k.a2 * Math.cos(q2);
    const q3 = Math.atan2(k.a3, k.d4) - Math.atan2(ey, ex) - q2;
    // remaining rotation in the forearm frame: Rx(q4) Rz(-q5) Rx(q6)
    _qa.setFromAxisAngle(AX.Y, q1).multiply(_qb.setFromAxisAngle(AX.Z, -(q2 + q3)));
    _qa.invert().multiply(fq);
    const M = _mr.makeRotationFromQuaternion(_qa).elements, m = (i, j) => M[i + j * 4];
    const b = Math.acos(clamp(m(0, 0), -1, 1));
    let a, cc, bb = b;
    if (Math.sin(b) < 1e-4) { a = ref[3]; cc = Math.atan2(m(2, 1), m(1, 1)) - a; }
    else {
      const a1 = Math.atan2(m(2, 0), m(1, 0)), c1 = Math.atan2(m(0, 2), -m(0, 1));
      const a2 = a1 + Math.PI, c2 = c1 + Math.PI;
      const cost = (x, y) => Math.abs(WRAP(x - ref[3])) + Math.abs(WRAP(y - ref[5]));
      if (cost(a1, c1) <= cost(a2, c2) + 0.15) { a = a1; cc = c1; } else { a = a2; cc = c2; bb = -b; }
    }
    return [q1, q2, q3, ref[3] + WRAP(a - ref[3]), -bb, ref[5] + WRAP(cc - ref[5])];
  }
  goto(pos, quat) { const q = this.solve(pos, quat); if (q) { this.q = q; this.apply(); } this.cmdP.copy(pos); this.cmdQ.copy(quat); return !!q; }
  can(pos, quat) { return !!this.solve(pos, quat, this.q, true); }
  tcp(outP = V(), outQ) {
    this.root.updateWorldMatrix(true, true);
    _m1.multiplyMatrices(this.flange.matrixWorld, this.tcpM);
    outP.setFromMatrixPosition(_m1); if (outQ) outQ.setFromRotationMatrix(_m1);
    return outP;
  }
  syncCmd() { this.tcp(this.cmdP, this.cmdQ); this.vel.set(0, 0, 0); }
  /* follow a moving target with a speed limit (pointer driving) */
  follow(pos, quat, dt, vmax = 1.1) {
    _p.subVectors(pos, this.cmdP); const d = _p.length();
    const step = Math.min(d, vmax * dt, d * (1 - Math.exp(-dt * 9)) + 0.0005);
    if (d > 1e-5) this.cmdP.addScaledVector(_p, step / d);
    this.cmdQ.rotateTowards(quat, 3.2 * dt);
    const q = this.solve(this.cmdP, this.cmdQ, this.q, true);
    if (!q) { this.syncCmd(); return; }
    // joint speed limits (rad/s): the arm never whips its wrist through a singularity
    let k = 1;
    for (let i = 0; i < 6; i++) { const lim = (i < 3 ? 2.2 : 4.5) * dt, d = Math.abs(q[i] - this.q[i]); if (d > lim) k = Math.min(k, lim / d); }
    for (let i = 0; i < 6; i++) this.q[i] += (q[i] - this.q[i]) * k;
    this.apply();
    if (k < 1) this.tcp(this.cmdP, this.cmdQ);
  }
  /* motion generators: each frame they receive dt through yield */
  *moveJ(pos, quat, speed = 1) {
    const q0 = this.q.slice(), q1 = this.solve(pos, quat, q0);
    if (!q1) return;
    let dm = 0; for (let i = 0; i < 6; i++) dm = Math.max(dm, Math.abs(q1[i] - q0[i]) * (i > 2 ? 0.55 : 1));
    const dur = Math.max(0.35, dm / (1.7 * speed) + 0.2);
    for (let t = 0; t < dur;) {
      t += yield; const u = quint(Math.min(1, t / dur));
      for (let i = 0; i < 6; i++) this.q[i] = q0[i] + (q1[i] - q0[i]) * u;
      this.apply();
    }
    this.cmdP.copy(pos); this.cmdQ.copy(quat);
  }
  *moveL(pos, quat, speed = 0.4, linear = false, onU) {
    const p0 = V(), r0 = Q(); this.tcp(p0, r0);
    const dur = Math.max(0.12, p0.distanceTo(pos) / speed, r0.angleTo(quat) / 2.2);
    for (let t = 0; t < dur;) {
      t += yield; const v = Math.min(1, t / dur), u = linear ? v : quint(v);
      _p.lerpVectors(p0, pos, u); _r.slerpQuaternions(r0, quat, u);
      this.goto(_p, _r); if (onU) onU(u);
    }
  }
  /* constant-speed path through world points (cutting contours, weld seams) */
  *path(pts, quatAt, speed, onStep) {
    const L = [0]; for (let i = 1; i < pts.length; i++) L.push(L[i - 1] + pts[i].distanceTo(pts[i - 1]));
    const total = L[L.length - 1]; let s = 0, i = 1;
    while (s < total) {
      s = Math.min(total, s + speed * (yield));
      while (i < pts.length - 1 && L[i] < s) i++;
      const u = (s - L[i - 1]) / Math.max(1e-6, L[i] - L[i - 1]);
      _p.lerpVectors(pts[i - 1], pts[i], clamp(u, 0, 1));
      this.goto(_p, quatAt(_p, s / total));
      if (onStep) onStep(s / total, i);
    }
  }
  dispose() { this.root.parent && this.root.parent.remove(this.root); }
}
function* wait(sec) { for (let t = 0; t < sec;) t += yield; }

/* a tool orientation from its working direction (TCP +X) and an "up" hint (TCP +Z) */
function orient(dir, up, out = Q()) {
  const x = dir.clone().normalize(), z = up.clone().addScaledVector(x, -up.dot(x));
  if (z.lengthSq() < 1e-6) z.set(0, 0, 1).addScaledVector(x, -x.z);
  z.normalize(); const y = V().crossVectors(z, x);
  return out.setFromRotationMatrix(new T.Matrix4().makeBasis(x, y, z));
}
/* a swan-neck torch: wire along dir, roll chosen so the torch body (bent 45 degrees from the wire about TCP Z)
   points as close as possible to bodyPref (usually straight down from the wrist) */
function neckOrient(dir, bodyPref = V(0, -1, 0)) {
  const d = dir.clone().normalize(), w = bodyPref.clone().addScaledVector(d, -bodyPref.dot(d));
  if (w.lengthSq() < 1e-6) w.set(1, 0, 0).addScaledVector(d, -d.x);
  w.normalize();
  return orient(d, V().crossVectors(d, w));
}
const radialUp = (p, root) => { const r = V(p.x - root.x, 0, p.z - root.z); return r.lengthSq() < 1e-4 ? V(1, 0, 0) : r.normalize(); };

/* ------------------------------------------------------------------ effects */
class Sparks {
  constructor(scene, n = 320, surf = () => 0) {
    this.n = n; this.surf = surf; this.i = 0;
    this.pos = new Float32Array(n * 6); this.col = new Float32Array(n * 6);
    this.p = new Float32Array(n * 3); this.v = new Float32Array(n * 3); this.life = new Float32Array(n); this.max = new Float32Array(n).fill(1);
    const g = this.g = new T.BufferGeometry();
    g.setAttribute("position", new T.BufferAttribute(this.pos, 3)); g.setAttribute("color", new T.BufferAttribute(this.col, 3));
    this.o = new T.LineSegments(g, new T.LineBasicMaterial({ vertexColors: true, transparent: true, blending: T.AdditiveBlending, depthWrite: false, toneMapped: false }));
    this.o.frustumCulled = false; this.o.renderOrder = 5; this.o.layers.set(FX_LAYER); this.o.layers.enable(BLOOM_LAYER); scene.add(this.o);
  }
  emit(p, n, dir, spread = 1, speed = 2.4, life = 0.7) {
    for (let k = 0; k < n; k++) {
      const i = this.i++ % this.n, j = i * 3, s = speed * (0.35 + Math.random());
      this.life[i] = this.max[i] = life * (0.35 + Math.random() * 0.8);
      this.p[j] = p.x; this.p[j + 1] = p.y; this.p[j + 2] = p.z;
      this.v[j] = (dir.x + rnd(spread)) * s; this.v[j + 1] = (dir.y + rnd(spread)) * s; this.v[j + 2] = (dir.z + rnd(spread)) * s;
    }
  }
  update(dt) {
    const P = this.p, Vv = this.v, pos = this.pos, col = this.col;
    for (let i = 0; i < this.n; i++) {
      const j = i * 3, o = i * 6;
      if (this.life[i] <= 0) { pos[o + 1] = pos[o + 4] = -99; continue; }
      this.life[i] -= dt;
      Vv[j + 1] -= 9.8 * dt; Vv[j] *= 0.985; Vv[j + 2] *= 0.985;
      P[j] += Vv[j] * dt; P[j + 1] += Vv[j + 1] * dt; P[j + 2] += Vv[j + 2] * dt;
      const fy = this.surf(P[j], P[j + 2], P[j + 1] - Vv[j + 1] * dt);
      if (P[j + 1] < fy && Vv[j + 1] < 0) { P[j + 1] = fy; Vv[j + 1] *= -0.28; Vv[j] *= 0.55; Vv[j + 2] *= 0.55; }
      const h = this.life[i] / this.max[i], L = 0.016 + 0.01 * h;
      pos[o] = P[j]; pos[o + 1] = P[j + 1]; pos[o + 2] = P[j + 2];
      pos[o + 3] = P[j] - Vv[j] * L; pos[o + 4] = P[j + 1] - Vv[j + 1] * L; pos[o + 5] = P[j + 2] - Vv[j + 2] * L;
      const r = 1.4 * h + 0.3, gch = 1.1 * h * h + 0.12, b = 0.8 * h * h * h;
      col[o] = r; col[o + 1] = gch; col[o + 2] = b; col[o + 3] = r * 0.4; col[o + 4] = gch * 0.3; col[o + 5] = 0;
    }
    this.g.attributes.position.needsUpdate = true; this.g.attributes.color.needsUpdate = true;
  }
  dispose() { this.o.parent && this.o.parent.remove(this.o); this.g.dispose(); }
}

class Glow {          /* arc light: a hot core, a halo and a flickering point light */
  constructor(scene, kind = "glow", size = 0.07, light = 0xbfd4ff, power = 7, halo = 7) {
    const mk = (s, o) => { const m = new T.SpriteMaterial({ map: tex(kind), color: 0xffffff, blending: T.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false, opacity: o }); const sp = new T.Sprite(m); sp.scale.setScalar(s); sp.renderOrder = 6; sp.layers.set(FX_LAYER); sp.layers.enable(BLOOM_LAYER); scene.add(sp); return sp; };
    this.core = mk(size, 1); this.halo = mk(size * halo, 0.3);
    this.light = new T.PointLight(light, 0, 5, 2); scene.add(this.light);
    this.size = size; this.power = power; this.on = 0;
    this.list = scene.userData.glows || (scene.userData.glows = []); this.list.push(this);      // the arc bloom asks whether any arc is burning
  }
  set(on, p, dt) {
    this.on = lerp(this.on, on ? 1 : 0, on ? 0.6 : 0.35);
    const f = this.on * (0.75 + Math.random() * 0.5);
    [this.core, this.halo].forEach(s => { s.visible = this.on > 0.02; if (p) s.position.copy(p); });
    this.core.scale.setScalar(this.size * (0.7 + 0.6 * f)); this.halo.material.opacity = 0.26 * f;
    if (p) this.light.position.copy(p);
    this.light.intensity = this.power * f;
  }
  dispose() { [this.core, this.halo, this.light].forEach(o => o.parent && o.parent.remove(o)); const i = this.list.indexOf(this); if (i >= 0) this.list.splice(i, 1); }
}

class Smoke {
  constructor(scene, n = 26, color = 0x9aa1a4) {
    this.items = []; this.i = 0;
    for (let k = 0; k < n; k++) {
      const s = new T.Sprite(new T.SpriteMaterial({ map: tex("smoke"), color, transparent: true, depthWrite: false, opacity: 0 }));
      s.visible = false; s.layers.set(FX_LAYER); scene.add(s); this.items.push({ s, life: 0, v: V() });
    }
  }
  emit(p, rate = 1, dt = 0.016) {
    this.acc = (this.acc || 0) + rate * dt * 14;
    while (this.acc > 1) {
      this.acc--; const it = this.items[this.i++ % this.items.length];
      it.life = 1; it.s.visible = true; it.s.position.copy(p); it.v.set(rnd(0.05), 0.22 + Math.random() * 0.15, rnd(0.05));
    }
  }
  update(dt) {
    for (const it of this.items) {
      if (it.life <= 0) { it.s.visible = false; continue; }
      it.life -= dt * 0.42; it.s.position.addScaledVector(it.v, dt);
      const a = it.life; it.s.material.opacity = 0.22 * a * (1 - a) * 4 * 0.6; it.s.scale.setScalar(0.08 + (1 - a) * 0.5);
    }
  }
  dispose() { this.items.forEach(it => it.s.parent && it.s.parent.remove(it.s)); }
}

/* weld bead: rings along a seam, each grows when deposited and glows while hot */
const HEAT_GLSL = mat => {
  mat.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nattribute float heat;\nvarying float vHeat;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvHeat = heat;");
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nvarying float vHeat;")
      .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(1.0,0.32,0.06)*pow(vHeat,1.6)*7.0 + vec3(1.0,0.85,0.55)*pow(vHeat,5.0)*12.0;");
  };
  return mat;
};
class Bead {
  constructor(parent, a, b, off, rad = 0.0056, rings = 110, sides = 10) {
    this.n = rings; this.sides = sides; this.amount = new Float32Array(rings); this.heatT = new Float32Array(rings).fill(-1e9);
    const t = V().subVectors(b, a).normalize(), u = off.clone().normalize(), w = V().crossVectors(t, u).normalize();
    const nv = rings * sides, pos = new Float32Array(nv * 3), heat = new Float32Array(nv), idx = [];
    this.base = new Float32Array(nv * 3); this.ctr = new Float32Array(nv * 3);
    for (let i = 0; i < rings; i++) {
      const c = V().lerpVectors(a, b, i / (rings - 1)).addScaledVector(u, rad * 0.55);
      const rip = 1 + 0.09 * Math.sin(i * 1.7);
      for (let j = 0; j < sides; j++) {
        const ang = (j / sides) * Math.PI * 2, k = (i * sides + j) * 3;
        const o = V().addScaledVector(u, Math.cos(ang) * rad * 0.62 * rip).addScaledVector(w, Math.sin(ang) * rad * 1.05 * rip);
        this.base.set([o.x, o.y, o.z], k); this.ctr.set([c.x, c.y, c.z], k); pos.set([c.x, c.y, c.z], k);
      }
    }
    for (let i = 0; i < rings - 1; i++) for (let j = 0; j < sides; j++) {
      const a0 = i * sides + j, a1 = i * sides + (j + 1) % sides, b0 = a0 + sides, b1 = a1 + sides;
      idx.push(a0, b0, a1, a1, b0, b1);
    }
    const g = this.g = new T.BufferGeometry();
    g.setAttribute("position", new T.BufferAttribute(pos, 3)); g.setAttribute("heat", new T.BufferAttribute(heat, 1)); g.setIndex(idx);
    g.computeVertexNormals();
    this.mesh = mesh(g, HEAT_GLSL(stdMat(0x8f918c, 0.36, 0.85)), false); this.mesh.frustumCulled = false; parent.add(this.mesh);
    this.dirty = true;
  }
  deposit(u, now, width = 1) {
    const c = Math.round(u * (this.n - 1));
    for (let i = Math.max(0, c - width); i <= Math.min(this.n - 1, c + width); i++) if (this.amount[i] < 1) { this.amount[i] = Math.max(this.amount[i], 0.02); this.heatT[i] = now; this.dirty = true; }
  }
  done() { let k = 0; for (let i = 0; i < this.n; i++) if (this.amount[i] > 0.5) k++; return k / this.n; }
  reset() { this.amount.fill(0); this.heatT.fill(-1e9); this.dirty = true; this.update(0, 0); }
  update(dt, now) {
    const pos = this.g.attributes.position.array, heat = this.g.attributes.heat.array;
    let any = this.dirty;
    for (let i = 0; i < this.n; i++) {
      const age = now - this.heatT[i], h = age >= 0 ? Math.exp(-age / 2.6) : 0;
      if (this.amount[i] > 0 && this.amount[i] < 1) { this.amount[i] = Math.min(1, this.amount[i] + dt * 7); any = true; }
      if (h > 0.003 || this.dirty) {
        any = true;
        for (let j = 0; j < this.sides; j++) heat[i * this.sides + j] = h;
      }
      if (any) {
        const a = this.amount[i];
        for (let j = 0; j < this.sides; j++) { const k = (i * this.sides + j) * 3; for (let e = 0; e < 3; e++) pos[k + e] = this.ctr[k + e] + this.base[k + e] * a; }
      }
    }
    if (any) { this.g.attributes.position.needsUpdate = true; this.g.attributes.heat.needsUpdate = true; this.g.computeVertexNormals(); }
    this.dirty = false;
  }
  dispose() { this.mesh.parent && this.mesh.parent.remove(this.mesh); this.g.dispose(); }
}

/* cutting plate: canvases for the steel, the hot kerf and the holes */
class Plate {
  constructor(scene, c, size = 1.0, thick = 0.008) {
    this.c = c.clone(); this.s = size; this.t = thick; this.group = new T.Group(); scene.add(this.group);
    const mk = (w, h) => { const cv = document.createElement("canvas"); cv.width = w; cv.height = h; return cv; };
    this.cb = mk(1024, 1024); this.cg = mk(512, 512); this.ca = mk(512, 512);
    this.xb = this.cb.getContext("2d"); this.xg = this.cg.getContext("2d"); this.xa = this.ca.getContext("2d");
    this.tb = new T.CanvasTexture(this.cb); this.tb.colorSpace = T.SRGBColorSpace; this.tb.anisotropy = 8;
    this.tg = new T.CanvasTexture(this.cg); this.tg.colorSpace = T.SRGBColorSpace; this.ta = new T.CanvasTexture(this.ca);
    const top = this.top = mesh(new T.PlaneGeometry(size, size), stdMat(0xffffff, 0.52, 0.65, { map: this.tb, emissiveMap: this.tg, emissive: 0xffffff, alphaMap: this.ta, alphaTest: 0.5 }), false);
    top.rotation.x = -Math.PI / 2; top.position.y = thick; this.group.add(top);
    const bot = mesh(new T.PlaneGeometry(size, size), stdMat(0x3c4144, 0.6, 0.6, { alphaMap: this.ta, alphaTest: 0.5, side: T.BackSide }), true);
    bot.rotation.x = -Math.PI / 2; this.group.add(bot);
    const edgeM = stdMat(0x5e6468, 0.45, 0.8);
    [[size, thick, 0.002, 0, size / 2], [size, thick, 0.002, 0, -size / 2], [0.002, thick, size, size / 2, 0], [0.002, thick, size, -size / 2, 0]].forEach(([w, h, d, x, z]) => { const e = mesh(new T.BoxGeometry(w, h, d), edgeM); e.position.set(x, h / 2, z); this.group.add(e); });
    this.group.position.copy(this.c);
    this.parts = []; this.reset();
  }
  reset() {
    const x = this.xb, W = 1024;
    x.fillStyle = "#70777b"; x.fillRect(0, 0, W, W);
    for (let i = 0; i < 260; i++) { x.fillStyle = `rgba(${Math.random() < 0.5 ? "40,48,56" : "150,158,162"},${0.03 + Math.random() * 0.05})`; x.beginPath(); x.ellipse(Math.random() * W, Math.random() * W, 20 + Math.random() * 120, 10 + Math.random() * 50, Math.random() * 3, 0, 7); x.fill(); }
    const id = x.getImageData(0, 0, W, W), d = id.data;
    for (let i = 0; i < d.length; i += 4) { const n = (Math.random() - 0.5) * 16; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
    x.putImageData(id, 0, 0);
    this.xg.fillStyle = "#000"; this.xg.fillRect(0, 0, 512, 512);
    this.xa.fillStyle = "#fff"; this.xa.fillRect(0, 0, 512, 512);
    this.tb.needsUpdate = this.tg.needsUpdate = this.ta.needsUpdate = true;
    this.parts.forEach(p => { p.mesh.parent && p.mesh.parent.remove(p.mesh); p.mesh.geometry.dispose(); }); this.parts = [];
    this.glowing = 0;
  }
  uv(p) { const h = this.s / 2; return [(p.x - (this.c.x - h)) / this.s, (p.z - (this.c.z - h)) / this.s]; }   // canvas x, y (0..1)
  inside(p, m = 0.01) { const [u, v] = this.uv(p); return u > m && u < 1 - m && v > m && v < 1 - m; }
  cut(a, b) {
    const [u0, v0] = this.uv(a), [u1, v1] = this.uv(b);
    const x = this.xb, W = 1024;
    x.lineCap = "round";
    x.strokeStyle = "rgba(120,86,52,.16)"; x.lineWidth = 22; x.beginPath(); x.moveTo(u0 * W, v0 * W); x.lineTo(u1 * W, v1 * W); x.stroke();
    x.strokeStyle = "rgba(58,74,110,.28)"; x.lineWidth = 12; x.stroke();
    x.strokeStyle = "rgba(40,36,34,.75)"; x.lineWidth = 7; x.stroke();
    x.strokeStyle = "#0b0c0d"; x.lineWidth = 4; x.stroke();
    const g = this.xg; g.lineCap = "round";
    g.strokeStyle = "rgba(255,90,20,.9)"; g.lineWidth = 7; g.beginPath(); g.moveTo(u0 * 512, v0 * 512); g.lineTo(u1 * 512, v1 * 512); g.stroke();
    g.strokeStyle = "rgba(255,200,120,1)"; g.lineWidth = 3; g.stroke();
    g.strokeStyle = "rgba(255,250,235,1)"; g.lineWidth = 1.2; g.stroke();
    this.tb.needsUpdate = this.tg.needsUpdate = true; this.glowing = 2.5;
  }
  update(dt) {
    if (this.glowing > 0) {
      this.glowing -= dt;
      this.fadeAcc = (this.fadeAcc || 0) + dt;
      if (this.fadeAcc > 0.05) { this.xg.fillStyle = `rgba(0,0,0,${Math.min(0.5, this.fadeAcc * 1.6)})`; this.xg.fillRect(0, 0, 512, 512); this.tg.needsUpdate = true; this.fadeAcc = 0; }
    }
    for (const p of this.parts) {
      if (p.t < 1) { p.t = Math.min(1, p.t + dt * 1.6); p.mesh.position.y = p.y0 - p.drop * quint(p.t); p.mesh.rotation.x = p.tilt * quint(p.t); }
      if (p.mesh.material.emissiveIntensity > 0) p.mesh.material.emissiveIntensity = Math.max(0, p.mesh.material.emissiveIntensity - dt * 0.6);
      if (p.slug && p.t >= 1) p.mesh.visible = false;
    }
  }
  /* a closed contour (world points): punch it out of the plate and drop the piece */
  hole(pts, slug) {
    const x = this.xa; x.fillStyle = "#000"; x.beginPath();
    pts.forEach((p, i) => { const [u, v] = this.uv(p); i ? x.lineTo(u * 512, v * 512) : x.moveTo(u * 512, v * 512); }); x.closePath(); x.fill();
    this.ta.needsUpdate = true;
    try {
      const shape = new T.Shape(pts.map(p => new T.Vector2(p.x - this.c.x, -(p.z - this.c.z))));
      const g = new T.ExtrudeGeometry(shape, { depth: this.t, bevelEnabled: false, curveSegments: 4 });
      g.rotateX(-Math.PI / 2);
      const m = stdMat(0x767d81, 0.5, 0.7, { emissive: 0xff5a10, emissiveIntensity: 0.9 });
      const part = mesh(g, m); part.position.y = 0.0003; this.group.add(part);
      this.parts.push({ mesh: part, t: 0, y0: 0.0003, drop: slug ? 0.35 : 0.004, tilt: slug ? 0.4 : rnd(0.03), slug });
    } catch (e) { /* self-intersecting outline: hole only */ }
  }
  dispose() {
    this.reset(); this.group.parent && this.group.parent.remove(this.group);
    [this.tb, this.tg, this.ta].forEach(t => t.dispose());
    this.group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material && o.material.dispose) o.material.dispose(); });
  }
}

/* bent sheet: a thick strip whose fold angle can change every frame */
class Sheet {
  constructor(len1, len2, width, thick = 0.003, material) {
    this.l1 = len1; this.l2 = len2; this.w = width; this.t = thick; this.angle = 0; this.n = 10;
    const cols = 2 + 2 + this.n + 1, nv = cols * 4;
    this.g = new T.BufferGeometry(); this.g.setAttribute("position", new T.BufferAttribute(new Float32Array(nv * 3), 3));
    const idx = [], ring = i => i * 4;
    for (let i = 0; i < cols - 1; i++) {
      const a = ring(i), b = ring(i + 1);
      [[0, 1], [1, 2], [2, 3], [3, 0]].forEach(([p, q]) => idx.push(a + p, b + p, a + q, a + q, b + p, b + q));
    }
    const f = (a, b, c, d) => idx.push(a, b, c, a, c, d);
    f(0, 1, 2, 3); const l = ring(cols - 1); f(l + 3, l + 2, l + 1, l);
    this.g.setIndex(idx); this.cols = cols;
    this.mesh = mesh(this.g, material || stdMat(0xaab0b4, 0.4, 0.8)); this.set(0);
  }
  /* angle: how far the +X flange folds up (radians); the -X flange stays flat in the local frame */
  set(angle) {
    this.angle = angle;
    const pts = [], R = 0.006, n = this.n;
    pts.push([-this.l1, 0, 0]); pts.push([-0.001, 0, 0]);
    for (let i = 0; i <= n; i++) { const a = angle * i / n; pts.push([Math.sin(a) * R, R - Math.cos(a) * R, a]); }
    const end = pts[pts.length - 1];
    pts.push([end[0] + Math.cos(angle) * this.l2 * 0.5, end[1] + Math.sin(angle) * this.l2 * 0.5, angle]);
    pts.push([end[0] + Math.cos(angle) * this.l2, end[1] + Math.sin(angle) * this.l2, angle]);
    const pos = this.g.attributes.position.array, t = this.t, w = this.w / 2;
    pts.slice(0, this.cols).forEach(([x, y, a], i) => {
      const nx = -Math.sin(a), ny = Math.cos(a), k = i * 12;
      const v = [[x, y, -w], [x, y, w], [x + nx * t, y + ny * t, w], [x + nx * t, y + ny * t, -w]];
      v.forEach((p, j) => pos.set(p, k + j * 3));
    });
    this.g.attributes.position.needsUpdate = true; this.g.computeVertexNormals(); this.g.computeBoundingSphere();
  }
}

/* soft contact shadow under everything that stands on the floor (depth from below, blurred) */
const FX_LAYER = 1;
class ContactShadow {
  constructor(scene, size = 9, res = 512, opacity = 0.7, height = 1.4) {
    this.rt = new T.WebGLRenderTarget(res, res); this.rt.texture.generateMipmaps = false;
    this.rtB = new T.WebGLRenderTarget(res, res); this.rtB.texture.generateMipmaps = false;
    const g = new T.PlaneGeometry(size, size).rotateX(Math.PI / 2);
    this.plane = new T.Mesh(g, new T.MeshBasicMaterial({ map: this.rt.texture, opacity, transparent: true, depthWrite: false, toneMapped: false }));
    this.plane.scale.y = -1; this.plane.position.y = 0.0012; this.plane.renderOrder = 1; this.plane.layers.set(FX_LAYER); scene.add(this.plane);
    this.blurPlane = new T.Mesh(g); this.blurPlane.visible = false;
    this.cam = new T.OrthographicCamera(-size / 2, size / 2, size / 2, -size / 2, 0, height); this.cam.rotation.x = Math.PI / 2;
    this.dm = new T.MeshDepthMaterial(); this.dm.depthTest = this.dm.depthWrite = false;
    this.dm.onBeforeCompile = sh => { sh.fragmentShader = sh.fragmentShader.replace("gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );", "gl_FragColor = vec4( vec3( 0.0 ), ( 1.0 - fragCoordZ ) * 1.15 );"); };
    this.h = new T.ShaderMaterial(HorizontalBlurShader); this.v = new T.ShaderMaterial(VerticalBlurShader);
    this.h.depthTest = this.v.depthTest = false; this.frame = 0;
  }
  blur(R, amount) {
    const b = this.blurPlane; b.visible = true;
    b.material = this.h; this.h.uniforms.tDiffuse.value = this.rt.texture; this.h.uniforms.h.value = amount / 256;
    R.setRenderTarget(this.rtB); R.render(b, this.cam);
    b.material = this.v; this.v.uniforms.tDiffuse.value = this.rtB.texture; this.v.uniforms.v.value = amount / 256;
    R.setRenderTarget(this.rt); R.render(b, this.cam); b.visible = false;
  }
  update(R, scene) {
    if (this.frame++ % 2) return;
    const bg = scene.background, cc = R.getClearColor(new T.Color()), ca = R.getClearAlpha(), sm = R.shadowMap.autoUpdate;
    scene.background = null; scene.overrideMaterial = this.dm; R.shadowMap.autoUpdate = false;
    R.setClearColor(0x000000, 0); R.setRenderTarget(this.rt); R.clear(); R.render(scene, this.cam);
    scene.overrideMaterial = null;
    this.blur(R, 2.6); this.blur(R, 1.0);
    R.setRenderTarget(null); R.setClearColor(cc, ca); scene.background = bg; R.shadowMap.autoUpdate = sm;
  }
}

/* a restrained glow round the arc (larger screens only): the arc light and the sparks are drawn once more at a
   quarter of the size, blurred and added over the picture. It costs nothing while no arc is burning. */
const BLOOM_LAYER = 2;
const FSQ = "varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }";
class ArcBloom {
  constructor(strength = 0.42) {
    const rt = () => { const r = new T.WebGLRenderTarget(4, 4, { depthBuffer: false }); r.texture.generateMipmaps = false; return r; };
    this.a = rt(); this.b = rt(); this.px = new T.Vector2(1, 1); this.hot = 0; this.cc = new T.Color();
    this.blur = new T.ShaderMaterial({ uniforms: { t: { value: null }, d: { value: new T.Vector2() } }, vertexShader: FSQ, depthTest: false, depthWrite: false,
      fragmentShader: "uniform sampler2D t; uniform vec2 d; varying vec2 vUv; void main(){ vec4 c = texture2D(t, vUv) * 0.227027; c += (texture2D(t, vUv + d * 1.384615) + texture2D(t, vUv - d * 1.384615)) * 0.316216; c += (texture2D(t, vUv + d * 3.230769) + texture2D(t, vUv - d * 3.230769)) * 0.070270; gl_FragColor = c; }" });
    this.add = new T.ShaderMaterial({ uniforms: { t: { value: null }, k: { value: strength } }, vertexShader: FSQ, depthTest: false, depthWrite: false, transparent: true, blending: T.AdditiveBlending, premultipliedAlpha: true,
      fragmentShader: "uniform sampler2D t; uniform float k; varying vec2 vUv; void main(){ gl_FragColor = vec4(sqrt(texture2D(t, vUv).rgb) * k, 0.0); }" });
    this.quad = new T.Mesh(new T.PlaneGeometry(2, 2), this.blur); this.quad.frustumCulled = false;
    this.cam = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }
  size(w, h) { w = Math.max(4, Math.round(w)); h = Math.max(4, Math.round(h)); this.a.setSize(w, h); this.b.setSize(w, h); this.px.set(1 / w, 1 / h); }
  render(R, scene, cam, dt) {
    const glows = scene.userData.glows; let on = 0;
    if (glows) for (const g of glows) on = Math.max(on, g.on);
    this.hot = on > 0.03 ? 1.2 : this.hot - dt;                  // sparks outlive the arc by about a second
    if (this.hot <= 0) return;
    const mask = cam.layers.mask, bg = scene.background, cc = R.getClearColor(this.cc), ca = R.getClearAlpha(), sm = R.shadowMap.autoUpdate, au = R.autoClear;
    cam.layers.set(BLOOM_LAYER); scene.background = null; R.shadowMap.autoUpdate = false;
    R.setClearColor(0x000000, 0); R.setRenderTarget(this.a); R.clear(); R.render(scene, cam);
    cam.layers.mask = mask; scene.background = bg;
    const q = this.quad, u = this.blur.uniforms; q.material = this.blur;
    for (const s of [1, 2.3]) {
      u.t.value = this.a.texture; u.d.value.set(s * this.px.x, 0); R.setRenderTarget(this.b); R.render(q, this.cam);
      u.t.value = this.b.texture; u.d.value.set(0, s * this.px.y); R.setRenderTarget(this.a); R.render(q, this.cam);
    }
    R.setRenderTarget(null); R.setClearColor(cc, ca); R.shadowMap.autoUpdate = sm;
    R.autoClear = false; q.material = this.add; this.add.uniforms.t.value = this.a.texture; R.render(q, this.cam); R.autoClear = au;
  }
  dispose() { this.a.dispose(); this.b.dispose(); this.blur.dispose(); this.add.dispose(); this.quad.geometry.dispose(); }
}

/* ------------------------------------------------------------------ tasks */
const TASKS = {};
const S_ = s => s;

/* small fallback props when a cell model has not been exported */
function fallbackCell(name) {
  const g = new T.Group(), dark = stdMat(0x2b3033, 0.6, 0.4), steel = stdMat(0x9aa0a5, 0.35, 0.9), grey = stdMat(0xd7dbd9, 0.5, 0.1);
  const box = (w, h, d, x, y, z, m) => { const b = mesh(new T.BoxGeometry(w, h, d), m); b.position.set(x, y, z); g.add(b); return b; };
  if (name === "weld") { box(1.5, 0.04, 1.0, 1.15, 0.78, 0, dark); [[0.45, .35], [1.85, .35], [0.45, -.35], [1.85, -.35]].forEach(([x, z]) => box(0.08, 0.76, 0.08, x, 0.38, z, dark)); const w = new T.Group(); w.name = "WORKPIECE"; w.position.set(1.15, 0.8, 0); g.add(w); const p1 = mesh(new T.BoxGeometry(0.6, 0.012, 0.36), steel); p1.position.y = 0.006; w.add(p1); const p2 = mesh(new T.BoxGeometry(0.5, 0.16, 0.01), steel); p2.position.y = 0.092; w.add(p2); }
  if (name === "cut") { box(1.2, 0.7, 1.4, 1.35, 0.35, 0, dark); const a = new T.Object3D(); a.name = "PLATE"; a.position.set(1.35, 0.78, 0); g.add(a); }
  if (name === "bend") { box(0.5, 0.95, 2.4, 1.75, 0.475, 0, grey); const ram = new T.Group(); ram.name = "RAM"; g.add(ram); const r = mesh(new T.BoxGeometry(0.4, 0.5, 2.3), grey); r.position.set(1.7, 1.42, 0); ram.add(r); box(0.6, 0.75, 0.5, 0.45, 0.375, 1.05, dark).name = "x"; const ia = new T.Object3D(); ia.name = "INPUT_TABLE"; ia.position.set(0.45, 0.75, 1.05); g.add(ia); box(0.6, 0.75, 0.5, 0.45, 0.375, -1.05, dark); const oa = new T.Object3D(); oa.name = "OUTPUT_TABLE"; oa.position.set(0.45, 0.75, -1.05); g.add(oa); }
  if (name === "palletise") { box(2.5, 0.72, 0.62, 1.35, 0.36, 1.1, dark); const pa = new T.Object3D(); pa.name = "PICK"; pa.position.set(0.95, 0.75, 1.1); g.add(pa); }
  if (name === "tend") { box(1.5, 2.4, 1.9, 1.9, 1.2, 0, grey); }
  if (name === "solution") {          /* stand-in for cell_solution.glb, to the same node contract (plain blocks) */
    const yel = stdMat(0xd9b233, 0.5, 0.1), raw = stdMat(0x7d858a, 0.42, 0.85), scr = stdMat(0x2a3033, 0.6, 0.2, { transparent: true, opacity: 0.45 });
    const N = (n, p, x = 0, y = 0, z = 0) => { const o = new T.Group(); o.name = n; o.position.set(x, y, z); (p || g).add(o); return o; };
    const bx = (p, w, h, d, x, y, z, m) => { const b = mesh(new T.BoxGeometry(w, h, d), m); b.position.set(x, y, z); p.add(b); return b; };
    const rail = N("GRP_rail"); bx(rail, 0.62, 0.14, 3.6, 0, 0.07, 0, dark); [0.22, -0.22].forEach(x => bx(rail, 0.05, 0.03, 3.5, x, 0.155, 0, steel));
    const car = N("RAIL_CARRIAGE", rail, 0, 0.17, 0); bx(car, 0.7, 0.07, 0.7, 0, 0.035, 0, grey); N("ROBOT_BASE", car, 0, 0.07, 0);
    const pos = N("GRP_positioner", null, 1.35);
    bx(N("stand_a", pos), 0.42, 1.15, 0.36, 0, 0.575, 1.42, grey); bx(N("stand_b", pos), 0.3, 1.15, 0.26, 0, 0.575, -1.4, grey); bx(N("bed", pos), 0.3, 0.1, 2.6, 0, 0.05, 0, dark);
    const rot = N("POS_ROT", pos, 0, 0.95, 0); [1.2, -1.24].forEach(z => { const d = mesh(new T.CylinderGeometry(0.2, 0.2, 0.04, 32), steel); d.rotation.x = Math.PI / 2; d.position.z = z; rot.add(d); });
    const wp = N("WORKPIECE", rot);
    [[0.06, 2.4, -0.32, 0], [0.06, 2.4, 0.32, 0], [0.7, 0.06, 0, 0.97], [0.7, 0.06, 0, -0.97], [0.7, 0.06, 0, 0]].forEach(([w, d, x, z]) => bx(wp, w, 0.06, d, x, 0, z, raw));
    bx(wp, 0.5, 0.01, 0.8, 0, 0.035, 0.48, raw); bx(wp, 0.01, 0.2, 1.7, -0.355, 0, 0, raw);
    [[-0.25, 0.03, 0.08, -1, -0.785, 0.8], [-0.25, 0.03, 0.88, 0, -0.785, 0.5], [0.25, 0.03, 0.88, 1, -0.785, 0.8], [-0.36, 0.03, -0.8, -1, 0.35, 0.7], [-0.36, -0.03, 0.8, 1, 2.79, 0.7], [-0.36, 0.03, 0.05, -1, 0.35, 0.7]]
      .forEach(([x, y, z, ry, rx, len], i) => { const s = N("SEAM_0" + i, wp, x, y, z); s.rotation.set(rx, ry * Math.PI / 2, 0, "YXZ"); s.rotateX(Math.PI / 2); s.userData.len = len; });
    const pk = N("GRP_weldpack"); bx(N("source", pk), 0.45, 0.8, 0.7, -1.0, 0.4, 1.25, grey);
    const cyl = mesh(new T.CylinderGeometry(0.115, 0.115, 1.4, 24), dark); cyl.position.set(-1.0, 0.7, 0.55); N("gas", pk).add(cyl);
    bx(N("clean", pk), 0.22, 0.84, 0.22, 0.8, 0.42, 1.78, dark); N("CLEAN_TCP", pk, 0.8, 0.9, 1.78);
    const vis = N("GRP_vision"); bx(vis, 0.1, 2.7, 0.1, 2.35, 1.35, -1.1, dark); const boom = bx(vis, 1.3, 0.07, 0.07, 1.9, 2.65, -0.65, dark); boom.rotation.y = Math.PI / 4; bx(vis, 0.14, 0.16, 0.14, 1.45, 2.55, -0.2, grey); N("CAM_EYE", vis, 1.45, 2.47, -0.2);
    const gd = N("GRP_guard"), panel = (x, z, alongX) => { const p = N("panel", gd, x, 0, z); if (alongX) p.rotation.y = Math.PI / 2; bx(p, 0.03, 1.9, 1.1, 0, 1.0, 0, scr); [0.55, -0.55].forEach(d => bx(p, 0.05, 2.05, 0.05, 0, 1.025, d, yel)); };
    [-1.725, -0.575, 0.575, 1.725].forEach(z => panel(-1.6, z, false)); [-1.025, 0.125, 1.275, 2.425].forEach(x => panel(x, -2.35, true)); [-1.76, -0.59].forEach(z => panel(3.0, z, false));
    bx(N("lc_a", gd), 0.08, 1.8, 0.08, 3.0, 0.9, 0.05, yel); bx(N("lc_b", gd), 0.08, 1.8, 0.08, 3.0, 0.9, 2.3, yel); N("LC_A", gd, 3.0, 0, 0.05); N("LC_B", gd, 3.0, 0, 2.3);
    const ct = N("GRP_controls"), cab = N("cabinet", ct, -1.1, 0, -1.85); bx(cab, 0.8, 1.9, 0.5, 0, 0.95, 0, grey);
    [["LAMP_R", "lamp_red", 0xc8322a, 2.1], ["LAMP_A", "lamp_amber", 0xe0a020, 2.02], ["LAMP_G", "lamp_green", 0x35b84a, 1.94]].forEach(([n, mn, c, y]) => { const m = stdMat(c, 0.4, 0); m.name = mn; const l = mesh(new T.CylinderGeometry(0.04, 0.04, 0.07, 20), m); N(n, cab, 0.25, y, 0).add(l); });
    const op = N("station", ct, 2.3, 0, 2.25); bx(op, 0.12, 1.0, 0.12, 0, 0.5, 0, dark); bx(op, 0.5, 0.34, 0.06, 0, 1.2, 0, dark); N("HMI", op, 0, 1.2, -0.04);
  }
  return g;
}

/* shared helpers for all tasks */
function taskBase(S, arm, cell, opts) {
  const t = Object.assign({ count: 0, hot: {}, follow: false, clickables: [], fx: [] }, opts);
  t.robot = () => arm.J[2].getWorldPosition(V());
  t.tool = () => arm.tcp(V());
  return t;
}
function lamps(cell) {
  const find = n => { let m = null; cell.traverse(o => { if (!m && o.isMesh && o.material && new RegExp(n, "i").test(o.material.name)) m = o; }); return m; };
  const L = { g: find("lamp_green"), a: find("lamp_amber"), r: find("lamp_red") };
  Object.values(L).forEach(o => { if (o) { o.material = o.material.clone(); o.material.emissive = o.material.color.clone(); } });
  return s => { if (L.g) L.g.material.emissiveIntensity = s === 0 ? 3 : 0.05; if (L.a) L.a.material.emissiveIntensity = s === 1 ? 3 : 0.05; if (L.r) L.r.material.emissiveIntensity = 0.05; };
}

/* wire feeder on the forearm and the torch hose, redrawn every frame so it flexes with the wrist */
function torchHose(S, arm, t) {
  const fm = arm.feeder; let cin = null;
  arm.tool && arm.tool.traverse(o => { if (!cin && /^CABLE_IN(_\d+)?$/.test(o.name)) cin = o; });
  if (!fm || !cin) return { draw() {}, feeder: null, hose: null };
  const feeder = new T.Group(); fm.add(feeder);
  const body = mesh(new T.BoxGeometry(0.25, 0.15, 0.17), stdMat(0x2d3236, 0.45, 0.35)); body.position.y = 0.078; feeder.add(body);
  const lid = mesh(new T.BoxGeometry(0.2, 0.012, 0.15), stdMat(0x1c1f22, 0.35, 0.5)); lid.position.y = 0.158; feeder.add(lid);
  const spool = mesh(new T.CylinderGeometry(0.055, 0.055, 0.02, 32), stdMat(0xb87333, 0.35, 0.9)); spool.rotation.x = Math.PI / 2; spool.position.set(-0.03, 0.08, 0.086); feeder.add(spool);
  const out = new T.Object3D(); out.position.set(0.13, 0.06, 0); feeder.add(out);
  const hose = mesh(new T.BufferGeometry(), stdMat(0x18191b, 0.62, 0.0)); hose.frustumCulled = false; S.scene.add(hose);
  t.fx.push({ dispose() { hose.parent && hose.parent.remove(hose); hose.geometry.dispose(); feeder.parent && feeder.parent.remove(feeder); } });
  const draw = () => {
    arm.root.updateWorldMatrix(true, true);
    const a = out.getWorldPosition(V()), b = cin.getWorldPosition(V());
    const da = V(1, 0, 0).transformDirection(out.matrixWorld), db = V(1, 0, 0).transformDirection(cin.matrixWorld);
    const L = a.distanceTo(b);
    const c = new T.CatmullRomCurve3([a, a.clone().addScaledVector(da, 0.12 + L * 0.15).add(V(0, -0.02, 0)),
      a.clone().lerp(b, 0.55).add(V(0, -0.06 - L * 0.08, 0)), b.clone().addScaledVector(db, 0.1 + L * 0.12), b]);
    hose.geometry.dispose(); hose.geometry = new T.TubeGeometry(c, 36, 0.013, 8, false);
  };
  return { draw, feeder, hose };
}

/* ---- arc welding */
TASKS.weld = {
  cell: "weld", tool: "torch", model: "mr6-2080", follow: true,
  cam: { az: 1.08, el: 0.27, look: [0.95, 1.0, 0.05], dist: 6.2 },
  make(S, arm, cell) {
    const t = taskBase(S, arm, cell, { follow: true, stat: "s_weld" });
    let W = cell.getObjectByName("WORKPIECE");
    if (!W) { W = new T.Group(); W.position.set(1.15, 0.8, 0); cell.add(W); }
    cell.updateWorldMatrix(true, true);
    arm.root.position.x = Math.max(0, W.position.x - 0.36 * arm.reach() - 0.42);
    const top = 0.012, home = W.position.clone();
    const seams = [
      { a: V(-0.25, top, 0.005), b: V(0.25, top, 0.005), n: V(0, 1, 1).normalize() },
      { a: V(0.25, top, -0.005), b: V(-0.25, top, -0.005), n: V(0, 1, -1).normalize() },
    ].map(s => Object.assign(s, { bead: new Bead(W, s.a, s.b, s.n), dir: V().subVectors(s.b, s.a).normalize() }));
    const sparks = new Sparks(S.scene, 360, (x, z, y) => { const p = W.worldToLocal(_p.set(x, y, z)); return Math.abs(p.x) < 0.3 && Math.abs(p.z) < 0.18 ? W.position.y + top : (Math.abs(x - 1.15) < 0.75 && Math.abs(z) < 0.5 ? 0.8 : 0); });
    const glow = new Glow(S.scene, "blue", 0.05, 0xc8d8ff, 4, 5), smoke = new Smoke(S.scene);
    t.fx.push(sparks, glow, smoke, ...seams.map(s => s.bead));
    const lamp = lamps(cell);
    const drawHose = torchHose(S, arm, t).draw;
    const wpt = (p, out = V()) => W.localToWorld(out.copy(p));
    const torchQ = (s, p) => {
      const nW = s.n.clone().transformDirection(W.matrixWorld), dW = s.dir.clone().transformDirection(W.matrixWorld);
      const dir = nW.clone().negate().addScaledVector(dW, 0.18).normalize();
      return neckOrient(dir, V(0, -1, 0).addScaledVector(radialUp(p, arm.root.position), 0.25));
    };
    const downQ = p => neckOrient(V(0, -1, 0.3).normalize(), V(0, -1, 0).addScaledVector(radialUp(p, arm.root.position), 0.3));
    let arc = false, lastTip = V(), now = 0;
    t.update = dt => {
      now += dt;
      const tip = arm.tcp(V());
      if (arc) {
        sparks.emit(tip, 5, V(0, 0.6, 0), 0.9, 2.2, 0.75); smoke.emit(tip, 1, dt);
        for (const s of seams) {                          // deposit where the wire actually is
          const a = wpt(s.a), b = wpt(s.b), ab = V().subVectors(b, a), u = clamp(V().subVectors(tip, a).dot(ab) / ab.lengthSq(), 0, 1);
          const d = V().lerpVectors(a, b, u).distanceTo(tip);
          if (d < 0.022) s.bead.deposit(u, now);
        }
      }
      glow.set(arc, tip, dt); sparks.update(dt); smoke.update(dt); drawHose();
      seams.forEach(s => { s.bead.update(dt, now); if (!s.counted && s.bead.done() > 0.96) { s.counted = true; t.done++; } });
      lamp(arc ? 1 : 0);
    };
    t.done = 0;
    t.program = function* () {
      arc = false;
      while (true) {
        for (const s of seams) {
          if (s.bead.done() > 0.96) continue;
          const a = wpt(s.a), b = wpt(s.b), nW = s.n.clone().transformDirection(W.matrixWorld);
          const q = torchQ(s, a);
          t.step = "move";
          yield* arm.moveJ(a.clone().addScaledVector(nW, 0.07), q, 1.1);
          yield* arm.moveL(a, q, 0.25);
          arc = true; t.step = "weld"; yield* wait(0.35);
          yield* arm.path([a, b], p => torchQ(s, p), 0.055);
          yield* wait(0.25); arc = false;
          yield* arm.moveL(b.clone().addScaledVector(nW, 0.08), q, 0.35);
        }
        // part finished: retract, let it cool, hoist it away and bring a fresh blank
        const park = wpt(V(-0.1, 0.38, 0.12));
        t.step = "cool";
        yield* arm.moveJ(park, downQ(park), 0.9);
        yield* wait(1.6);
        t.step = "swap";
        for (let k = 0; k < 1;) { k = Math.min(1, k + (yield) / 1.1); W.position.y = home.y + 0.5 * quint(k); W.rotation.y = 0.25 * quint(k); }
        seams.forEach(s => { s.bead.reset(); s.counted = false; }); W.rotation.y = 0;
        for (let k = 0; k < 1;) { k = Math.min(1, k + (yield) / 1.0); W.position.y = home.y + 0.5 * (1 - quint(k)); }
        W.position.copy(home);
      }
    };
    /* pointer driving: hover follows; on a seam the arc strikes and the bead goes down where the wire is */
    const plane = new T.Plane(V(0, 1, 0), 0);
    const guides = seams.map(sm => {          // dashed guide along each seam while a visitor drives
      const g = new T.BufferGeometry().setFromPoints([sm.a.clone().addScaledVector(sm.n, 0.012), sm.b.clone().addScaledVector(sm.n, 0.012)]);
      const l = new T.Line(g, new T.LineDashedMaterial({ color: 0x5bc46a, dashSize: 0.02, gapSize: 0.012, transparent: true, opacity: 0.9, toneMapped: false }));
      l.computeLineDistances(); l.visible = false; l.layers.set(FX_LAYER); W.add(l); return l;
    });
    t.fx.push({ dispose() { guides.forEach(l => { l.parent && l.parent.remove(l); l.geometry.dispose(); }); } });
    t.user = (dt, ray) => {
      guides.forEach((l, i) => { l.visible = seams[i].bead.done() < 0.96; });
      if (!ray) { arc = false; return; }
      plane.constant = -(W.position.y + top);
      const hit = ray.intersectPlane(plane, V()); if (!hit) { arc = false; return; }
      const lp = W.worldToLocal(hit.clone());
      let s = null;
      if (Math.abs(lp.x) < 0.27 && Math.abs(lp.z) < 0.12) s = lp.z >= 0 ? seams[0] : seams[1];
      let target, q;
      if (s) {
        const x = clamp(lp.x, -0.25, 0.25);
        target = wpt(V(x, top, s.a.z)); q = torchQ(s, target);
        arc = arm.tcp(V()).distanceTo(target) < 0.03;
      } else {
        target = hit.clone(); target.y = Math.max(hit.y, W.position.y) + 0.12; q = downQ(target); arc = false;
      }
      arm.follow(target, q, dt);
    };
    t.stopUser = () => { arc = false; guides.forEach(l => { l.visible = false; }); };
    t.hot = { robot: t.robot, torch: t.tool, table: () => wpt(V(0.2, 0.05, 0.16)), fence: () => anchor(cell, "SCREEN_HOT", V(1.4, 1.3, -0.9)), cabinet: () => anchor(cell, "LAMP_A", V(-0.75, 1.3, -0.95)) };
    t.statN = () => t.done;
    t._dbg = { seams, W };
    return t;
  },
};

/* ---- plasma cutting */
TASKS.cut = {
  cell: "cut", tool: "plasma", model: "mr6-2080", follow: true,
  cam: { az: 1.15, el: 0.42, look: [1.15, 0.9, 0.05], dist: 5.8 },
  make(S, arm, cell) {
    const t = taskBase(S, arm, cell, { follow: true, stat: "s_cut" });
    const pa = anchor(cell, "PLATE", V(1.35, 0.78, 0));
    arm.root.position.x = Math.max(0, pa.x - 0.36 * arm.reach() - 0.28);
    const plate = new Plate(S.scene, pa, 1.0, 0.008);
    const topY = pa.y + 0.008, SO = 0.004;
    const sparks = new Sparks(S.scene, 380, (x, z, y) => (plate.inside(_p.set(x, 0, z), 0) && y > topY - 0.02 ? topY : (Math.abs(x - pa.x) < 0.62 && Math.abs(z - pa.z) < 0.72 ? pa.y - 0.35 : 0)));
    const glow = new Glow(S.scene, "blue", 0.04, 0xd0c8ff, 2.2, 3.5), smoke = new Smoke(S.scene, 22, 0x8d9295);
    t.fx.push(sparks, glow, smoke, plate);
    const lamp = lamps(cell);
    const ptW = (u, v) => V(pa.x + u, topY + SO, pa.z + v);
    const rr = (cx, cz, w, h, r, n = 8) => { const o = []; const cs = [[w / 2 - r, h / 2 - r, 0], [-w / 2 + r, h / 2 - r, 1], [-w / 2 + r, -h / 2 + r, 2], [w / 2 - r, -h / 2 + r, 3]];
      cs.forEach(([x, z, k]) => { for (let i = 0; i <= n; i++) { const a = (k + i / n) * Math.PI / 2; o.push(ptW(cx + x + Math.cos(a) * r, cz + z + Math.sin(a) * r)); } }); o.push(o[0].clone()); return o; };
    const circ = (cx, cz, r, n = 28) => { const o = []; for (let i = 0; i <= n; i++) { const a = i / n * Math.PI * 2; o.push(ptW(cx + Math.cos(a) * r, cz + Math.sin(a) * r)); } return o; };
    const nests = [[-0.22, 0.2], [0.22, 0.2], [-0.22, -0.2], [0.22, -0.2]].map(([u, v]) => ({
      done: false,
      contours: [circ(u - 0.11, v - 0.075, 0.02), circ(u + 0.11, v - 0.075, 0.02), circ(u - 0.11, v + 0.075, 0.02), circ(u + 0.11, v + 0.075, 0.02),
        rr(u, v, 0.08, 0.035, 0.0175), rr(u, v, 0.34, 0.27, 0.045)],
    }));
    const downQ = p => orient(V(0, -1, 0), radialUp(p, arm.root.position));
    let arc = false, now = 0, last = null, stroke = [], strokeLen = 0;
    const lift = (p, h = 0.07) => p.clone().setY(topY + h);
    t.update = dt => {
      now += dt;
      const tip = arm.tcp(V());
      const onPlate = plate.inside(tip, 0.005) && Math.abs(tip.y - (topY + SO)) < 0.012;
      if (arc && onPlate) {
        if (last) plate.cut(last, tip);
        last = tip.clone();
        sparks.emit(V(tip.x, topY - 0.01, tip.z), 6, V(0, -1, 0), 0.35, 2.6, 0.55);
        if (Math.random() < 0.4) sparks.emit(tip, 1, V(0, 0.8, 0), 1, 1.4, 0.35);
        smoke.emit(tip, 0.6, dt);
      } else last = null;
      glow.set(arc && onPlate, tip, dt);
      sparks.update(dt); smoke.update(dt); plate.update(dt);
      lamp(arc ? 1 : 0);
    };
    t.done = 0;
    t.program = function* () {
      arc = false;
      while (true) {
        for (const n of nests) {
          if (n.done) continue;
          const ok = n.contours[n.contours.length - 1].every((p, i) => i % 6 || arm.can(p, downQ(p)));
          if (!ok) { n.done = true; continue; }
          for (let k = 0; k < n.contours.length; k++) {
            const c = n.contours[k], outer = k === n.contours.length - 1;
            t.step = "move";
            yield* arm.moveJ(lift(c[0]), downQ(c[0]), 1.2);
            yield* arm.moveL(c[0], downQ(c[0]), 0.2);
            arc = true; t.step = "pierce"; sparks.emit(c[0], 40, V(0, 1, 0), 0.8, 1.6, 0.5); yield* wait(0.4);   // pierce
            t.step = "cut";
            yield* arm.path(c, p => downQ(p), 0.1);
            arc = false; plate.hole(c, !outer);
            yield* arm.moveL(lift(c[c.length - 1], 0.05), downQ(c[0]), 0.4);
          }
          n.done = true; t.done++;
        }
        const park = V(pa.x - 0.35, topY + 0.45, pa.z + 0.1);
        t.step = "plate";
        yield* arm.moveJ(park, downQ(park), 0.9);
        yield* wait(2.2);
        for (let k = 0; k < 1;) { k = Math.min(1, k + (yield) / 1.2); plate.group.position.x = pa.x + 1.6 * quint(k); }
        plate.reset(); nests.forEach(n => n.done = false);
        for (let k = 0; k < 1;) { k = Math.min(1, k + (yield) / 1.2); plate.group.position.x = pa.x - 1.6 * (1 - quint(k)); }
        plate.group.position.x = pa.x;
      }
    };
    const plane = new T.Plane(V(0, 1, 0), 0);
    t.user = (dt, ray) => {
      if (!ray) { arc = false; return; }
      plane.constant = -(topY + SO);
      const hit = ray.intersectPlane(plane, V()); if (!hit) { arc = false; return; }
      if (plate.inside(hit, 0.012)) {
        const q = downQ(hit);
        if (!arm.can(hit, q)) { arc = false; arm.follow(lift(hit, 0.1), q, dt); return; }
        arm.follow(hit, q, dt, 0.7);
        const tip = arm.tcp(V());
        arc = tip.distanceTo(hit) < 0.05 || arc;
        if (arc) {   // close a loop and the piece falls out
          const p2 = tip.clone().setY(topY);
          if (stroke.length) strokeLen += p2.distanceTo(stroke[stroke.length - 1].p);
          stroke.push({ p: p2, s: strokeLen });
          for (let i = 0; i < stroke.length - 12; i++) {
            if (strokeLen - stroke[i].s > 0.18 && stroke[i].p.distanceTo(p2) < 0.012) {
              const loop = stroke.slice(i).map(o => o.p.clone().setY(topY + SO));
              let area = 0; for (let j = 0; j < loop.length; j++) { const a = loop[j], b = loop[(j + 1) % loop.length]; area += a.x * b.z - b.x * a.z; }
              if (Math.abs(area) / 2 > 0.0012) { plate.hole(loop, false); t.done++; }
              stroke = []; strokeLen = 0; break;
            }
          }
          if (stroke.length > 1500) stroke.splice(0, 500);
        }
      } else { arc = false; stroke = []; strokeLen = 0; const p = hit.clone(); p.y = topY + 0.15; arm.follow(p, downQ(p), dt); }
    };
    t.stopUser = () => { arc = false; stroke = []; strokeLen = 0; };
    t.hot = { robot: t.robot, torch: t.tool, table: () => V(pa.x + 0.1, topY, pa.z + 0.45), cabinet: () => anchor(cell, "LAMP_A", V(-0.75, 1.3, -0.95)) };
    t.statN = () => t.done;
    t.dispose = () => plate.dispose();
    t._dbg = { plate, pa };
    return t;
  },
};

/* ---- press brake tending */
TASKS.bend = {
  cell: "bend", tool: "sheet", model: "mr6-2080", follow: false,
  cam: { az: 2.25, el: 0.4, look: [1.2, 1.1, 0.15], dist: 6.3 },
  make(S, arm, cell) {
    const t = taskBase(S, arm, cell, { stat: "s_bend" });
    const ram = cell.getObjectByName("RAM"), bg = cell.getObjectByName("BACKGAUGE");
    const ramY0 = ram ? ram.position.y : 0, bgX0 = bg ? bg.position.x : 0;
    const dieX = 1.55, dieY = 0.95;
    const inA = anchor(cell, "INPUT_TABLE", V(0.45, 0.75, 1.05)), outA = anchor(cell, "OUTPUT_TABLE", V(0.45, 0.75, -1.05));
    const L1 = 0.27, L2 = 0.11, Wd = 0.42, TH = 0.003;
    const sheetM = stdMat(0xb7bdc1, 0.36, 0.85);
    const blanks = new T.Group(); S.scene.add(blanks);
    const stackN = 8, blank = new T.BoxGeometry(L1 + L2, TH, Wd);
    for (let i = 0; i < stackN; i++) { const b = mesh(blank, sheetM); b.position.set(inA.x, inA.y + TH / 2 + i * TH * 1.4, inA.z); blanks.add(b); }
    const done = new T.Group(); S.scene.add(done);
    const sheet = new Sheet(L1, L2, Wd, TH, sheetM); sheet.mesh.visible = false; S.scene.add(sheet.mesh);
    let angle = Math.PI / 2, wantPress = false, pressing = 0;
    const lamp = lamps(cell);
    const downQ = (p, yaw = 0) => orient(V(0, -1, 0), V(Math.cos(yaw), 0, -Math.sin(yaw)));
    const gripOff = 0.13;                       // gripper holds the front flange this far from the bend line
    t.update = dt => { lamp(pressing ? 1 : 0); };
    t.done = 0;
    t.click = () => { wantPress = true; };
    t.setAngle = a => { angle = a; };
    const holdSheet = () => {                       // sheet frame rides on the tool's TCP
      const tcp = arm.tcpObj; sheet.mesh.visible = true;
      tcp.add(sheet.mesh);
      // TCP +X points down into the sheet and TCP +Z towards the press: sheet X = TCP Z, sheet normal = -TCP X
      sheet.mesh.quaternion.setFromRotationMatrix(new T.Matrix4().makeBasis(V(0, 0, 1), V(-1, 0, 0), V(0, -1, 0)));
      sheet.mesh.position.set(TH, 0, gripOff);
    };
    t.program = function* () {
      while (true) {
        const top = blanks.children.length ? blanks.children[blanks.children.length - 1].position.y + TH / 2 : inA.y;
        const pick = V(inA.x - L1 / 2 + gripOff + (L1 + L2) / 2 - L1 + 0.0, top, inA.z);
        pick.x = inA.x - (L1 + L2) / 2 + (L1 - gripOff);
        const yaw = 0;
        t.step = "pick";
        yield* arm.moveJ(pick.clone().setY(top + 0.12), downQ(pick, yaw), 1.1);
        yield* arm.moveL(pick, downQ(pick, yaw), 0.25);
        yield* wait(0.25);
        if (blanks.children.length) blanks.remove(blanks.children[blanks.children.length - 1]);
        sheet.set(0); holdSheet();
        yield* arm.moveL(pick.clone().setY(top + 0.15), downQ(pick, yaw), 0.4);
        // to the press: hold the sheet so its bend line sits on the die centre, back edge at the gauge
        const atDie = V(dieX - L1 + (L1 - gripOff), dieY + TH + 0.002, 0);
        atDie.x = dieX - gripOff;
        const pre = atDie.clone().add(V(-0.25, 0.12, 0));
        t.step = "feed";
        yield* arm.moveJ(pre, downQ(pre), 1.0);
        yield* arm.moveL(atDie.clone().add(V(-0.02, 0.01, 0)), downQ(atDie), 0.3);
        if (bg) for (let k = 0; k < 1;) { k = Math.min(1, k + (yield) / 0.5); bg.position.x = bgX0 + 0.04 * (1 - quint(k)); }
        yield* arm.moveL(atDie, downQ(atDie), 0.15);
        // wait for the visitor to press (a click while the robot was still feeding counts), or press after a moment
        for (let w = 0; w < 2.4 && !wantPress;) w += yield;
        wantPress = false;
        // ram down, sheet folds: both flanges rise, the robot follows its flange around the bend line
        pressing = 1; t.step = "press";
        const p0 = arm.tcp(V()), q0 = Q(); arm.tcp(V(), q0);
        const pivot = V(dieX, dieY + TH, 0);
        const close = 0.22;
        for (let k = 0; k < 1;) { k = Math.min(1, k + (yield) / 0.55); if (ram) ram.position.y = ramY0 - close * quint(k); }
        for (let k = 0; k < 1;) {
          k = Math.min(1, k + (yield) / 1.4); const e = quint(k), half = (Math.PI - angle) / 2 * e;
          if (ram) ram.position.y = ramY0 - close - 0.03 * e;
          const rot = Q().setFromAxisAngle(AX.Z, -half);
          const pp = p0.clone().sub(pivot).applyQuaternion(rot).add(pivot), qq = rot.clone().multiply(q0);
          arm.goto(pp, qq);
          sheet.set(2 * half);
        }
        yield* wait(0.2);
        for (let k = 0; k < 1;) { k = Math.min(1, k + (yield) / 0.6); if (ram) ram.position.y = ramY0 - (close + 0.03) * (1 - quint(k)); }
        pressing = 0;
        // out of the press and onto the output stack
        let pq = Q(), pp = arm.tcp(V(), pq);
        yield* arm.moveL(pp.clone().add(V(-0.12, 0.06, 0)), pq, 0.3);
        if (bg) bg.position.x = bgX0;
        t.step = "stack";
        const n = done.children.length % 6, place = V(outA.x, outA.y + 0.07 + n * 0.012, outA.z);
        const placeQ = downQ(place);
        yield* arm.moveJ(place.clone().setY(place.y + 0.18), placeQ, 1.0);
        yield* arm.moveL(place, placeQ, 0.3);
        // release: leave a copy of the bent part on the stack
        const part = new T.Mesh(sheet.g.clone(), sheetM); part.castShadow = part.receiveShadow = true;
        sheet.mesh.updateWorldMatrix(true, false); part.applyMatrix4(sheet.mesh.matrixWorld); done.add(part);
        if (done.children.length > 6) done.remove(done.children[0]);
        sheet.mesh.visible = false; sheet.mesh.parent && sheet.mesh.parent.remove(sheet.mesh);
        t.done++;
        yield* arm.moveL(place.clone().setY(place.y + 0.2), placeQ, 0.4);
        if (!blanks.children.length) for (let i = 0; i < stackN; i++) { const b = mesh(blank, sheetM); b.position.set(inA.x, inA.y + TH / 2 + i * TH * 1.4, inA.z); blanks.add(b); }
      }
    };
    t.hot = { robot: t.robot, press: () => V(dieX + 0.05, 1.5, 0.75), gripper: t.tool, stack: () => inA.clone().add(V(0, 0.05, 0)) };
    t._dbg = { sheet, ram };
    t.clickAny = true;
    t.statN = () => t.done;
    t.dispose = () => { [blanks, done, sheet.mesh].forEach(o => o.parent && o.parent.remove(o)); blank.dispose(); sheet.g.dispose(); done.children.forEach(c => c.geometry.dispose()); };
    return t;
  },
};

/* ---- palletising */
TASKS.palletise = {
  cell: "palletise", tool: "vacuum", model: "mr50-2185", follow: true,
  cam: { az: 1.22, el: 0.4, look: [0.25, 0.8, -0.2], dist: 7.6 },
  make(S, arm, cell) {
    const t = taskBase(S, arm, cell, { follow: true, stat: "s_palletise" });
    const rollers = []; cell.traverse(o => { if (/^ROLLER_\d+/.test(o.name)) rollers.push(o); });
    const pick = anchor(cell, "PICK", V(0.95, 0.75, 1.1));
    // pallet A sits 0.14 m nearer the robot inside its station so the far row stays within the MR50-2185's reach
    const stations = [anchor(cell, "PALLET_A", V(1.25, 0, -0.95)).add(V(-0.1, 0, 0.1)), anchor(cell, "PALLET_B", V(-0.85, 0, -1.0))];
    const boxProto = cell.getObjectByName("BOX_PROTO"), palProto = cell.getObjectByName("PALLET_PROTO");
    const mkBox = () => {
      if (boxProto) { const b = boxProto.clone(true); b.position.set(0, 0, 0); b.rotation.set(0, 0, 0); return b; }
      const g = new T.Group(); const m = mesh(new T.BoxGeometry(0.4, 0.25, 0.3), stdMat(0xc19a6b, 0.85, 0)); m.position.y = 0.125; g.add(m); return g;
    };
    const mkPallet = () => {
      if (palProto) { const p = palProto.clone(true); p.position.set(0, 0, 0); p.rotation.set(0, 0, 0); return p; }
      const g = new T.Group(); const m = mesh(new T.BoxGeometry(1.2, 0.144, 0.8), stdMat(0xa8835a, 0.9, 0)); m.position.y = 0.072; g.add(m); return g;
    };
    const tmp = mkBox(); const bb = new T.Box3().setFromObject(tmp); const BX = bb.max.x - bb.min.x, BH = bb.max.y - bb.min.y, BZ = bb.max.z - bb.min.z;
    const tp = mkPallet(); const pb = new T.Box3().setFromObject(tp); const PX = pb.max.x - pb.min.x, PH = pb.max.y - pb.min.y, PZ = pb.max.z - pb.min.z;
    // layer patterns that fit the pallet: long side along X, then turned 90 degrees, alternating (interlock)
    const pattern = turned => {
      const bx = turned ? BZ : BX, bz = turned ? BX : BZ, nx = Math.floor(PX / bx + 1e-6), nz = Math.floor(PZ / bz + 1e-6), out = [];
      for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) out.push({ x: (i - (nx - 1) / 2) * bx, z: (j - (nz - 1) / 2) * bz, turned });
      return out;
    };
    const LAYERS = 3, pats = [pattern(true), pattern(false)];
    const pal = stations.map(p => { const o = mkPallet(); o.position.copy(p); S.scene.add(o); return { at: p, obj: o, boxes: [], layer: 0, filled: new Set(), away: false }; });
    let active = 0;
    const queue = [], world = new T.Group(); S.scene.add(world);
    const spawn = () => { const b = mkBox(); b.position.set(pick.x + 1.75, pick.y, pick.z); world.add(b); queue.push(b); };
    spawn();
    let held = null, suck = 0, ghost = null;
    const lamp = lamps(cell);
    const gripQ = (yaw) => orient(V(0, -1, 0), V(Math.cos(yaw), 0, -Math.sin(yaw)));
    const slotPos = (P, s) => V(P.at.x + s.x, PH + P.layer * BH, P.at.z + s.z);
    t.update = dt => {
      // conveyor: cases run to the stop while it is free; rollers turn under them
      let moving = false;
      queue.forEach((b, i) => {
        const stop = pick.x + i * (BX + 0.08);
        if (b.position.x > stop + 1e-4) { b.position.x = Math.max(stop, b.position.x - dt * 0.6); moving = true; }
      });
      if (moving) rollers.forEach(r => { r.rotation.z += dt * 0.6 / 0.025; });
      if (queue.length < 3 && (!queue.length || queue[queue.length - 1].position.x < pick.x + 1.2)) spawn();
      lamp(pal[active].away ? 1 : 0);
    };
    const grab = () => {
      held = queue.shift(); if (!held) return;
      arm.root.updateWorldMatrix(true, true); arm.tcpObj.attach(held);
    };
    const release = (P, s) => {
      if (!held) return;
      const p = slotPos(P, s); S.scene.attach(held); held.position.copy(p); held.rotation.set(0, s.turned ? Math.PI / 2 : 0, 0);
      P.obj.attach(held); P.boxes.push(held); P.filled.add(s.k); held = null;
      if (P.filled.size >= pats[P.layer % 2].length) { P.layer++; P.filled.clear(); }
      t.done++;
    };
    const nextSlot = (P, near) => {
      const pat = pats[P.layer % 2]; let best = null, bd = 1e9;
      pat.forEach((s, k) => {
        if (P.filled.has(k)) return;
        const top = slotPos(P, s).add(V(0, BH, 0));
        if (!arm.can(top, gripQ(s.turned ? Math.PI / 2 : 0))) { P.filled.add(k); return; }   // out of reach: leave the gap
        const d = near ? top.setY(0).distanceTo(V(near.x, 0, near.z)) : k; if (d < bd) { bd = d; best = Object.assign({ k }, s); }
      });
      if (!best && P.filled.size >= pat.length && P.layer < LAYERS) { P.layer++; P.filled.clear(); return nextSlot(P, near); }
      return best;
    };
    const swapPallet = function* (P) {
      P.away = true; t.step = "full";
      for (let k = 0; k < 1;) { k = Math.min(1, k + (yield) / 1.3); P.obj.position.z = P.at.z - 2.2 * quint(k); }
      P.obj.parent.remove(P.obj); P.obj = mkPallet(); P.obj.position.copy(P.at); P.obj.position.y = 0.6; S.scene.add(P.obj);
      P.boxes = []; P.layer = 0; P.filled.clear();
      for (let k = 0; k < 1;) { k = Math.min(1, k + (yield) / 0.8); P.obj.position.y = 0.6 * (1 - quint(k)); }
      P.away = false;
    };
    let swapping = null;
    t.done = 0;
    const pickSeq = function* () {
      t.step = "case";
      while (!queue.length || Math.abs(queue[0].position.x - pick.x) > 0.005) yield;
      const top = V(pick.x, pick.y + BH, pick.z);
      yield* arm.moveJ(top.clone().setY(top.y + 0.25), gripQ(0), 1.2);
      yield* arm.moveL(top, gripQ(0), 0.5);
      yield* wait(0.18); grab();
      yield* arm.moveL(top.clone().setY(top.y + 0.3), gripQ(0), 0.8);
    };
    const placeSeq = function* (P, s) {
      t.step = "place";
      const p = slotPos(P, s).add(V(0, BH, 0)), yaw = s.turned ? Math.PI / 2 : 0;
      const clear = Math.max(p.y, PH + (P.layer + 1) * BH) + 0.3;
      yield* arm.moveJ(p.clone().setY(clear), gripQ(yaw), 1.25);
      yield* arm.moveL(p.clone().setY(p.y + 0.01), gripQ(yaw), 0.5);
      release(P, s); yield* wait(0.12);
      yield* arm.moveL(p.clone().setY(clear), gripQ(yaw), 0.8);
    };
    t.program = function* () {
      while (true) {
        if (swapping) { const r = swapping.next(yield); if (r.done) swapping = null; continue; }
        const P = pal[active];
        if (!held) yield* pickSeq();
        const s = nextSlot(P);
        if (!s) { if (!P.away) { swapping = swapPallet(P); swapping.next(); active = 1 - active; } yield; continue; }   // pallet full
        yield* placeSeq(P, s);
        if (P.layer >= LAYERS) { swapping = swapPallet(P); swapping.next(); active = 1 - active; }
      }
    };
    // visitor: the robot fetches a case, carries it where you point; click places it on the nearest free slot
    let busy = null, aim = null;
    const plane = new T.Plane(V(0, 1, 0), 0);
    t.user = (dt, ray, clicked) => {
      if (busy) { const r = busy.next(dt); if (r.done) busy = null; return; }
      if (!held) { busy = pickSeq(); busy.next(); return; }
      if (!ray) return;
      let bestP = null, bestS = null, bd = 1e9;
      pal.forEach((P, i) => { if (P.away) return; plane.constant = -(PH + P.layer * BH); const h = ray.intersectPlane(plane, V()); if (!h) return; const s = nextSlot(P, h); if (!s) return; const d = slotPos(P, s).setY(0).distanceTo(V(h.x, 0, h.z)); if (d < bd) { bd = d; bestP = P; bestS = s; aim = h; } });
      if (!bestP || bd > 1.2) { if (aim) { const p = aim.clone(); p.y = Math.max(p.y, 1.3); arm.follow(p, gripQ(0), dt, 1.4); } return; }
      const p = slotPos(bestP, bestS).add(V(0, BH + 0.25, 0));
      arm.follow(p, gripQ(bestS.turned ? Math.PI / 2 : 0), dt, 1.4);
      if (!ghost) { ghost = mkBox(); ghost.traverse(o => { if (o.isMesh) { o.material = new T.MeshBasicMaterial({ color: 0x5bc46a, transparent: true, opacity: 0.28, depthWrite: false }); o.castShadow = false; } }); world.add(ghost); }
      ghost.visible = true; ghost.position.copy(slotPos(bestP, bestS)); ghost.rotation.set(0, bestS.turned ? Math.PI / 2 : 0, 0);
      if (clicked) { const P = bestP, s = bestS; busy = (function* () { yield* placeSeq(P, s); if (P.layer >= LAYERS) { swapping = swapPallet(P); swapping.next(); active = pal.indexOf(P) === 0 ? 1 : 0; } })(); busy.next(); ghost.visible = false; }
    };
    t.stopUser = () => { if (ghost) ghost.visible = false; busy = null; };
    t.hot = { robot: t.robot, conveyor: () => pick.clone().add(V(0.8, 0.3, 0)), gripper: t.tool, pallet: () => stations[0].clone().add(V(0, 0.5, 0)) };
    t.statN = () => t.done;
    t.dispose = () => { pal.forEach(P => P.obj.parent && P.obj.parent.remove(P.obj)); world.parent && world.parent.remove(world); };
    t._dbg = { pal, stations };
    return t;
  },
};

/* ---- CNC machine tending */
TASKS.tend = {
  cell: "tend", tool: "jaw", model: "mr6-2080", follow: false,
  cam: { az: 1.95, el: 0.32, look: [0.8, 1.15, 0.3], dist: 7.4 },
  make(S, arm, cell) {
    const t = taskBase(S, arm, cell, { stat: "s_tend" });
    const door = cell.getObjectByName("DOOR"), spindle = cell.getObjectByName("SPINDLE"), cutter = cell.getObjectByName("TOOL_SPIN");
    const doorZ0 = door ? door.position.z : 0, spY0 = spindle ? spindle.position.y : 0;
    const spUp = spY0 + 0.22, spCut = spY0 - 0.24;          // raised for loading (gripper clearance), down to the part top
    if (spindle) spindle.position.y = spUp;
    const vise = anchor(cell, "VISE", V(1.75, 0.95, 0)), grid = anchor(cell, "GRID_TABLE", V(0.25, 0.85, 1.0));
    arm.root.position.x = Math.max(0, vise.x - 0.62 * arm.reach() - 0.3);
    const byName = (root, re) => { let f = null; root && root.traverse(o => { if (!f && re.test(o.name)) f = o; }); return f; };
    const fl = byName(arm.tool, /^FINGER_L(_\d+)?$/), fr = byName(arm.tool, /^FINGER_R(_\d+)?$/);
    // fingers slide along the tool's local Y in three.js (Blender Z): 40 mm open, 22 mm closed each side
    const fy = [fl ? fl.position.y : 0.04, fr ? fr.position.y : -0.04];
    const jaw = open => { const k = open ? 1 : 0.55; if (fl) fl.position.y = fy[0] * k; if (fr) fr.position.y = fy[1] * k; };
    const rawM = stdMat(0x8b9094, 0.55, 0.8), finM = stdMat(0xd2d6d9, 0.18, 1.0);
    const rawG = new T.CylinderGeometry(0.028, 0.028, 0.07, 32), finG = new T.LatheGeometry([[0, 0], [0.028, 0], [0.028, 0.012], [0.02, 0.016], [0.02, 0.03], [0.026, 0.034], [0.026, 0.062], [0.022, 0.07], [0, 0.07]].map(([r, y]) => new T.Vector2(r, y - 0.035)), 40);
    const parts = [];
    for (let i = 0; i < 12; i++) {
      const m = mesh(rawG, rawM); const gx = (i % 4 - 1.5) * 0.09, gz = (Math.floor(i / 4) - 1) * 0.09;
      m.position.set(grid.x + gx, grid.y + 0.035, grid.z + gz); m.userData = { home: m.position.clone(), state: "raw", i }; S.scene.add(m); parts.push(m);
    }
    const coolant = new Sparks(S.scene, 220, () => vise.y - 0.02); coolant.o.material.blending = T.NormalBlending;
    const chips = new Sparks(S.scene, 160, () => vise.y - 0.01);
    t.fx.push(coolant, chips);
    const lamp = lamps(cell);
    let running = 0, next = null, held = null;
    const downQ = p => orient(V(0, -1, 0), radialUp(p, arm.root.position));
    const intoQ = () => orient(V(1, -0.15, 0).normalize(), V(0, 1, 0));
    t.update = dt => {
      if (cutter && running) cutter.rotation.y += dt * 60;
      if (running) {
        const tip = vise.clone().add(V(0, 0.05, 0));
        coolant.emit(tip.clone().add(V(-0.06, 0.12, 0.05)), 3, V(0.5, -0.8, -0.4).normalize(), 0.15, 1.8, 0.5);
        chips.emit(tip, 2, V(0, 0.5, 0), 1.2, 1.2, 0.4);
      }
      coolant.update(dt); chips.update(dt);
      lamp(running ? 0 : 1);
    };
    const pickable = () => parts.filter(p => p.userData.state === "raw");
    const rc = new T.Raycaster();
    t.click = ray => { rc.ray.copy(ray); const h = rc.intersectObjects(pickable(), false)[0]; if (h) { next = h.object; mark.visible = true; } };
    const mark = mesh(new T.TorusGeometry(0.045, 0.004, 8, 40), new T.MeshBasicMaterial({ color: 0x5bc46a, toneMapped: false }), false);
    mark.rotation.x = Math.PI / 2; mark.visible = false; S.scene.add(mark);
    const take = p => { arm.root.updateWorldMatrix(true, true); arm.tcpObj.attach(p); held = p; };
    const drop = (p, at) => { S.scene.attach(p); p.position.copy(at); p.rotation.set(0, 0, 0); held = null; };
    t.clickables = () => pickable();
    const doorTo = function* (open) { if (!door) return; const z0 = door.position.z, z1 = doorZ0 - (open ? 0.75 : 0); for (let k = 0; k < 1;) { k = Math.min(1, k + (yield) / 0.7); door.position.z = lerp(z0, z1, quint(k)); } };
    t.done = 0;
    t.program = function* () {
      while (true) {
        let p = next && next.userData.state === "raw" ? next : pickable()[0]; next = null;
        if (p) { mark.position.copy(p.position).setY(p.position.y - 0.033); mark.visible = true; }
        if (!p) { parts.forEach(o => { o.userData.state = "raw"; o.geometry = rawG; o.material = rawM; o.position.copy(o.userData.home); }); continue; }
        const above = p.position.clone().add(V(0, 0.16, 0)), at = p.position.clone().add(V(0, 0.01, 0));
        jaw(true); t.step = "pick";
        yield* arm.moveJ(above, downQ(above), 1.2);
        yield* arm.moveL(at, downQ(at), 0.3);
        jaw(false); yield* wait(0.2); take(p); p.userData.state = "held"; if (mark.visible && next === null) mark.visible = false;
        yield* arm.moveL(above, downQ(above), 0.5);
        t.step = "load";
        yield* doorTo(true);
        const front = V(vise.x - 0.55, vise.y + 0.25, vise.z), over = vise.clone().add(V(0, 0.14, 0)), seat = vise.clone().add(V(0, 0.022, 0));
        yield* arm.moveJ(front, downQ(front), 1.1);
        yield* arm.moveL(over, downQ(over), 0.45);
        yield* arm.moveL(seat, downQ(seat), 0.2);
        jaw(true); drop(p, seat.clone().add(V(0, -0.012, 0))); yield* wait(0.25);
        yield* arm.moveL(over, downQ(over), 0.4);
        yield* arm.moveL(front, downQ(front), 0.6);
        yield* doorTo(false);
        // machining: spindle down, coolant on, the blank becomes the part
        running = 1; t.step = "run";
        for (let k = 0; k < 1;) { k = Math.min(1, k + (yield) / 0.7); if (spindle) spindle.position.y = lerp(spUp, spCut, quint(k)); }
        for (let w = 0; w < 2.6;) { w += yield; if (spindle) spindle.position.y = spCut - 0.004 * (1 - Math.cos(w * 5)); }
        p.geometry = finG; p.material = finM;
        for (let k = 0; k < 1;) { k = Math.min(1, k + (yield) / 0.7); if (spindle) spindle.position.y = lerp(spCut, spUp, quint(k)); }
        running = 0; t.step = "unload";
        yield* doorTo(true);
        yield* arm.moveL(over, downQ(over), 0.5);
        yield* arm.moveL(seat, downQ(seat), 0.2);
        jaw(false); take(p); yield* wait(0.2);
        yield* arm.moveL(over, downQ(over), 0.4);
        yield* arm.moveL(front, downQ(front), 0.6);
        const home = p.userData.home.clone().add(V(0, 0.01, 0)), ab = home.clone().add(V(0, 0.16, 0));
        yield* arm.moveJ(ab, downQ(ab), 1.2);
        yield* arm.moveL(home, downQ(home), 0.3);
        jaw(true); drop(p, p.userData.home); p.userData.state = "done"; t.done++;
        yield* arm.moveL(ab, downQ(ab), 0.5);
      }
    };
    t.hot = { robot: t.robot, machine: () => V(vise.x - 0.4, 1.6, 0.6), parts: () => grid.clone().add(V(0, 0.08, 0)), light: () => anchor(cell, "LAMP_A", V(1.9, 2.3, -0.8)) };
    t.statN = () => t.done;
    t.dispose = () => { parts.forEach(p => p.parent && p.parent.remove(p)); mark.parent && mark.parent.remove(mark); rawG.dispose(); finG.dispose(); mark.geometry.dispose(); };
    return t;
  },
};

/* ---- the whole solution: a welding cell that builds itself one device at a time (home page, driven by scrolling)
   Part k of eight arrives while the page moves its number from k - 1 to k: 1 robot, 2 tool and welding package,
   3 positioner and part, 4 rail, 5 vision camera, 6 guarding, 7 controls, 8 the cell runs. Nothing welds below 8. */
const PARTS = ["robot", "tool", "positioner", "rail", "vision", "guard", "controls", "service"];
const settle = u => { const a = 6.5, f = x => 1 - (1 + a * x) * Math.exp(-a * x); return f(clamp(u, 0, 1)) / f(1); };   // soft start, long weighted stop, never past the mark
const sstep = (a, b, x) => { const u = clamp((x - a) / (b - a), 0, 1); return u * u * (3 - 2 * u); };
const hasMesh = o => { let f = false; o.traverse(c => { if (c.isMesh) f = true; }); return f; };
const under = (o, a) => { if (!a) return false; for (; o; o = o.parent) if (o === a) return true; return false; };
const boxOf = (...objs) => { const b = new T.Box3(); objs.forEach(o => o && b.expandByObject(o)); return b; };
const CELL_MID = V(0.3, 0, 0);
/* which way is "out of the cell" for something standing at this box: along the floor axis that leads away from the middle */
const outward = b => { const c = b.getCenter(V()), dx = c.x - CELL_MID.x, dz = c.z - CELL_MID.z; return Math.abs(dx) > Math.abs(dz) ? V(Math.sign(dx) || 1, 0, 0) : V(0, 0, Math.sign(dz) || 1); };
/* A group that was exported as one joined mesh per material is taken apart again into the things it is made of (a fence
   panel, a cabinet, a stand), so that each can arrive on its own. Shells are found by welding equal positions; the
   large upright ones seed the pieces and every smaller shell joins the piece it stands nearest to. Long flat shells
   on the floor (a base beam, a cable tray, a painted line) form a "bed" piece and long cables a "lines" piece. Each
   piece ends up as a child Group of g, flagged userData.keep, with plain world-aligned geometry. */
function shatter(g, seedH, seedW = 0) {
  g.updateWorldMatrix(true, true);
  const inv = new T.Matrix4().copy(g.matrixWorld).invert(), src = [], shells = [], v = V();
  const walk = o => o.children.forEach(c => { if (!c.isMesh && KEEP.test(c.name)) return; if (c.isMesh && !Array.isArray(c.material)) src.push(c); walk(c); });
  walk(g);
  for (const m of src) {
    const pos = m.geometry.attributes.position, idx = m.geometry.index, n = pos.count, par = new Int32Array(n), key = new Map();
    const M = new T.Matrix4().multiplyMatrices(inv, m.matrixWorld), P = new Float32Array(n * 3), ix = i => (idx ? idx.getX(i) : i), nt = (idx ? idx.count : n) / 3;
    const find = i => { while (par[i] !== i) { par[i] = par[par[i]]; i = par[i]; } return i; };
    for (let i = 0; i < n; i++) {
      par[i] = i; v.fromBufferAttribute(pos, i).applyMatrix4(M); P[i * 3] = v.x; P[i * 3 + 1] = v.y; P[i * 3 + 2] = v.z;
      const k = Math.round(v.x * 4000) + "," + Math.round(v.y * 4000) + "," + Math.round(v.z * 4000), j = key.get(k);
      if (j === undefined) key.set(k, i); else par[find(i)] = find(j);
    }
    for (let t = 0; t < nt; t++) { const a = find(ix(t * 3)); par[find(ix(t * 3 + 1))] = a; par[find(ix(t * 3 + 2))] = a; }
    const by = new Map(), info = { m, P, ix, N: new T.Matrix3().getNormalMatrix(M) };
    for (let i = 0; i < n; i++) { const r = find(i); let sh = by.get(r); if (!sh) { sh = { info, box: new T.Box3(), tris: [], to: null }; by.set(r, sh); shells.push(sh); } sh.box.expandByPoint(v.set(P[i * 3], P[i * 3 + 1], P[i * 3 + 2])); }
    for (let t = 0; t < nt; t++) by.get(find(ix(t * 3))).tris.push(t);
  }
  const soft = sh => /cable|hose/i.test(sh.info.m.material.name), span = sh => Math.max(sh.box.max.x - sh.box.min.x, sh.box.max.z - sh.box.min.z);
  const gapXZ = (a, b) => Math.hypot(Math.max(0, a.min.x - b.max.x, b.min.x - a.max.x), Math.max(0, a.min.z - b.max.z, b.min.z - a.max.z));
  const seeds = shells.filter(sh => !soft(sh) && sh.box.max.y - sh.box.min.y >= seedH && span(sh) >= seedW);
  if (!seeds.length) return;
  // seeds that stand in the same place are one thing (a weld screen in front of its fence panel, a door on its cabinet);
  // panels that only meet at a corner stay apart
  const same = (a, b) => { const e = 0.06, w = Math.min(a.max.x, b.max.x) - Math.max(a.min.x, b.min.x) + 2 * e, d = Math.min(a.max.z, b.max.z) - Math.max(a.min.z, b.min.z) + 2 * e, ar = q => (q.max.x - q.min.x + 2 * e) * (q.max.z - q.min.z + 2 * e); return w > 0 && d > 0 && w * d >= 0.3 * Math.min(ar(a), ar(b)); };
  const clusters = [];
  for (const sh of seeds) {
    const hit = clusters.filter(c => c.shells.some(o => same(o.box, sh.box))), c = hit[0] || { box: new T.Box3(), shells: [], kind: "piece" };
    if (!hit.length) clusters.push(c);
    hit.slice(1).forEach(o => { c.box.union(o.box); c.shells.push(...o.shells); clusters.splice(clusters.indexOf(o), 1); });
    c.box.union(sh.box); c.shells.push(sh); sh.to = c;
  }
  const bed = { box: new T.Box3(), shells: [], kind: "bed" }, lines = { box: new T.Box3(), shells: [], kind: "lines" };
  for (const sh of shells) {
    if (sh.to) continue;
    if (soft(sh) ? span(sh) >= 1 : sh.box.max.y < 0.3 && span(sh) >= 1.5) { (soft(sh) ? lines : bed).shells.push(sh); continue; }
    let best = null, bd = 1e9; const c0 = sh.box.getCenter(V());
    for (const c of clusters) { const d = gapXZ(c.box, sh.box) + 0.001 * c.box.getCenter(v).distanceTo(c0); if (d < bd) { bd = d; best = c; } }
    best.shells.push(sh);
  }
  // walk the pieces round the cell, beginning after the widest gap: an open fence is walked from one end to the other
  const item = clusters.map(c => { const p = c.box.getCenter(V()); return { c, a: Math.atan2(p.z - CELL_MID.z, p.x - CELL_MID.x) }; }).sort((p, q) => p.a - q.a);
  let start = 0, gap = -1;
  item.forEach((it, i) => { const d = (item[(i + 1) % item.length].a - it.a + Math.PI * 4) % (Math.PI * 2); if (item.length > 1 && d > gap) { gap = d; start = (i + 1) % item.length; } });
  const out = [];
  for (const c of [bed, ...item.slice(start).concat(item.slice(0, start)).map(it => it.c), lines]) {
    if (!c.shells.length) continue;
    const pc = new T.Group(); pc.name = "PIECE"; pc.userData.keep = true; pc.userData.kind = c.kind; g.add(pc); out.push(pc);
    const per = new Map(); c.shells.forEach(sh => { if (!per.has(sh.info)) per.set(sh.info, []); per.get(sh.info).push(...sh.tris); });
    for (const [{ m, P, ix, N }, tris] of per) {
      const nrm = m.geometry.attributes.normal, uv = m.geometry.attributes.uv, map = new Map(), pp = [], nn = [], uu = [], ii = [];
      for (const t of tris) for (let e = 0; e < 3; e++) {
        const i = ix(t * 3 + e); let j = map.get(i);
        if (j === undefined) { j = map.size; map.set(i, j); pp.push(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]); if (nrm) { v.fromBufferAttribute(nrm, i).applyMatrix3(N).normalize(); nn.push(v.x, v.y, v.z); } if (uv) uu.push(uv.getX(i), uv.getY(i)); }
        ii.push(j);
      }
      const geo = new T.BufferGeometry(); geo.setAttribute("position", new T.Float32BufferAttribute(pp, 3));
      if (nrm) geo.setAttribute("normal", new T.Float32BufferAttribute(nn, 3)); if (uv) geo.setAttribute("uv", new T.Float32BufferAttribute(uu, 2));
      geo.setIndex(ii); geo.userData.own = true;
      const o = new T.Mesh(geo, m.material); o.name = m.name; pc.add(o);
    }
  }
  src.forEach(m => m.parent && m.parent.remove(m));
  // moving nodes that ride on a piece (the stack light on its cabinet) go with the piece they stand on
  const riders = []; g.traverse(c => { if (/^LAMP_/.test(c.name)) riders.push(c); });
  riders.forEach(c => { const p = c.getWorldPosition(V()); let best = null, bd = 1e9; out.forEach(pc => { if (pc.userData.kind !== "piece") return; const d = boxOf(pc).distanceToPoint(p); if (d < bd) { bd = d; best = pc; } }); if (best) best.attach(c); });
}
/* a soft rim of light on the part in focus */
function rimLight(m, u) {
  if (!m.isMeshStandardMaterial) return;
  m.onBeforeCompile = sh => {
    sh.uniforms.uRim = u;
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nuniform float uRim;")
      .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(0.5, 1.0, 0.6) * pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 3.2) * uRim;");
  };
}

TASKS.solution = {
  cell: "solution", tool: "torch", model: "mr6-2080", follow: false, noSeat: true, shadow: 5.4,
  cam: { az: 1.19, el: 0.44, look: [0.3, 0.8, 0], dist: 11 },
  /* per part: camera turn and lift from the base view, how far the frame leans from the whole cell to the part, and
     how close the camera comes (1 = everything built so far just fits; the finished cell is brought in to fill the frame) */
  views: { robot: [0.06, -0.06, 0.5, 1], tool: [-0.04, 0.02, 0.6, 0.92], positioner: [-0.2, 0.13, 0.45, 1], rail: [0.14, 0.1, 0.4, 1], vision: [-0.12, 0.1, 0.35, 1], guard: [0.02, 0.08, 0.2, 0.94], controls: [0.2, 0.08, 0.3, 0.88], service: [0, 0.14, 0, 0.86] },
  pre(cell) {
    cell.updateWorldMatrix(true, true);
    [["GRP_positioner", 0.8], ["GRP_weldpack", 0.7], ["GRP_guard", 1.2, 0.4], ["GRP_controls", 0.8]].forEach(([n, h, w]) => { const g = cell.getObjectByName(n); if (g) shatter(g, h, w); });
  },
  make(S, arm, cell) {
    const D = this, t = taskBase(S, arm, cell, { follow: false });
    const G = n => cell.getObjectByName(n);
    cell.updateWorldMatrix(true, true);
    const car = G("RAIL_CARRIAGE"), rb = G("ROBOT_BASE"), rot = G("POS_ROT");
    let W = G("WORKPIECE");
    if (!W) { W = new T.Group(); W.name = "WORKPIECE"; W.position.set(1.35, 0.95, 0); cell.add(W); cell.updateWorldMatrix(true, true); }

    /* the robot stands on the rail carriage and rides with it; while the rail has not arrived it stands on the floor */
    const base0 = rb ? rb.getWorldPosition(V()) : car ? car.getWorldPosition(V()) : V();
    const carHome = car ? car.position.clone() : V(), carAxis = car ? V(0, 0, 1).applyQuaternion(car.parent.getWorldQuaternion(Q()).invert()) : V(0, 0, 1);
    const LIM = car ? +car.userData.travel || 1.1 : 0;
    let rail = 0, seatU = 1, lift = 0, drop = 0;
    // the energy chain beside the rail: its bend travels half as far as the carriage and the two straight runs change length
    const chL = G("CHAIN_LOWER"), chB = G("CHAIN_BEND"), chU = G("CHAIN_UPPER"), chain = car && chL && chB && chU && chU.parent === car && chL.parent === chB.parent ? { z0: chB.position.z, low: chB.position.z - chL.position.z, up: chB.position.z - (car.position.z + chU.position.z) } : null;
    const place = () => {
      if (car) car.position.copy(carHome).addScaledVector(carAxis, rail);
      if (chain && chain.low > 0.1 && chain.up > 0.1) { chB.position.z = chain.z0 + rail / 2; chL.scale.z = (chain.low + rail / 2) / chain.low; chU.scale.z = (chain.up - rail / 2) / chain.up; }
      arm.root.position.set(base0.x, base0.y * seatU + lift + drop, base0.z + rail);
    };
    place(); arm.root.updateWorldMatrix(true, true);
    const readyP = V(base0.x + 0.84, base0.y + 1.36, base0.z);          // clear of the part when the positioner turns it
    const readyQ = arm.solve(readyP, neckOrient(V(0.3, -1, 0).normalize(), V(0.3, -1, 0)), [0, 0.1, 0.3, 0, 1.0, 0], true) || [0, 0.15, 0.25, 0, 1.0, 0];
    arm.q = readyQ.slice(); arm.apply();
    const hose = torchHose(S, arm, t);

    /* ------------------------------------------------ the eight parts, their pieces and how each piece arrives */
    const parts = PARTS.map((name, i) => ({ name, i: i + 1, pieces: [], mats: [], rim: { value: 0 }, dim: 1, u: -1, boxes: [] }));
    const P = Object.fromEntries(parts.map(p => [p.name, p]));
    const own = (part, objs, skip) => {          // this stage's own copies of the materials, so a part can fade, dim and glow alone
      const seen = new Map(), list = [];
      objs.forEach(o => o && o.traverse(m => {
        if (!m.isMesh || Array.isArray(m.material) || (skip && skip(m))) return;
        let e = seen.get(m.material);
        if (!e) { const c = m.material.clone(); rimLight(c, part.rim); e = { m: c, c: c.color.clone(), env: c.envMapIntensity, op: c.opacity, tr: c.transparent }; seen.set(m.material, e); list.push(e); }
        m.material = e.m;
      }));
      part.mats.push(...list); return list;
    };
    const piece = (part, o, w0, w1, ex) => { const pc = Object.assign({ o, w0, w1, p0: o ? o.position.clone() : null, q0: o ? o.quaternion.clone() : null, off: null, ang: 0, mats: [], a: -1 }, ex); part.pieces.push(pc); return pc; };
    const toLocal = (o, dirW) => dirW.applyQuaternion(o.parent.getWorldQuaternion(Q()).invert());
    const stag = (n, i, a, b, share = 0.55) => { const w = (b - a) * (n > 1 ? share : 1), s = n > 1 ? a + (b - a - w) * i / (n - 1) : a; return [s, s + w]; };
    const kids = g => (g.children.some(c => c.userData.keep === true) ? g.children.filter(hasMesh) : [g]);
    const kind = o => o.userData.kind || "piece";
    const still = (part, o, w0, w1) => piece(part, o, w0, w1, { mats: own(part, [o]) });           // fades in where it lies (floor lines, cable runs)
    const slideIn = (part, g, dist, a, b) => { const all = kids(g), ks = all.filter(o => kind(o) === "piece");
      all.forEach(o => { if (kind(o) === "bed") still(part, o, a, a + 0.3); if (kind(o) === "lines") still(part, o, b - 0.22, b + 0.04); });
      ks.forEach((o, i) => { const [w0, w1] = stag(ks.length, i, a, b - 0.08, 0.62); piece(part, o, w0, w1, { off: toLocal(o, outward(boxOf(o)).multiplyScalar(dist)), mats: own(part, [o]) }); }); };

    // 1 robot: lowered onto its place
    piece(P.robot, null, 0.05, 0.9, { mats: own(P.robot, [arm.root], m => under(m, arm.tool) || under(m, hose.feeder)), fn: (e, x) => { drop = (1 - e) * 0.45; arm.root.visible = x > 0.001; } });
    // 2 tool: the torch slides onto the flange, its hose follows, then the welding package rolls in
    if (arm.tool) piece(P.tool, arm.tool, 0.04, 0.5, { off: V(0.3, 0, 0), mats: own(P.tool, [arm.tool]) });
    if (hose.feeder) piece(P.tool, null, 0.28, 0.62, { mats: own(P.tool, [hose.feeder, hose.hose]), fn: (e, x) => { hose.feeder.visible = hose.hose.visible = x > 0.001; } });
    if (G("GRP_weldpack")) slideIn(P.tool, G("GRP_weldpack"), 1.3, 0.3, 0.95);
    // 3 positioner: the stands are lowered into place, then the part between them
    if (G("GRP_positioner")) { const all = kids(G("GRP_positioner")), ks = all.filter(o => o !== rot && kind(o) === "piece");
      all.forEach(o => { if (kind(o) === "bed") piece(P.positioner, o, 0.03, 0.5, { off: toLocal(o, V(0, 0.5, 0)), mats: own(P.positioner, [o]) }); if (kind(o) === "lines") still(P.positioner, o, 0.7, 0.95); });
      ks.forEach((o, i) => { const [w0, w1] = stag(ks.length, i, 0.14, 0.72, 0.7); piece(P.positioner, o, w0, w1, { off: toLocal(o, V(0, 0.85, 0)), mats: own(P.positioner, [o]) }); });
      if (all.includes(rot)) piece(P.positioner, rot, 0.42, 0.96, { off: toLocal(rot, V(0, 0.7, 0)), mats: own(P.positioner, [rot]) }); }
    // 4 rail: the robot is lifted, the track slides in under it along its own length, and the robot is set down on the carriage
    if (G("GRP_rail")) { const g = G("GRP_rail"), s = boxOf(g).getSize(V());
      piece(P.rail, g, 0.1, 0.82, { off: toLocal(g, s.z >= s.x ? V(0, 0, -(s.z + 0.6)) : V(-(s.x + 0.6), 0, 0)), mats: own(P.rail, [g]) });
      piece(P.rail, null, 0, 1, { fn: (e, x) => { const up = sstep(0, 0.3, x), dn = sstep(0.72, 1, x); seatU = dn; lift = (base0.y + 0.2) * up * (1 - dn); } }); }
    // 5 vision: the camera boom swings in over the part, about its own mast
    if (G("GRP_vision")) { const g = G("GRP_vision"), b = boxOf(g), c = b.getCenter(V()), s = b.getSize(V()), eye = anchor(cell, "CAM_EYE", c);
      const side = (e, m, lo, hi, w) => (Math.abs(e - m) < 0.15 * w ? m : e < m ? hi - 0.08 : lo + 0.08);
      const pv = V(side(eye.x, c.x, b.min.x, b.max.x, s.x), 0, side(eye.z, c.z, b.min.z, b.max.z, s.z));
      const far = sg => eye.clone().sub(pv).applyAxisAngle(AX.Y, sg * 1.2).add(pv).setY(0).distanceTo(CELL_MID);
      piece(P.vision, g, 0.06, 0.94, { ang: far(1) >= far(-1) ? 1.2 : -1.2, axis: toLocal(g, AX.Y.clone()), piv: g.parent.worldToLocal(pv.clone()), mats: own(P.vision, [g]) }); }
    // 6 guarding: the panels stand up one after another, round the cell
    if (G("GRP_guard")) { const all = kids(G("GRP_guard")), ks = all.filter(o => kind(o) === "piece");
      all.forEach(o => { if (kind(o) === "bed") still(P.guard, o, 0.02, 0.3); if (kind(o) === "lines") still(P.guard, o, 0.75, 0.98); });
      ks.forEach((o, i) => { const b = boxOf(o), c = b.getCenter(V()), s = b.getSize(V()), alongX = s.x >= s.z, [w0, w1] = stag(ks.length, i, 0.03, 0.97, 0.4);
        if (ks.length < 2) { piece(P.guard, o, w0, w1, { off: toLocal(o, V(0, 0.7, 0)), mats: own(P.guard, [o]) }); return; }
        const out = alongX ? Math.sign(c.z - CELL_MID.z) || -1 : Math.sign(c.x - CELL_MID.x) || -1;
        piece(P.guard, o, w0, w1, { ang: (alongX ? 1 : -1) * out * 1.3, axis: toLocal(o, (alongX ? AX.X : AX.Z).clone()), piv: o.parent.worldToLocal(V(c.x, b.min.y, c.z)), mats: own(P.guard, [o]) }); }); }
    // 7 controls: the cabinets and the operator station slide in from outside the cell
    if (G("GRP_controls")) slideIn(P.controls, G("GRP_controls"), 1.4, 0.05, 0.95);
    // boxes for the camera, taken with everything in place
    parts.forEach(p => { p.boxes = p.pieces.filter(pc => pc.o).map(pc => boxOf(pc.o)).filter(b => !b.isEmpty()); });
    P.robot.boxes = [boxOf(arm.root)];
    P.tool.aim = [P.robot.boxes[0]];                          // the tool is read on the arm: the camera leans to the robot, not to the equipment round it
    t.fx.push({ dispose() { parts.forEach(p => p.mats.forEach(m => m.m.dispose())); } });

    // a stage no page drives shows the finished cell, running
    let k = clamp(+S.el.dataset.assemblyStart || (S.assembly ? 1 : PARTS.length), 0, PARTS.length), kDone = -1, focus = null, focusSet = false, auto = null;
    const _aq = Q(), _ap = V();
    const applyK = () => {
      if (k === kDone) return; kDone = k;
      for (const p of parts) {
        const u = clamp(k - (p.i - 1), 0, 1);
        if (u === p.u) continue; p.u = u;
        for (const pc of p.pieces) {
          const x = clamp((u - pc.w0) / (pc.w1 - pc.w0), 0, 1), e = settle(x), r = 1 - e, o = pc.o;
          if (o) {
            o.visible = x > 0.001; _ap.copy(pc.p0);
            if (pc.ang) { _aq.setFromAxisAngle(pc.axis, pc.ang * r); _ap.sub(pc.piv).applyQuaternion(_aq).add(pc.piv); o.quaternion.copy(_aq).multiply(pc.q0); }
            if (pc.off) _ap.addScaledVector(pc.off, r);
            o.position.copy(_ap);
          }
          if (pc.fn) pc.fn(e, x);
          const a = sstep(0, 0.4, x);                        // opacity only supports the move: full well before the piece is home
          if (a !== pc.a) { pc.a = a; for (const m of pc.mats) { m.m.opacity = m.op * a; const tr = m.tr || a < 1; if (m.m.transparent !== tr) { m.m.transparent = tr; m.m.needsUpdate = true; } } }
        }
      }
    };
    /* focus: the named part keeps its full colour and gains a soft rim; the others step back a little */
    const shade = dt => {
      const on = !!focus && focus !== "service", kf = 1 - Math.exp(-dt * 5);
      for (const p of parts) {
        const dg = on && p.name !== focus ? 0 : 1, rg = on && p.name === focus ? 0.3 : 0;
        p.rim.value = Math.abs(rg - p.rim.value) < 0.004 ? rg : lerp(p.rim.value, rg, kf);
        const d = Math.abs(dg - p.dim) < 0.004 ? dg : lerp(p.dim, dg, kf);
        if (d !== p.dim) { p.dim = d; const s = lerp(0.58, 1, d), ev = lerp(0.5, 1, d); for (const m of p.mats) { m.m.color.copy(m.c).multiplyScalar(s); m.m.envMapIntensity = m.env * ev; } }
      }
    };

    /* light-curtain beams and the camera's field of view: drawn faintly while guarding or vision is in focus */
    const lcA = G("LC_A"), lcB = G("LC_B"), eyeN = G("CAM_EYE"), over = [];
    const glowMat = (c, ex) => new T.MeshBasicMaterial(Object.assign({ color: c, transparent: true, opacity: 0, depthWrite: false, side: T.DoubleSide, blending: T.AdditiveBlending, toneMapped: false }, ex));
    if (lcA && lcB) {
      const a = lcA.getWorldPosition(V()), b = lcB.getWorldPosition(V()), mid = (a.y + b.y) / 2, y0 = mid > 0.5 ? mid - 0.73 : mid + 0.2, y1 = mid > 0.5 ? mid + 0.73 : mid + 1.66;
      const g = new T.BufferGeometry(); g.setAttribute("position", new T.Float32BufferAttribute([a.x, y0, a.z, b.x, y0, b.z, b.x, y1, b.z, a.x, y1, a.z], 3)); g.setAttribute("uv", new T.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2)); g.setIndex([0, 1, 2, 0, 2, 3]);
      const m = new T.Mesh(g, glowMat(0xff4a3a, { map: tex("beams") })); m.layers.set(FX_LAYER); m.renderOrder = 4; S.scene.add(m);
      over.push({ part: "guard", items: [[m, 0.32]] });
    }
    if (eyeN) {
      const e = eyeN.getWorldPosition(V()), to = W.getWorldPosition(V()), L = Math.max(0.3, e.distanceTo(to));
      const cg = new T.ConeGeometry(0.5, L, 4, 1, true); cg.rotateY(Math.PI / 4); cg.translate(0, -L / 2, 0); cg.scale(0.8, 1, 1.7);
      const grp = new T.Group(), body = new T.Mesh(cg, glowMat(0x9af0aa)), edge = new T.LineSegments(new T.EdgesGeometry(cg), new T.LineBasicMaterial({ color: 0xb6f7c0, transparent: true, opacity: 0, depthWrite: false, toneMapped: false }));
      grp.add(body, edge); grp.position.copy(e); grp.quaternion.setFromUnitVectors(V(0, -1, 0), to.sub(e).normalize());
      grp.traverse(o => { o.layers.set(FX_LAYER); o.renderOrder = 4; }); S.scene.add(grp);
      over.push({ part: "vision", items: [[body, 0.07], [edge, 0.5]], root: grp });
    }
    over.forEach(o => { o.v = 0; (o.root || o.items[0][0]).visible = false; });
    const overlays = dt => over.forEach(o => {
      const g = focus === o.part && P[o.part].u >= 0.9 ? 1 : 0; if (g === o.v) return;
      o.v = Math.abs(g - o.v) < 0.01 ? g : lerp(o.v, g, 1 - Math.exp(-dt * 4));
      (o.root || o.items[0][0]).visible = o.v > 0.01; o.items.forEach(([m, op]) => { m.material.opacity = op * o.v; });
    });
    t.fx.push({ dispose() { over.forEach(o => { const r = o.root || o.items[0][0]; r.parent && r.parent.remove(r); o.items.forEach(([m]) => { m.geometry.dispose(); m.material.dispose(); }); }); } });

    /* stack light: amber once the controls stand, green when the cell runs */
    const lampM = { green: [], amber: [], red: [] };
    cell.traverse(o => { const m = o.isMesh && o.material, c = m && m.name && (/lamp_(green|amber|red)/i.exec(m.name) || [])[1]; if (c && !lampM[c.toLowerCase()].includes(m)) { m.emissive = m.color.clone(); lampM[c.toLowerCase()].push(m); } });
    let lampS = -1;
    const lamp = s => { if (s === lampS) return; lampS = s; lampM.green.forEach(m => { m.emissiveIntensity = s === 2 ? 3.2 : 0.04; }); lampM.amber.forEach(m => { m.emissiveIntensity = s === 1 ? 2.2 : 0.04; }); lampM.red.forEach(m => { m.emissiveIntensity = 0.04; }); };

    /* ------------------------------------------------ the work: six seams, three with the part flat and three with it turned */
    const rotQ0 = rot ? rot.quaternion.clone() : Q(), rotAxis = rot ? V(0, 0, 1).applyQuaternion(rot.getWorldQuaternion(Q()).invert()) : V(0, 0, 1);
    let turn = 0;
    const setTurn = a => { turn = a; if (rot) { rot.quaternion.copy(rotQ0).multiply(_aq.setFromAxisAngle(rotAxis, a)); rot.updateWorldMatrix(true, true); } };
    const seams = [];
    for (let i = 0; i < 12; i++) {
      const e = W.getObjectByName("SEAM_" + String(i).padStart(2, "0")); if (!e) continue;
      const M = relMatrix(e, W), a = V().setFromMatrixPosition(M), dir = V(1, 0, 0).transformDirection(M), n = V(0, 1, 0).transformDirection(M), len = clamp(+e.userData.len || 0.3, 0.05, 3);      // out of the corner: Blender local +Z, here local +Y
      seams.push({ a, b: a.clone().addScaledVector(dir, len), dir, n, len, ang: 0, pos: e.userData.pos });
    }
    const wpt = (p, out = V()) => W.localToWorld(out.copy(p));
    const wdir = v => v.clone().transformDirection(W.matrixWorld);
    if (rot) {                                               // turn each seam to where its joint opens upwards and towards the robot
      for (const s of seams) { if (Number.isFinite(+s.pos) && s.pos !== null && s.pos !== "") { s.ang = -s.pos * Math.PI / 180; continue; }      // positioner +90 degrees about Blender Y is -90 about three.js Z
        let best = -9; for (const a of [0, -Math.PI / 2, Math.PI / 2]) { setTurn(a); const n = wdir(s.n), sc = n.y + 0.5 * n.dot(V(base0.x - wpt(s.a).x, 0, 0).normalize()) - Math.abs(a) * 0.05; if (sc > best) { best = sc; s.ang = a; } } }
      setTurn(0); seams.sort((p, q) => Math.abs(p.ang) - Math.abs(q.ang));
    }
    seams.forEach(s => { s.bead = new Bead(W, s.a, s.b, s.n, 0.007, clamp(Math.round(s.len / 0.004), 30, 220)); });
    const wy = W.getWorldPosition(V());
    const sparks = new Sparks(S.scene, 360, (x, z, y) => (Math.abs(x - wy.x) < 0.4 && Math.abs(z - wy.z) < 1.05 && y > wy.y - 0.05 ? wy.y + 0.03 : 0));
    const glow = new Glow(S.scene, "blue", 0.06, 0xc8d8ff, 5, 5), smoke = new Smoke(S.scene);
    t.fx.push(sparks, glow, smoke, ...seams.map(s => s.bead));
    const torchQ = (s, p) => neckOrient(wdir(s.n).negate().addScaledVector(wdir(s.dir), 0.18).normalize(), V(0, -1, 0).addScaledVector(radialUp(p, arm.root.position), 0.25));
    const railFor = p => clamp(p.z + 0.22 - base0.z, -LIM, LIM);        // the robot stands a little to one side of its work
    let arc = false, now = 0, run = null, back = null, idleT = 0;
    function* turnTo(a) { const a0 = turn, d = Math.abs(a - a0); if (d < 1e-3) return; const dur = 1.1 + d * 0.9; for (let u = 0; u < 1;) { u = Math.min(1, u + (yield) / dur); setTurn(lerp(a0, a, quint(u))); } }
    /* carriage and joints move together: the target is solved as seen from where the carriage will stand */
    function* ride(r1, q1, speed = 1) {
      const r0 = rail, q0 = arm.q.slice();
      let dm = 0; for (let i = 0; i < 6; i++) dm = Math.max(dm, Math.abs(q1[i] - q0[i]) * (i > 2 ? 0.55 : 1));
      const dur = Math.max(0.4, dm / (1.5 * speed) + 0.25, Math.abs(r1 - r0) / 0.6 + 0.3);
      for (let u = 0; u < 1;) { u = Math.min(1, u + (yield) / dur); const e = quint(u); rail = lerp(r0, r1, e); place(); for (let i = 0; i < 6; i++) arm.q[i] = lerp(q0[i], q1[i], e); arm.apply(); }
      arm.root.updateWorldMatrix(true, true); arm.syncCmd();
    }
    const solveAt = (r, pos, quat) => { const r0 = rail; rail = r; place(); const q = arm.solve(pos, quat, arm.q, true); rail = r0; place(); return q; };
    function* rideTo(pos, quat, speed) { const r1 = railFor(pos), q = solveAt(r1, pos, quat); if (!q) return false; yield* ride(r1, q, speed); return true; }
    const cleanP = anchor(cell, "CLEAN_TCP", null), _wp = V(), WELD_V = 0.032;
    const program = function* () {
      while (true) {
        for (const s of seams) {
          if (Math.abs(s.ang - turn) > 1e-3) { t.step = "move"; yield* ride(rail, readyQ, 0.9); yield* turnTo(s.ang); }
          const a = wpt(s.a), b = wpt(s.b), nW = wdir(s.n), q = torchQ(s, a);
          t.step = "move";
          if (!(yield* rideTo(a.clone().addScaledVector(nW, 0.14), q, 1))) continue;          // out of reach from the rail: leave this seam
          yield* arm.moveL(a, q, 0.3);
          arc = true; t.step = "weld"; yield* wait(0.3);
          for (let d = 0; d < s.len;) {                      // the carriage follows the wire along the part
            const dt = yield; d = Math.min(s.len, d + WELD_V * dt);
            const p = _wp.lerpVectors(a, b, d / s.len);
            rail += clamp(railFor(p) - rail, -0.4 * dt, 0.4 * dt); place();
            arm.goto(p, torchQ(s, p)); s.bead.deposit(d / s.len, now, 2);
          }
          yield* wait(0.25); arc = false;
          yield* arm.moveL(b.clone().addScaledVector(nW, 0.14), torchQ(s, b), 0.45);
        }
        if (cleanP) {                                        // torch cleaning between parts, when the station is within reach
          const q = neckOrient(V(0, -1, 0), V(1, 0, 0)), up = cleanP.clone().add(V(0, 0.2, 0));
          t.step = "move";
          if (solveAt(railFor(cleanP), cleanP, q) && (yield* rideTo(up, q, 0.9))) { yield* arm.moveL(cleanP, q, 0.25); yield* wait(0.9); yield* arm.moveL(up, q, 0.3); }
        }
        t.step = "cool"; yield* ride(0, readyQ, 0.8); yield* wait(2.0);
        yield* turnTo(0); seams.forEach(s => s.bead.reset()); yield* wait(0.8);
      }
    };
    const retreat = function* () {                           // the page scrolled back above step 8: lift off, park, level the part
      const p = V(), q = Q(); arm.tcp(p, q);
      if (p.distanceTo(wy) < 1.3) yield* arm.moveL(p.clone().add(V(-0.04, 0.16, 0)), q, 0.7);
      yield* ride(0, readyQ, 1.1); yield* turnTo(0);
    };
    const idle = dt => {                                     // a calm ready pose with a slow, small move
      idleT += dt; const a = RM ? 0 : Math.min(1, idleT / 2.5);
      [[0, 0.05, 0.41, 0], [1, 0.022, 0.29, 1], [2, 0.028, 0.35, 2.2], [4, 0.04, 0.33, 0.6]].forEach(([i, amp, f, ph]) => { arm.q[i] = readyQ[i] + amp * a * (Math.sin(idleT * f + ph) - Math.sin(ph) * (1 - a)); });
      arm.apply();
    };
    const RUN_AT = PARTS.length - 0.08;
    t.update = dt => {
      now += dt; applyK();
      const want = k >= RUN_AT && !RM && !S.paused && seams.length > 0;
      if (want && !run) { run = program(); run.next(); back = null; }
      else if (!want && run) { run = null; arc = false; t.step = null; seams.forEach(s => s.bead.reset()); back = retreat(); back.next(); }
      try {
        if (run) run.next(dt);
        else if (back) { if (back.next(dt).done) { back = null; idleT = 0; } }
        else idle(dt);
      } catch (err) { console.warn("solution cell stopped:", err); run = back = null; arc = false; }
      place();
      const tip = arm.tcp(V());
      if (arc) { sparks.emit(tip, 5, V(0, 0.6, 0), 0.9, 2.2, 0.75); smoke.emit(tip, 1, dt); }
      glow.set(arc, tip, dt); sparks.update(dt); smoke.update(dt);
      if (P.tool.u > 0.2) hose.draw();
      seams.forEach(s => s.bead.update(dt, now));
      lamp(k >= RUN_AT ? 2 : P.controls.u >= 0.85 ? 1 : 0);
      shade(dt); overlays(dt);
    };
    t.program = function* () { while (true) yield; };          // the stage's own program slot stays idle: update() runs the cell

    /* ------------------------------------------------ what the page drives */
    const stepName = () => PARTS[clamp(Math.floor(k + 0.35), 1, PARTS.length) - 1];
    auto = stepName();
    t.setAssembly = v => { k = clamp(+v || 0, 0, PARTS.length); if (!focusSet) { const n = stepName(); if (n !== auto) { auto = n; S.aim(); } } };
    t.focusPart = n => { focusSet = true; focus = P[n] ? n : null; if (focus) auto = focus; else auto = stepName(); S.aim(); };
    t.getAssembly = () => k;
    /* what the camera should show: every part placed so far, leaning towards the part in focus */
    t.frame = () => {
      const p = P[focus || auto] || P.robot, v = D.views[p.name] || [0, 0, 0], all = [];
      parts.forEach(q => { if (q !== P.service && q.i <= p.i) all.push(...q.boxes); });
      if (!all.length) all.push(...P.robot.boxes);
      return { az: D.cam.az + v[0], el: D.cam.el + v[1], all, part: p.aim || (p.boxes.length ? p.boxes : all), lean: v[2], zoom: v[3] || 1 };
    };
    t.hot = {};
    t._dbg = { parts, seams, W, P, state: () => ({ k, rail, turn, arc, run: !!run, back: !!back, focus, auto }) };
    applyK(); place();
    return t;
  },
};

TASKS.none = { cell: null, tool: "torch", model: "mr6-2080", cam: { az: 1.0, el: 0.22, look: [0.7, 1.0, 0], dist: 4.6 }, make(S, arm) { const t = taskBase(S, arm, null, {}); t.program = function* () { yield* arm.moveJ(V(1.2, 0.9, 0.1), orient(V(0.3, -1, 0), V(1, 0, 0)), 0.8); while (true) yield; }; return t; } };

const DEFAULT_MODEL = { weld: "mr6-2080", cut: "mr6-2080", bend: "mr6-2080", palletise: "mr50-2185", tend: "mr6-2080", solution: "mr6-2080", none: "mr6-2080" };

/* ------------------------------------------------------------------ the studio every stage stands in */
const GROUND = 0x0c1f18;            // the site's dark page colour: the floor fades into it and the canvas clears to it
/* the studio's light is built here, not downloaded: a dark room with a large soft box overhead, a warm fill towards
   the viewer and cool strips behind for the rim */
function studioEnv(R) {
  const s = new T.Scene(), made = [];
  const panel = (w, h, d, x, y, z, c, k, side = T.FrontSide) => { const m = new T.Mesh(new T.BoxGeometry(w, h, d), new T.MeshBasicMaterial({ color: c, side })); m.material.color.multiplyScalar(k); m.position.set(x, y, z); s.add(m); made.push(m); };
  panel(40, 20, 40, 0, 8, 0, 0x3a4640, 0.3, T.BackSide);              // the room: dark, slightly green
  panel(9, 0.2, 7, -0.5, 8, 1.5, 0xffffff, 5.5);                         // soft box overhead
  panel(0.2, 5, 8, -11, 3.5, 4, 0xfff4e6, 3.2);                         // warm fill, viewer's left
  panel(8, 4, 0.2, 2, 3, 13, 0xffffff, 1.6);                            // low fill behind the viewer
  panel(1.6, 7, 0.2, -6, 4, -12, 0xd2e0ff, 10);                         // cool rim strips behind the cell
  panel(0.2, 7, 2, 12, 4, -6, 0xd2e0ff, 8);
  const pm = new T.PMREMGenerator(R), t = pm.fromScene(s, 0.03).texture; pm.dispose();
  made.forEach(m => { m.geometry.dispose(); m.material.dispose(); });
  return t;
}
/* a faint, smeared mirror image in the floor (larger screens): the scene drawn once more from below at half size */
const MIRROR = {
  name: "FloorMirror",
  uniforms: { color: { value: null }, tDiffuse: { value: null }, textureMatrix: { value: null }, k: { value: 0.055 }, mid: { value: new T.Vector3() }, rad: { value: 8 }, px: { value: new T.Vector2(1 / 512, 1 / 512) } },
  vertexShader: "uniform mat4 textureMatrix; varying vec4 vUv; varying vec3 vW; void main(){ vUv = textureMatrix * vec4(position, 1.0); vW = (modelMatrix * vec4(position, 1.0)).xyz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
  fragmentShader: `uniform sampler2D tDiffuse; uniform float k; uniform vec3 mid; uniform float rad; uniform vec2 px; varying vec4 vUv; varying vec3 vW;
    void main(){ vec2 uv = vUv.xy / vUv.w; vec3 c = vec3(0.0); float w = 0.0;
      for (int i = -5; i <= 5; i++) { float f = float(i), g = exp(-f * f / 12.0); c += texture2D(tDiffuse, uv + vec2(f * 0.5 * px.x, f * 2.4 * px.y)).rgb * g; c += texture2D(tDiffuse, uv + vec2(-f * 1.6 * px.x, f * 0.8 * px.y)).rgb * g * 0.5; w += g * 1.5; }
      float fade = 1.0 - smoothstep(0.3 * rad, rad, distance(vW.xz, mid.xz));
      gl_FragColor = vec4(min(c / w, vec3(4.0)) * k * fade, 0.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
};

/* ------------------------------------------------------------------ UI styles (self-contained) */
const CSS = `
.stage3d .r3-ui{position:absolute;inset:0;pointer-events:none;z-index:4;font:500 13px/1.4 Inter,"IBM Plex Sans Arabic",Arial,sans-serif;color:#fff}
.stage3d .robot-hint{display:none}
.stage3d .fallback{display:block;opacity:1;transition:opacity .9s ease;z-index:0}
.stage3d.live .fallback{opacity:0;pointer-events:none}
.stage3d.nogl .fallback{opacity:1}
.r3-load{position:absolute;inset:0;display:grid;place-items:center;background:none;transition:opacity .8s;z-index:1;pointer-events:none}
.r3-load.gone{opacity:0}
.r3-show{position:absolute;left:50%;bottom:22px;transform:translateX(-50%);z-index:3;padding:12px 18px;border:1px solid rgba(255,255,255,.45);background:rgba(14,17,18,.72);color:#fff;font:600 15px/1.2 Inter,"IBM Plex Sans Arabic",system-ui,sans-serif;border-radius:2px;cursor:pointer}
.r3-load div{display:flex;align-items:center;gap:10px;padding:9px 14px;border-radius:999px;background:rgba(14,17,18,.6);backdrop-filter:blur(8px)}
.r3-load i{width:16px;height:16px;border-radius:50%;border:2px solid rgba(255,255,255,.25);border-top-color:#5bc46a;animation:r3spin .9s linear infinite}
@keyframes r3spin{to{transform:rotate(360deg)}}
.r3-bar{position:absolute;left:12px;right:12px;bottom:12px;display:flex;align-items:center;gap:8px;justify-content:center;flex-wrap:wrap}
.r3-instr{margin:0;padding:8px 14px;border-radius:999px;background:rgba(12,15,16,.55);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);max-width:min(560px,100%);text-align:center;transition:background .3s}
.r3-instr.live{background:rgba(31,122,43,.78)}
.r3-btn{pointer-events:auto;border:0;cursor:pointer;color:#fff;background:rgba(12,15,16,.55);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);padding:8px 13px;border-radius:999px;font:inherit;display:inline-flex;align-items:center;gap:6px}
.r3-btn:hover{background:rgba(44,158,58,.85)}
.r3-btn[aria-pressed=true]{background:#2c9e3a}
.r3-btn svg{width:14px;height:14px}
.r3-stats{position:absolute;top:14px;inset-inline-end:14px;padding:6px 12px;border-radius:12px;background:rgba(12,15,16,.5);backdrop-filter:blur(8px);text-align:end;line-height:1.15}
.r3-stats b{display:block;font:600 20px/1.1 Inter,"IBM Plex Sans Arabic",Arial,sans-serif;font-feature-settings:"tnum" 1,"lnum" 1}
.r3-stats span{font-size:11.5px;opacity:.8}
.r3-stats em{display:block;font-style:normal;font-size:11.5px;color:#9be3a6;margin-top:3px;min-height:1.2em}
.r3-stats em::before{content:"";display:inline-block;width:6px;height:6px;border-radius:50%;background:#5bc46a;margin-inline-end:6px;vertical-align:1px;box-shadow:0 0 8px #5bc46a}
.r3-opts{display:inline-flex;gap:4px;pointer-events:auto}
.r3-opts .r3-btn{padding:8px 10px}
.stage3d.r3-drive{touch-action:none}
.stage3d.r3-click canvas{cursor:pointer}
.stage3d.mini .r3-stats,.stage3d.mini .r3-bar>:not(.r3-play){display:none}
.stage3d.mini .r3-bar{justify-content:flex-end}
.ex-stage .r3-ui{display:none}
.stage3d.r3-assembly{touch-action:pan-y pinch-zoom;cursor:default}
.stage3d.r3-assembly canvas{pointer-events:none}
.stage3d.r3-assembly .r3-bar,.stage3d.r3-assembly .r3-stats,.stage3d.r3-assembly .stage-badge,.stage3d.r3-assembly .hs-layer,.stage3d.r3-assembly .robot-hint{display:none!important}
@media (max-width:600px){.r3-instr{font-size:12px;padding:7px 11px}.r3-stats b{font-size:17px}}
`;

/* ------------------------------------------------------------------ a stage */
class Stage {
  constructor(el) {
    this.el = el;
    this.mode = el.dataset.mode || "cell";
    this.assembly = el.dataset.assembly === "1" && this.mode === "cell";     // the page drives this stage: no bar, no counters, no pointer
    this.follow = el.dataset.follow !== "0" && this.mode === "cell" && !this.assembly;
    if (this.assembly) el.classList.add("r3-assembly");
    const R = this.R = new T.WebGLRenderer({ antialias: true, alpha: this.mode === "explode", powerPreference: "high-performance" });
    R.setPixelRatio(Math.min(devicePixelRatio, TOUCH ? 1.5 : 2));
    R.toneMapping = T.NeutralToneMapping; R.toneMappingExposure = 1.0;       // keeps a lit colour at its own value: the MR-Series green reads as painted (63, 174, 52), not darker or greyer
    R.shadowMap.enabled = true; R.shadowMap.type = T.PCFShadowMap;        // with shadow.radius below: a wider, softer edge than the fixed PCF-soft kernel
    if (this.mode === "cell") { R.setClearColor(GROUND, 1); R.clear(); }       // the canvas is the page colour from its first moment
    R.domElement.classList.add("r3-canvas");
    el.insertBefore(R.domElement, el.firstChild);
    this.scene = new T.Scene();
    this.cam = new T.PerspectiveCamera(30, 1, 0.05, 150);
    this.az = 1; this.azGoal = 1; this.el2 = 0.35; this.dist = 4.5; this.look = V(0.9, 0.8, 0); this.zoom = 1;
    this.prev = 0; this.lastMove = -1e9; this.user = false; this.paused = RM; this.visible = false; this.ray = null; this.clicked = false;
    this.hs = [...el.querySelectorAll(".hs")];
    this.badge = el.querySelector("[data-task-label]");
    this.buildUI();
    this.bind();
    this.ro = new ResizeObserver(() => this.resize()); this.ro.observe(el); this.resize();
    this.io = new IntersectionObserver(es => { this.visible = es[es.length - 1].isIntersecting; if (this.visible && !this.raf) this.raf = requestAnimationFrame(t => this.frame(t)); }, { threshold: 0.01 });   // held on the stage so it is never garbage-collected
    this.io.observe(el);
    el.addEventListener("robot:set", e => { const d = e.detail || {}; this.setTask(d.task || this.taskName, d.model); });
    this.init().catch(err => { console.warn(err); el.classList.add("nogl"); });
  }
  buildUI() {
    const ui = this.ui = document.createElement("div"); ui.className = "r3-ui";
    const playIc = '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M4 2.5v11l9-5.5z"/></svg>', pauseIc = '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M3.5 2.5h3v11h-3zM9.5 2.5h3v11h-3z"/></svg>';
    ui.innerHTML = `<div class="r3-load"><div><i></i><span>${lab("load")}</span></div></div>
      <div class="r3-stats" hidden><b>0</b><span></span><em></em></div>
      <div class="r3-bar"><button class="r3-btn r3-play" type="button" aria-label="${lab("pause")}">${pauseIc}</button><p class="r3-instr"></p>
      <span class="r3-opts" hidden></span><button class="r3-btn r3-take" type="button" hidden>${lab("take")}</button></div>`;
    this.el.appendChild(ui);
    this.$ = { load: ui.querySelector(".r3-load"), stats: ui.querySelector(".r3-stats"), n: ui.querySelector(".r3-stats b"), sl: ui.querySelector(".r3-stats span"), st: ui.querySelector(".r3-stats em"),
      instr: ui.querySelector(".r3-instr"), play: ui.querySelector(".r3-play"), take: ui.querySelector(".r3-take"), opts: ui.querySelector(".r3-opts") };
    this.$.play.addEventListener("click", e => { e.stopPropagation(); this.paused = !this.paused; this.$.play.innerHTML = this.paused ? playIc : pauseIc; this.$.play.setAttribute("aria-label", lab(this.paused ? "play" : "pause")); this.instr(); });
    if (this.paused) this.$.play.innerHTML = playIc;
    this.$.take.addEventListener("click", e => { e.stopPropagation(); this.setDrive(!this.drive); });
    if (this.mode !== "cell") ui.hidden = true;
  }
  setDrive(on) {
    this.drive = on; this.el.classList.toggle("r3-drive", on);
    this.$.take.textContent = lab(on ? "done" : "take"); this.$.take.setAttribute("aria-pressed", on);
    if (!on) { this.lastMove = -1e9; this.ray = null; }
    this.instr();
  }
  instr() {
    if (!this.task) return;
    const userish = this.task.follow ? (this.user || this.drive) : true;
    const text = this.task.follow ? (userish ? lab(this.taskName) : lab(this.paused ? (TOUCH ? "pausedT" : "paused") : (TOUCH ? "autoT" : "auto"))) : lab(this.taskName);   // v9.4 (web93 m7)
    this.$.instr.textContent = text; this.$.instr.classList.toggle("live", !!(this.user || this.drive));
    this.$.take.hidden = !(TOUCH && this.task.follow);
  }
  async init() {
    const S = this.scene, R = this.R, studio = this.mode === "cell";
    S.add(new T.HemisphereLight(0xf6f8f4, 0xb9c2bc, 1.7));        // lifts the sides the key does not reach
    // key: a soft overhead source, from the viewer's left
    const key = this.key = new T.DirectionalLight(0xffffff, 1.15);
    key.position.set(0.9 - 2.67, 8.62, 4.31); key.target.position.set(0.9, 0, 0);
    key.castShadow = true; key.shadow.mapSize.set(1024, 1024);          // a coarse map with a wide filter: a soft edge, and quicker to draw
    Object.assign(key.shadow.camera, { left: -3.6, right: 3.6, top: 3.6, bottom: -3.6, near: 1, far: 20 });
    key.shadow.bias = -0.0005; key.shadow.normalBias = 0.03; key.shadow.radius = 4;
    S.add(key, key.target);
    S.environment = studioEnv(R);
    if (studio) {
      S.background = new T.Color(GROUND);
      const rim = new T.DirectionalLight(0xcfdcf6, 0.6); rim.position.set(4.5, 4.2, -7); rim.target.position.set(0.5, 1, 0); S.add(rim, rim.target);   // cool light from behind
      // a dark floor with a little sheen that fades out into the page colour
      const fl = this.floor = new T.Mesh(new T.CircleGeometry(14, 72), stdMat(0x1d2622, 0.68, 0, { transparent: true, alphaMap: tex("floor"), depthWrite: false, envMapIntensity: 0.16 }));
      fl.rotation.x = -Math.PI / 2; fl.renderOrder = -2; fl.layers.set(FX_LAYER); S.add(fl);
      if (!TOUCH) {
        const mr = this.mirror = new Reflector(new T.CircleGeometry(9, 48), { shader: MIRROR, multisample: 0, textureWidth: 512, textureHeight: 512, clipBias: 0.002 });
        Object.assign(mr.material, { transparent: true, depthWrite: false, blending: T.AdditiveBlending, premultipliedAlpha: true });
        mr.rotation.x = -Math.PI / 2; mr.position.y = 0.0008; mr.renderOrder = -1; mr.layers.set(FX_LAYER); S.add(mr);
        const draw = mr.onBeforeRender, cc = new T.Color();            // the mirror image is drawn over nothing, so only the cell is added to the floor
        let drawn = false;                                             // redrawn every other frame, in turn with the contact shadow
        mr.onBeforeRender = (r, sc, cam) => { if (drawn && this.contact && !(this.contact.frame & 1)) return; drawn = true; const bg = sc.background, c0 = r.getClearColor(cc), a0 = r.getClearAlpha(); sc.background = null; r.setClearColor(0x000000, 0); draw.call(mr, r, sc, cam); sc.background = bg; r.setClearColor(c0, a0); };
      }
    }
    const sh = new T.Mesh(new T.PlaneGeometry(18, 18), new T.ShadowMaterial({ opacity: studio ? 0.3 : 0.4 })); sh.rotation.x = -Math.PI / 2; sh.position.y = 0.0015; sh.receiveShadow = true; sh.layers.set(FX_LAYER); S.add(sh);
    this.cam.layers.enable(FX_LAYER);
    this.contact = new ContactShadow(S, this.mode === "explode" ? 5 : 9, TOUCH ? 256 : 512, this.mode === "explode" ? 0.5 : 0.85);
    this.catcher = sh;
    if (!TOUCH && this.mode === "cell") { this.bloom = new ArcBloom(); this.resize(); }
    if (this.mode === "explode") this.catcher.material.opacity = 0.25;
    await this.setTask(this.el.dataset.task || "weld", this.el.dataset.model || null);
    if (this.mode === "explode") this.initExplode();
    this.$.load.classList.add("gone"); this.el.classList.add("live");
  }
  async setTask(name, model) {
    const def = TASKS[name] ? name : "weld", D = TASKS[def];
    if (model === "mr50-2185" && def !== "palletise" && this.mode === "cell") return this.setTask("palletise", model);
    if (model && model !== "mr50-2185" && def === "palletise") return this.setTask("weld", model);
    model = model || (this.taskName === def && this.model) || DEFAULT_MODEL[def] || D.model;
    const token = this.token = (this.token || 0) + 1;
    this.$.load.classList.remove("gone");
    const [src, tools, cellSrc] = await Promise.all([glb(model), glb("tools"), this.mode === "cell" && D.cell ? glb("cell_" + D.cell) : null]);
    if (token !== this.token || !src) { if (!src) this.el.classList.add("nogl"); return; }
    // tear down the previous cell
    if (this.task) { this.task.fx.forEach(f => f.dispose && f.dispose()); this.task.dispose && this.task.dispose(); }
    if (this.arm) { disposeOwned(this.arm.root); this.arm.dispose(); }
    if (this.cell) { disposeOwned(this.cell); this.scene.remove(this.cell); }
    this.taskName = def; this.model = model;
    const arm = this.arm = new Arm(src, model); this.scene.add(arm.root);
    let tool = tools && tools.scene.getObjectByName("TOOL_" + D.tool);
    tool = tool ? prep(tool.clone(true)) : null;
    arm.setTool(tool);
    const raw = D.cell && this.mode === "cell" ? (cellSrc ? cellSrc.scene.clone(true) : fallbackCell(D.cell)) : null;
    if (raw && D.pre) D.pre(raw);
    this.cell = raw ? mergeStatic(prep(raw, true)) : new T.Group();
    this.scene.add(this.cell); this.cell.updateWorldMatrix(true, true);
    this.task = D.make.call(D, this, arm, this.cell);
    if (!D.noSeat) this.seat(arm);
    if (this.floor) { const c = D.cam && D.cam.look ? D.cam.look : [0.9, 0, 0]; this.floor.position.set(c[0], 0, c[2]); if (this.mirror) { this.mirror.position.set(c[0], 0.0008, c[2]); this.mirror.material.uniforms.mid.value.set(c[0], 0, c[2]); this.mirror.material.uniforms.rad.value = (D.shadow || 3.6) * 1.5; } }
    const sr = D.shadow || 3.6, sc = this.key.shadow.camera;       // the key light's shadow covers the whole cell, however large
    if (sc.right !== sr) { Object.assign(sc, { left: -sr, right: sr, top: sr, bottom: -sr }); sc.updateProjectionMatrix(); }
    arm.root.updateWorldMatrix(true, true); arm.syncCmd();
    this.prog = null; this.user = false;
    const c = D.cam || {};
    if (this.mode === "cell") {
      this.azBase = this.azGoal = c.az ?? 1; if (!this._camInit) { this.az = this.azBase; this._camInit = true; }
      this.el2 = c.el ?? 0.35; this.look.set(...(c.look || [0.9, 0.8, 0])); this.baseDist = c.dist || 4.6; this.resize();
    }
    const ref = this.el.closest("section") || document;
    ref.querySelectorAll("[data-set-task]").forEach(b => b.setAttribute("aria-pressed", b.dataset.setTask === def));
    if (this.badge) { const b = ref.querySelector(`[data-set-task="${def}"] span`); if (b) this.badge.textContent = b.textContent; }
    this.hs.forEach(h => h.hidden = !this.task.hot[h.dataset.hs]);
    this.$.stats.hidden = !this.task.stat; this.$.sl.textContent = this.task.stat ? lab(this.task.stat) : "";
    this.$.opts.hidden = def !== "bend"; this.$.opts.innerHTML = "";
    if (def === "bend") {
      [[90, Math.PI / 2], [120, Math.PI * 2 / 3], [135, Math.PI * 3 / 4]].forEach(([d, a], i) => {
        const b = document.createElement("button"); b.type = "button"; b.className = "r3-btn"; b.textContent = d + "°"; b.dir = "ltr";
        b.setAttribute("aria-pressed", i === 0); b.title = lab("angle");
        b.addEventListener("click", e => { e.stopPropagation(); this.task.setAngle(a); this.$.opts.querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", x === b)); });
        this.$.opts.appendChild(b);
      });
    }
    this.el.classList.toggle("r3-click", !this.task.follow && !this.assembly);
    this.instr();
    this.el.dispatchEvent(new CustomEvent("robot:model", { detail: model, bubbles: true }));
    this.$.load.classList.add("gone");
    if (this.assembly && this.task.setAssembly) {            // hand the cell to the page
      const S = this, call = (f, v) => { try { S.task && S.task[f] && S.task[f](v); } catch (err) { console.warn(err); } };
      this.el.__cell = { setAssembly: k => call("setAssembly", k), focusPart: n => call("focusPart", n), getAssembly: () => (S.task && S.task.getAssembly ? S.task.getAssembly() : 0), parts: PARTS.slice() };
      this.viewLive = false; this.region(); this.aim(true);
      this.el.dispatchEvent(new CustomEvent("cell:ready"));
    }
  }
  /* ---- assembly stages: where the cell sits in the frame, and a camera that eases between views */
  region() {
    const b = this.el.getBoundingClientRect(); if (!b.width || !b.height) return;
    let x0 = 0, x1 = 1, cy = 0.45, fh = 0.76, pad = 0.94, lean = b.width < 700 ? 0.3 : 0.7;     // a small stage keeps the whole cell in view
    const sec = this.el.closest("section"), copy = sec && sec.querySelector(".anat-copy, [data-cell-copy]");
    if (copy && b.width >= 900) {                            // copy laid over one side of a full-width stage: compose in the rest
      const c = copy.getBoundingClientRect(), host = copy.closest(".anat-pin") || sec;
      if (host.clientHeight <= b.height * 1.15 && c.width < b.width * 0.7) {
        if (c.left + c.width / 2 < b.left + b.width / 2) x0 = clamp((c.right - b.left) / b.width + 0.02, 0.4, 0.6); else x1 = clamp((c.left - b.left) / b.width - 0.02, 0.4, 0.6);
        cy = 0.52; fh = 0.76; pad = 0.92; lean = 1;
      }
    }
    this.fr = { cx: (x0 + x1) / 2, cy, fw: (x1 - x0) * pad, fh, lean };
    this.cam.setViewOffset(b.width, b.height, (0.5 - this.fr.cx) * b.width, (0.5 - cy) * b.height, b.width, b.height);
  }
  fitView(boxes, az, el) {            /* the nearest camera on this bearing that keeps every box inside the free part of the frame */
    const all = new T.Box3(); boxes.forEach(b => all.union(b));
    const c = all.getCenter(V()), dir = V(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az));
    const right = V().crossVectors(AX.Y, dir).normalize(), up = V().crossVectors(dir, right);
    const ty = Math.tan(this.cam.fov * Math.PI / 360) * this.fr.fh, tx = Math.tan(this.cam.fov * Math.PI / 360) * this.cam.aspect * this.fr.fw;
    // centre the picture on what is seen, not on the box: shift the aim to the middle of the projected extent
    const d = V(); let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    const each = f => boxes.forEach(b => { for (let i = 0; i < 8; i++) f(d.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).sub(c)); });
    each(p => { const x = p.dot(right), y = p.dot(up); x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); });
    c.addScaledVector(right, (x0 + x1) / 2).addScaledVector(up, (y0 + y1) / 2);
    let dist = 0;
    each(p => { dist = Math.max(dist, p.dot(dir) + Math.max(Math.abs(p.dot(right)) / tx, Math.abs(p.dot(up)) / ty)); });
    return { look: c, dist };
  }
  aim(snap) {
    if (!this.assembly || !this.task || !this.task.frame || !this.fr) return;
    const f = this.task.frame(), A = this.fitView(f.all, f.az, f.el), F = this.fitView(f.part, f.az, f.el);
    const ln = f.lean * this.fr.lean, look = A.look.lerp(F.look, ln), dist = Math.max(3.4, 0.86 * A.dist, lerp(A.dist, F.dist, ln)) * lerp(1, f.zoom || 1, this.fr.lean);
    // leaning towards the part must not push the cell built so far out of the frame: slide the aim back until it fits
    const dir = V(Math.cos(f.el) * Math.cos(f.az), Math.sin(f.el), Math.cos(f.el) * Math.sin(f.az)), right = V().crossVectors(AX.Y, dir).normalize(), up = V().crossVectors(dir, right);
    const t = Math.tan(this.cam.fov * Math.PI / 360), hw = t * this.cam.aspect * this.fr.fw * 1.03, hh = t * this.fr.fh * 1.03, d = V();
    // (when it is wider than the free area, the surplus goes under the copy, never off the edge of the window)
    const side = this.fr.cx > 0.52 ? 1 : this.fr.cx < 0.48 ? -1 : 0;
    const back = (lo, hi, h, sd) => (hi - lo > 2 * h ? (sd > 0 ? hi - h : sd < 0 ? lo + h : (lo + hi) / 2) : lo < -h ? lo + h : hi > h ? hi - h : 0);
    for (let pass = 0; pass < 2; pass++) {                     // measured as the camera sees it, so what stands nearest counts for its full size
      let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
      f.all.forEach(bx => { for (let i = 0; i < 8; i++) { d.set(i & 1 ? bx.max.x : bx.min.x, i & 2 ? bx.max.y : bx.min.y, i & 4 ? bx.max.z : bx.min.z).sub(look); const z = Math.max(0.5, dist - d.dot(dir)), x = d.dot(right) / z, y = d.dot(up) / z; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); } });
      look.addScaledVector(right, back(x0, x1, hw, side) * dist).addScaledVector(up, back(y0, y1, hh, 0) * dist);
    }
    const g = this.viewGoal = [f.az, f.el, look.x, look.y, look.z, dist];
    if (snap || !this.viewCur || !this.viewLive) { this.viewCur = g.slice(); this.viewVel = [0, 0, 0, 0, 0, 0]; }
  }
  easeView(dt, now) {                 /* a critically damped spring: the camera starts and stops softly and never overshoots */
    const g = this.viewGoal; if (!g) return;
    const x = this.viewCur, v = this.viewVel, w = 3.3;
    for (let i = 0; i < 6; i++) { v[i] += (w * w * (g[i] - x[i]) - 2 * w * v[i]) * dt; x[i] += v[i] * dt; }
    this.az = x[0] + (RM ? 0 : Math.sin(now * 0.00021) * 0.03); this.el2 = x[1]; this.look.set(x[2], x[3], x[4]); this.dist = x[5]; this.zoom = 1; this.viewLive = true;
  }
  seat(arm) {                       /* stand the robot on the cell's base plate or riser, if there is one */
    const rc = new T.Raycaster(V(arm.root.position.x, 0.6, arm.root.position.z), V(0, -1, 0), 0, 0.62);
    let y = 0;
    for (const d of [[0, 0], [0.12, 0], [-0.12, 0], [0, 0.12], [0, -0.12]]) {
      rc.ray.origin.set(arm.root.position.x + d[0], 0.6, arm.root.position.z + d[1]);
      const h = rc.intersectObject(this.cell, true).find(h => h.point.y < 0.35);
      if (h) y = Math.max(y, h.point.y);
    }
    arm.root.position.y = y;
  }
  bind() {
    if (this.assembly) return;         // the page is scrolling: the stage takes no pointer and never holds the wheel or a touch
    const el = this.el, rc = new T.Raycaster(), ndc = new T.Vector2();
    let drag = null;
    const rayAt = (x, y) => { const b = el.getBoundingClientRect(); ndc.set(((x - b.left) / b.width) * 2 - 1, -((y - b.top) / b.height) * 2 + 1); rc.setFromCamera(ndc, this.cam); return rc.ray.clone(); };
    const onUI = e => e.target.closest(".r3-btn, .hs, .r3-opts, a, button");
    el.addEventListener("pointermove", e => {
      if (onUI(e) || this.mode !== "cell") return;
      if (drag) {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY; drag.moved += Math.abs(dx) + Math.abs(dy);
        if (drag.moved > 6 && (e.pointerType === "mouse" || !this.drive)) {
          this.azGoal += dx * 0.006; this.azBase = this.azGoal; this.el2 = clamp(this.el2 + dy * 0.003, 0.12, 0.9); this.lastOrbit = performance.now(); return;
        }
      }
      if (e.pointerType === "mouse" || this.drive) {
        this.ray = rayAt(e.clientX, e.clientY);
        if (this.task && this.task.follow && this.follow) { this.lastMove = performance.now(); if (!this.user) { this.user = true; this.instr(); } }
        if (this.task && this.task.clickables) {
          const cl = typeof this.task.clickables === "function" ? this.task.clickables() : this.task.clickables;
          if (cl.length) { rc.ray.copy(this.ray); el.style.cursor = rc.intersectObjects(cl, false).length ? "pointer" : ""; }
        }
      }
    });
    el.addEventListener("pointerdown", e => { if (onUI(e)) return; drag = { x: e.clientX, y: e.clientY, moved: 0 }; if (this.drive) { el.setPointerCapture(e.pointerId); this.ray = rayAt(e.clientX, e.clientY); this.lastMove = performance.now(); this.user = true; } });
    const up = e => {
      if (drag && drag.moved < 6 && !onUI(e) && this.task && this.mode === "cell") {
        const ray = rayAt(e.clientX, e.clientY);
        if (this.task.follow && this.follow) { this.ray = ray; this.clicked = true; this.lastMove = performance.now(); this.user = true; }
        if (this.task.click) this.task.click(ray);
        this.hs.forEach(x => x.classList.remove("open"));
      }
      drag = null;
    };
    el.addEventListener("pointerup", up); el.addEventListener("pointercancel", () => { drag = null; });
    el.addEventListener("pointerleave", e => { drag = null; if (e.pointerType === "mouse") { this.ray = null; this.lastMove = Math.min(this.lastMove, performance.now() - 2200); } });
    this.hs.forEach(h => h.addEventListener("click", e => { e.stopPropagation(); const on = !h.classList.contains("open"); this.hs.forEach(x => x.classList.remove("open")); h.classList.toggle("open", on); }));
  }
  resize() {
    const w = this.el.clientWidth, h = this.el.clientHeight; if (!w || !h) return;
    // pixel budget: a stage that fills a large window never draws more pixels than a laptop GPU manages at full pace
    const dpr = Math.min(devicePixelRatio, TOUCH ? 1.5 : 2, Math.max(1, Math.sqrt((TOUCH ? 1.7e6 : 3.6e6) / (w * h))), this.dprCap || 9);
    if (dpr !== this.R.getPixelRatio()) this.R.setPixelRatio(dpr);
    this.R.setSize(w, h, false); this.cam.aspect = w / h;
    if (this.bloom) this.bloom.size(w * dpr / 4, h * dpr / 4);
    if (this.mirror) { const mw = Math.round(w * dpr / 2), mh = Math.round(h * dpr / 2); this.mirror.getRenderTarget().setSize(mw, mh); this.mirror.material.uniforms.px.value.set(1 / mw, 1 / mh); }
    const a = w / h, base = this.baseDist || 4.6;
    if (this.assembly) { this.region(); this.aim(); }
    else this.dist = base * (a < 0.75 ? 1.55 : a < 1.05 ? 1.3 : a < 1.45 ? 1.1 : 1.0);
    if (this.mode === "explode") this.dist = 4.4 * (a < 0.9 ? 1.4 : 1.05);
    this.cam.updateProjectionMatrix();
  }
  initExplode() {
    this.sec = this.el.closest("[data-explode]");
    if (!this.sec) return;
    this.labels = [...this.sec.querySelectorAll(".ex-lab")]; this.steps = [...this.sec.querySelectorAll(".ex-step")];
    this.az = this.azGoal = 1.05; this.el2 = 0.2; this.look.set(0.75, 1.0, 0); this.resize();
    const arm = this.arm;
    arm.q = [0.4, 0.08, 0.02, 0, 1.25, 0]; arm.apply();
    const parts = { base: [arm.root.getObjectByName("BASE")], shoulder: [arm.J[0]], arm: [arm.J[1]], wrist: [arm.J[3], arm.J[4]], tool: [arm.tool || arm.J[5]] };
    this.exParts = {};
    Object.entries(parts).forEach(([k, objs]) => {
      const mats = [];
      objs.forEach(o => o && o.traverse(m => {
        if (!m.isMesh) return;
        let owner = m; while (owner && !(owner.name in { BASE: 1, J1: 1, J2: 1, J3: 1, J4: 1, J5: 1, J6: 1 }) && !/^TOOL_/.test(owner.name)) owner = owner.parent;
        if (objs.includes(owner) || (k === "arm" && owner && owner.name === "J3")) { m.material = m.material.clone(); mats.push(m.material); }
      }));
      this.exParts[k] = mats;
    });
    this.exAnch = { base: () => arm.root.getObjectByName("BASE").getWorldPosition(V()).add(V(0, 0.15, 0)), shoulder: () => arm.J[0].getWorldPosition(V()).add(V(0, 0.2, 0)),
      arm: () => arm.J[1].getWorldPosition(V()).add(arm.J[2].getWorldPosition(V())).multiplyScalar(0.5), wrist: () => arm.J[4].getWorldPosition(V()), tool: () => arm.tcp(V()) };
  }
  explodeFrame() {
    if (!this.sec) return;
    const r = this.sec.getBoundingClientRect(), vh = innerHeight;
    const p = clamp(-r.top / Math.max(1, r.height - vh), 0, 1);
    const sm = (a, b, x) => { const u = clamp((x - a) / (b - a), 0, 1); return u * u * (3 - 2 * u); };
    const ex = this.ex = lerp(this.ex || 0, sm(0.04, 0.3, p) * (1 - sm(0.9, 1, p) * 0.6), 0.15);
    const a = this.arm, J = a.J, R0 = a.rest;
    J[0].position.y = R0[0].y + ex * 0.3; J[1].position.copy(R0[1]).add(V(0.0, ex * 0.18, -ex * 0.12)); J[2].position.y = R0[2].y + ex * 0.26;
    J[3].position.x = R0[3].x + ex * 0.22; J[4].position.x = R0[4].x + ex * 0.2; J[5].position.x = R0[5].x + ex * 0.16;
    const k = clamp(Math.floor(p * this.steps.length * 0.999), 0, this.steps.length - 1);
    const active = this.steps[k] && this.steps[k].dataset.part;
    this.steps.forEach((s, i) => s.classList.toggle("on", i === k));
    Object.entries(this.exParts).forEach(([n, ms]) => ms.forEach(m => { m.emissive && m.emissive.setHex(n === active ? 0x1d6b27 : 0x000000); }));
    const b = this.el.getBoundingClientRect(), v = V();
    this.labels.forEach(l => {
      const f = this.exAnch[l.dataset.part]; if (!f) return;
      v.copy(f()).project(this.cam);
      // the label sits on the reading side of its dot (right in English, left in Arabic) and flips when it would leave the stage
      const x = (v.x * 0.5 + 0.5) * b.width, y = (-v.y * 0.5 + 0.5) * b.height, w = l.offsetWidth;
      let left = document.documentElement.dir === "rtl";
      if (!left && x + w > b.width - 6) left = true; else if (left && x - w < 6) left = false;
      l.classList.toggle("left", left);
      l.style.transform = `translate(${left ? x - w : x}px, ${y}px)`;
      l.classList.toggle("on", l.dataset.part === active); l.style.opacity = ex > 0.25 ? 1 : 0;
    });
    this.azGoal = 1.2 - p * 0.75;
    this.zoom = 1 + 0.42 * ex; this.look.y = 0.95 + 0.32 * ex; this.look.x = 0.75 + 0.1 * ex;
  }
  frame(now) {
    if (!this.visible) { this.raf = 0; return; }
    this.raf = requestAnimationFrame(t => this.frame(t));
    const ms = now - (this.prev || now), dt = Math.min(0.05, ms / 1000); this.prev = now;
    if (!this.task) return;
    // governor: if the GPU cannot hold even half pace, draw fewer pixels (never fewer than one per CSS pixel)
    if (ms > 0 && ms < 120) this.ft = this.ft ? this.ft * 0.95 + ms * 0.05 : ms;
    if (this.fc > 120 && this.ft > 36 && this.mirror && this.mirror.visible && this.governor !== false) { this.mirror.visible = false; this.fc = 0; this.ft = 0; }      // first the floor mirror goes
    if ((this.fc = (this.fc || 0) + 1) > 120 && this.ft > 36 && this.R.getPixelRatio() > 1 && this.governor !== false) { this.dprCap = Math.max(1, this.R.getPixelRatio() - 0.25); this.fc = 0; this.ft = 0; this.resize(); }
    if (this.mode === "explode") this.explodeFrame();
    else if (this.mode === "cell") {
      const userNow = this.task.follow && this.follow && (now - this.lastMove < 3200 || (this.drive && now - this.lastMove < 9000));
      if (this.user && !userNow) { this.user = false; this.task.stopUser && this.task.stopUser(); this.ray = null; this.instr(); }
      if (userNow) {
        if (!this.wasUser) { this.prog = null; this.arm.syncCmd(); }
        try { this.task.user(dt, this.ray, this.clicked); } catch (err) { console.warn(err); }
        this.clicked = false;
      } else if (!this.paused) {
        if (this.wasUser) this.arm.syncCmd();
        try {
          if (!this.prog) { this.prog = this.task.program(); this.prog.next(); }
          const r = this.prog.next(dt); if (r.done) this.prog = null;
        } catch (err) { console.warn("cell program stopped:", err); this.paused = true; this.prog = null; }
      }
      this.wasUser = userNow;
      if (!this.paused || userNow || this.assembly) this.task.update && this.task.update(dt);
      if (this.task.statN) { const n = this.task.statN(); if (n !== this._n) { this._n = n; this.$.n.textContent = n; } }
      const step = userNow ? "drive" : this.task.step;
      if (step !== this._step) { this._step = step; this.$.st.textContent = step ? lab("st_" + step) : ""; }
      const orbiting = now - (this.lastOrbit || -1e9) < 4000;
      if (!orbiting && !RM) this.azGoal = lerp(this.azGoal, this.azBase + Math.sin(now / 1000 * 0.11) * 0.16, 0.01);
    } else if (this.task.program) {
      if (!this.prog) { this.prog = this.task.program(); this.prog.next(); }
      this.prog.next(dt);
    }
    if (this.assembly) this.easeView(dt, now); else this.az = lerp(this.az, this.azGoal, 0.06);
    const L = this.look, D = this.dist * this.zoom;
    this.cam.position.set(L.x + D * Math.cos(this.el2) * Math.cos(this.az), L.y + D * Math.sin(this.el2), L.z + D * Math.cos(this.el2) * Math.sin(this.az));
    this.cam.lookAt(L);
    if (this.hs.length && this.task.hot) {
      const b = this.el.getBoundingClientRect(), v = V();
      this.hs.forEach(h => { const f = this.task.hot[h.dataset.hs]; if (!f) return; v.copy(f()).project(this.cam); h.style.transform = `translate(${(v.x * 0.5 + 0.5) * b.width}px, ${(-v.y * 0.5 + 0.5) * b.height}px)`; });
    }
    if (this.contact) this.contact.update(this.R, this.scene);
    // phones: the key shadow and the contact shadow take turns, one each frame (a third fewer draw calls)
    if (TOUCH && this.contact) { this.R.shadowMap.autoUpdate = false; if (!(this.contact.frame & 1) || !this.shadowed) this.R.shadowMap.needsUpdate = this.shadowed = true; }
    this.R.render(this.scene, this.cam);
    if (this.bloom) this.bloom.render(this.R, this.scene, this.cam, dt);
  }
}

/* ------------------------------------------------------------------ boot */
if (STAGES.length) {
  if (!supportsGL()) STAGES.forEach(s => s.classList.add("nogl"));
  else {
    const st = document.createElement("style"); st.textContent = CSS; document.head.appendChild(st);
    const start = el => { try { el._stage = new Stage(el); } catch (err) { el.classList.add("nogl"); console.warn(err); } };
    // Nothing is downloaded until a stage is started. Phones start a studio when 40% of it is in view; larger screens
    // when it comes within a screen and a half. With Save-Data
    // on, a phone keeps the poster and a button instead. The exploded view stays a still on phones.
    const SMALL = matchMedia("(max-width: 820px)").matches;
    const SAVE = !!(navigator.connection && navigator.connection.saveData);
    if (SMALL && SAVE) {
      STAGES.forEach(el => {
        if (el.classList.contains("ex-stage")) return;
        const b = document.createElement("button");
        b.type = "button"; b.className = "r3-show"; b.textContent = lab("show");
        b.addEventListener("click", () => { b.remove(); start(el); }, { once: true });
        el.appendChild(b);
      });
    } else {
      const boot = new IntersectionObserver(es => es.forEach(e => {
        if (!e.isIntersecting) return;
        boot.unobserve(e.target);
        start(e.target);
      }), SMALL ? { threshold: 0.4 } : { rootMargin: Math.round(innerHeight * 1.5) + "px 0px" });
      STAGES.forEach(s => { if (!(SMALL && s.classList.contains("ex-stage"))) boot.observe(s); });
      window.__mkBoot = boot;   // a reference, so the observer outlives garbage collection
    }
  }
}

/* controls in the same section: task buttons, model tabs and the spec read-outs */
document.querySelectorAll("[data-set-task]").forEach(b => b.addEventListener("click", () => {
  const sec = b.closest("section"), st = sec && sec.querySelector("[data-robot]");
  if (st && st._stage) st._stage.setTask(b.dataset.setTask);
  else if (st) st.dataset.task = b.dataset.setTask;
}));
document.querySelectorAll("[data-set-model]").forEach(b => b.addEventListener("click", () => {
  const sec = b.closest("section"), st = sec && sec.querySelector("[data-robot]");
  const id = b.dataset.setModel;
  if (st && st._stage) st._stage.setTask(st._stage.taskName, id);
  else if (st) st.dataset.model = id;
  syncModel(sec, id);
}));
function syncModel(sec, id) {
  if (!sec) return;
  sec.querySelectorAll("[data-set-model]").forEach(t => t.setAttribute("aria-selected", t.dataset.setModel === id));
  sec.querySelectorAll("[data-spec]").forEach(el => {
    const v = el.dataset["v" + id.replace(/[^0-9]/g, "")];
    if (v == null || el.textContent === v) return;
    el.textContent = v;
    el.animate([{ opacity: 0, transform: "translateY(10px)" }, { opacity: 1, transform: "none" }], { duration: 500, easing: "cubic-bezier(.2,.7,.1,1)" });
  });
  sec.querySelectorAll("[data-use]").forEach(el => { el.hidden = el.dataset.use !== id; });
}
document.addEventListener("robot:model", e => syncModel(e.target.closest("section"), e.detail));
