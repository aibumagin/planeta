import * as THREE from 'three';
import { Input } from './input.js';
import { createPlayer } from './player.js';
import { Sfx } from './sfx.js';
import { DAYS } from './days/index.js?v=relaunch';
import { createFollowSign } from './follow.js';

const R = 10;                                             // радиус планеты
const rules = { speed: 5.2, jump: 7.6, gravity: 22 };     // правила мира: дни могут их менять

const $ = (id) => document.getElementById(id);
const qs = new URLSearchParams(location.search);
// Примеры (?demo) лежат в отдельном файле, которого нет на публичном сайте:
// там адрес с ?demo покажет обычную игру.
let demoDays = [];
if (qs.has('demo')) {
  try { demoDays = (await import('./days/demo.js')).default; } catch { /* примеров нет – показываем настоящую игру */ }
}
const DEMO = demoDays.length > 0;
// В локальном демо используется своя история после Дня 0.
const days = DEMO ? [DAYS[0], ...demoDays] : DAYS;
const maxDay = days[days.length - 1].day;

// ---------- помощники ----------
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// пологие холмы: высота поверхности в направлении d (единичный вектор)
function hills(x, y, z) { return Math.sin(x * 0.31 + 1.3) * Math.sin(y * 0.37 + 0.4) * Math.sin(z * 0.29 + 2.2); }
function surfaceRadius(d) {
  const x = d.x * R, y = d.y * R, z = d.z * R;
  return R + hills(x, y, z) * 0.35 + Math.sin(x * 0.9 + 0.5) * Math.sin(y * 1.1 + 1.9) * Math.sin(z * 0.8 + 3.1) * 0.08;
}

// широта 90 – «северный полюс», где стартует герой
function latLon(lat, lon) {
  const a = (lat * Math.PI) / 180, o = (lon * Math.PI) / 180;
  return new THREE.Vector3(Math.cos(a) * Math.sin(o), Math.sin(a), Math.cos(a) * Math.cos(o));
}

function surfacePoint(dir, lift = 0, out = new THREE.Vector3()) {
  out.copy(dir).normalize();
  return out.multiplyScalar(surfaceRadius(out) + lift);
}

// ставит объект «ногами на планету»: его Y смотрит от центра, Z – в сторону fwd
const _ox = new THREE.Vector3(), _oy = new THREE.Vector3(), _oz = new THREE.Vector3(), _om = new THREE.Matrix4();
function orient(obj, dir, fwd) {
  _oy.copy(dir).normalize();
  if (fwd) _oz.copy(fwd); else _oz.set(0, 1, 0);
  _oz.addScaledVector(_oy, -_oz.dot(_oy));
  if (_oz.lengthSq() < 1e-6) _oz.set(1, 0, 0).addScaledVector(_oy, -_oy.x);
  _oz.normalize();
  _ox.crossVectors(_oy, _oz);
  obj.quaternion.setFromRotationMatrix(_om.makeBasis(_ox, _oy, _oz));
}

function textTexture(w, h, draw) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  draw(cv.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  return tex;
}

const easeOutBack = (x) => 1 + 2.70158 * Math.pow(x - 1, 3) + 1.70158 * Math.pow(x - 1, 2);

// ---------- сцена ----------
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 1500);
const world = new THREE.Group();
scene.add(world);

// небо
const sunDir = new THREE.Vector3(0.7, 1.1, 0.5).normalize();
const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false,
  uniforms: { sunDir: { value: sunDir } },
  vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform vec3 sunDir; varying vec3 vDir;
    void main(){
      vec3 d = normalize(vDir);
      float s = max(dot(d, sunDir), 0.0);
      vec3 col = mix(vec3(0.016, 0.018, 0.05), vec3(0.05, 0.045, 0.13), smoothstep(-1.0, 1.0, d.y));
      col += vec3(0.30, 0.16, 0.36) * pow(s, 5.0) * 0.55;
      gl_FragColor = vec4(col, 1.0);
    }`,
});
const sky = new THREE.Mesh(new THREE.SphereGeometry(1000, 32, 16), skyMat);
sky.frustumCulled = false; sky.renderOrder = -2;
scene.add(sky);

{
  const rnd = mulberry32(7), N = 2400;
  const pos = new Float32Array(N * 3), col = new Float32Array(N * 3), v = new THREE.Vector3();
  for (let i = 0; i < N; i++) {
    do { v.set(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1); } while (v.lengthSq() > 1 || v.lengthSq() < 0.01);
    v.normalize().multiplyScalar(900);
    pos.set([v.x, v.y, v.z], i * 3);
    const b = 0.25 + Math.pow(rnd(), 3) * 0.75, warm = rnd();
    col.set([b * (0.85 + warm * 0.15), b * 0.9, b * (1 - warm * 0.2)], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const stars = new THREE.Points(g, new THREE.PointsMaterial({
    size: 1.8, sizeAttenuation: false, vertexColors: true, transparent: true,
    depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
  }));
  stars.frustumCulled = false; stars.renderOrder = -1;
  scene.add(stars);
}

// солнце
const sun = new THREE.DirectionalLight('#fff0dc', 2.6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14, near: 30, far: 95 });
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.05;
scene.add(sun, sun.target);
scene.add(new THREE.HemisphereLight('#8fa6ff', '#2a1c4a', 0.75));

const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({
  map: textTexture(256, 256, (g) => {
    const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.07, 'rgba(255,244,214,1)');
    gr.addColorStop(0.22, 'rgba(255,190,110,.38)');
    gr.addColorStop(1, 'rgba(255,150,80,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
  }),
  blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false,
}));
sunSprite.scale.setScalar(240);
scene.add(sunSprite);

// планета
{
  const geo = new THREE.IcosahedronGeometry(1, 14);
  const pos = geo.attributes.position, v = new THREE.Vector3(), cen = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    v.multiplyScalar(surfaceRadius(v));
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  const rnd = mulberry32(42), col = new Float32Array(pos.count * 3);
  const hi = new THREE.Color('#cdc9e2'), lo = new THREE.Color('#8a84ab'), c = new THREE.Color();
  for (let i = 0; i < pos.count; i += 3) {
    cen.set(0, 0, 0);
    for (let j = 0; j < 3; j++) cen.add(v.fromBufferAttribute(pos, i + j));
    cen.normalize().multiplyScalar(R);
    const t = THREE.MathUtils.smoothstep(-hills(cen.x, cen.y, cen.z), -0.1, 0.5);   // низины темнее
    c.copy(hi).lerp(lo, t).offsetHSL(0, 0, (rnd() - 0.5) * 0.05);
    for (let j = 0; j < 3; j++) col.set([c.r, c.g, c.b], (i + j) * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const planet = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 }));
  planet.receiveShadow = true;
  world.add(planet);

  // тонкое свечение по краю
  world.add(new THREE.Mesh(new THREE.SphereGeometry(R * 1.2, 48, 32), new THREE.ShaderMaterial({
    side: THREE.BackSide, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    uniforms: { color: { value: new THREE.Color('#7fa2ff') } },
    vertexShader: 'varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
    // изнутри оболочки (камера смотрит в небо от самой земли) свечение гаснет, иначе в небе видна резкая дуга
    fragmentShader: `uniform vec3 color; varying vec3 vN; varying vec3 vV;
      void main(){
        float d = clamp(-dot(normalize(vN), normalize(vV)) * 1.8, 0.0, 1.0);
        float outside = smoothstep(${(R * 1.2).toFixed(1)}, ${(R * 1.3).toFixed(1)}, length(cameraPosition));
        gl_FragColor = vec4(color, pow(d, 2.6) * 0.7 * outside);
      }`,
  })));
}

// ---------- герой ----------
const sfx = new Sfx();
const input = new Input({ canvas, joy: $('joy'), knob: $('knob'), jumpBtn: $('jump') });
const hero = createPlayer();
scene.add(hero.root);

const P = {
  dir: new THREE.Vector3(0, 1, 0),      // где стоит: направление от центра планеты
  face: new THREE.Vector3(0, 0, -1),    // куда смотрит
  world: new THREE.Vector3(),
  h: 0, vy: 0, grounded: true, move: 0,
  tumble: 0, flightView: 0,
};
const camF = new THREE.Vector3(0, 0, -1);   // куда смотрит камера (вдоль поверхности)

let time = 0;
let mode = 'intro';    // intro | play | orbit
let modeT = 0;
// подсказка «как осмотреться» (см. showCoach)
const COACH_KEY = 'planet-coach-look';
let coachDone = false, lookSum = 0;
try { coachDone = localStorage.getItem(COACH_KEY) === '1'; } catch { /* без хранилища покажем каждый раз */ }

const _right = new THREE.Vector3(), _move = new THREE.Vector3(), _axis = new THREE.Vector3(), _v = new THREE.Vector3();

function updatePlayer(dt, active) {
  if (heroThing.held) active = false;
  const up = P.dir;
  camF.addScaledVector(up, -camF.dot(up)).normalize();
  const ix = active ? input.x : 0, iy = active ? input.y : 0;
  const look = input.takeLook();
  if (active) camF.applyAxisAngle(up, -ix * 1.5 * dt - look * 0.006);
  const lookY = input.takeLookY();
  if (active) {
    // наклон: тянешь вверх – смотришь в небо, вниз – под ноги
    camPitch = THREE.MathUtils.clamp(camPitch + lookY * 0.005, PITCH_UP, PITCH_DOWN);
    // на ходу камера сама плавно возвращается за спину, чтобы было видно дорогу
    if ((ix || iy) && !input.dragging()) camPitch *= Math.exp(-0.9 * dt);
  }
  if (active && !coachDone) { lookSum += Math.abs(look) + Math.abs(lookY); if (lookSum > 150) finishCoach(); }

  _right.crossVectors(camF, up);
  _move.set(0, 0, 0).addScaledVector(camF, iy).addScaledVector(_right, ix);
  const mag = Math.min(1, _move.length());
  const walking = mag > 0.08;
  P.move += ((walking ? mag : 0) - P.move) * (1 - Math.exp(-12 * dt));

  if (walking) {
    // шаг по дуге большого круга; камеру и взгляд переносим вместе с героем
    _move.normalize();
    _axis.crossVectors(up, _move).normalize();
    const ang = (rules.speed * mag * dt) / (surfaceRadius(up) + P.h);
    P.dir.applyAxisAngle(_axis, ang).normalize();
    camF.applyAxisAngle(_axis, ang);
    P.face.applyAxisAngle(_axis, ang);
    _move.applyAxisAngle(_axis, ang);
    P.face.lerp(_move, 1 - Math.exp(-14 * dt));
    P.face.addScaledVector(P.dir, -P.face.dot(P.dir));
    if (P.face.lengthSq() < 1e-4) P.face.copy(_move);
    P.face.normalize();
  }

  if (!heroThing.held) pushOut(P.dir, 0.3);

  if (active && input.jump && P.grounded) { P.vy = rules.jump; P.grounded = false; sfx.jump(); hero.kick(0.16); }
  if (!P.grounded && !heroThing.held) {
    P.vy -= rules.gravity * dt;
    P.h += P.vy * dt;
    if (P.h <= 0) { P.h = 0; P.vy = 0; P.grounded = true; sfx.land(); hero.kick(-0.24); }
  }

  surfacePoint(P.dir, P.h, P.world);
  hero.root.position.copy(P.world);
  orient(hero.root, P.dir, P.face);
  if (P.tumble) hero.root.rotateX(P.tumble);
  const step = hero.update(dt, { move: P.move, grounded: P.grounded, vy: P.vy, time });
  if (step) { sfx.step(); addFootprint(step); }
}

// ---------- вещи и события ----------
// «Вещь» – всё, с чем может что-то случиться: герой, дерево, корова, гора.
// События (огонь, испуг) расходятся по площади, и каждая вещь сама решает, как на них ответить.
// Поэтому новый день сразу взаимодействует со всем, что уже есть на планете.
const things = [];
const arc = (a, b) => Math.acos(THREE.MathUtils.clamp(a.dot(b), -1, 1)) * R;   // расстояние по поверхности

function makeThing(t) {
  const thing = { radius: 0.5, tags: [], on: {}, held: false, dead: false, spent: false, ...t };
  things.push(thing);
  return thing;
}

function findThing(name) { return things.find((t) => t.name === name && !t.dead) || null; }

// разослать событие kind всем вещам в радиусе radius от точки dir
function affect(kind, dir, radius, src) {
  for (const t of [...things]) {
    if (t === src || !t.on[kind]) continue;
    if (arc(t.dir, dir) <= radius + t.radius) t.on[kind]({ dir, src });
  }
}

// сдвинуть точку dir к target по поверхности на dist; true – дошли
const _mt = new THREE.Vector3();
function moveToward(dir, target, dist, fwdOut) {
  const a = Math.acos(THREE.MathUtils.clamp(dir.dot(target), -1, 1));
  if (a < 1e-4) return true;
  _mt.crossVectors(dir, target);
  if (_mt.lengthSq() < 1e-10) return true;
  _mt.normalize();
  const step = Math.min(a, dist / R);
  dir.applyAxisAngle(_mt, step).normalize();
  if (fwdOut) fwdOut.crossVectors(_mt, dir).normalize();
  return step >= a - 1e-6;
}

// случайная точка на угловом расстоянии от minAng до maxAng (в радианах) от center
// rnd – источник случайности; для сцен, которые должны идти одинаково у всех, передай ctx.random
function randomNear(center, minAng, maxAng, rnd = Math.random) {
  const out = new THREE.Vector3();
  do { out.set(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1).cross(center); } while (out.lengthSq() < 1e-4);
  const axis = out.clone().normalize();
  return out.copy(center).applyAxisAngle(axis, minAng + rnd() * (maxAng - minAng)).normalize();
}

// не проходить сквозь препятствия: точку dir выталкивает на край
const _po = new THREE.Vector3();
function pushOut(dir, radius, ignore) {
  for (const o of obstacles) {
    if (o === ignore || o.off) continue;
    const reach = (o.radius + radius) / R, c = dir.dot(o.dir);
    if (c <= Math.cos(reach)) continue;
    _po.copy(dir).addScaledVector(o.dir, -c);
    if (_po.lengthSq() < 1e-8) continue;
    _po.normalize();
    dir.copy(o.dir).multiplyScalar(Math.cos(reach)).addScaledVector(_po, Math.sin(reach)).normalize();
  }
}

// «заплатка»: круг радиуса radius вокруг dir, лежащий по холмам (лава, озеро, трава)
function surfacePatch(dir, radius, segs = 18, rings = 3, lift = 0.05) {
  const c = dir.clone().normalize();
  const u = new THREE.Vector3(1, 0, 0);
  if (Math.abs(c.x) > 0.9) u.set(0, 1, 0);
  u.addScaledVector(c, -u.dot(c)).normalize();
  const v = new THREE.Vector3().crossVectors(c, u);
  const pos = [], idx = [], p = new THREE.Vector3(), d = new THREE.Vector3();
  surfacePoint(c, lift, p); pos.push(p.x, p.y, p.z);
  for (let j = 1; j <= rings; j++) {
    for (let i = 0; i < segs; i++) {
      const f = (i / segs) * Math.PI * 2;
      const wob = j === rings ? 1 + 0.18 * Math.sin(i * 2.4 + radius * 7) : 1;   // неровный край
      const a = ((radius * j) / rings / R) * wob;
      d.copy(c).multiplyScalar(Math.cos(a)).addScaledVector(u, Math.cos(f) * Math.sin(a)).addScaledVector(v, Math.sin(f) * Math.sin(a));
      surfacePoint(d, lift, p); pos.push(p.x, p.y, p.z);
    }
  }
  for (let i = 0; i < segs; i++) idx.push(0, 1 + i, 1 + ((i + 1) % segs));
  for (let j = 1; j < rings; j++) {
    for (let i = 0; i < segs; i++) {
      const a0 = 1 + (j - 1) * segs + i, a1 = 1 + (j - 1) * segs + ((i + 1) % segs), b0 = a0 + segs, b1 = a1 + segs;
      idx.push(a0, b0, b1, a0, b1, a1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// лента событий на экране
let quiet = false;   // мир прокручивается вперёд мгновенно (см. fastForward): ленту не засоряем
function announce(text, cls = '') {
  if (quiet) return;
  const line = el('div', `line ${cls}`, text);
  const feed = $('feed');
  feed.append(line);
  while (feed.children.length > 3) feed.firstChild.remove();
  setTimeout(() => line.classList.add('out'), 5500);
  setTimeout(() => line.remove(), 6200);
}

// дым, искры и огонь: общий запас частиц
const fx = (() => {
  const N = 110, geo = new THREE.IcosahedronGeometry(1, 0), jit = new THREE.Vector3();
  const mats = {
    dust: new THREE.MeshLambertMaterial({ color: '#b1a8c5', flatShading: true }),
    smoke: new THREE.MeshLambertMaterial({ color: '#6a6675', flatShading: true }),
    fire: new THREE.MeshBasicMaterial({ color: '#ff8a2a', toneMapped: false }),
    spark: new THREE.MeshBasicMaterial({ color: '#ffd35a', toneMapped: false }),
  };
  const pool = [];
  for (let i = 0; i < N; i++) {
    const m = new THREE.Mesh(geo, mats.smoke);
    m.visible = false;
    scene.add(m);
    pool.push({ m, vel: new THREE.Vector3(), life: 1, age: 0, size: 1 });
  }
  let next = 0;
  return {
    // kind: dust | smoke | fire | spark; без vel частица летит вверх от планеты
    puff(pos, kind = 'smoke', size = 0.3, life = 1.2, vel) {
      const p = pool[next]; next = (next + 1) % N;
      p.m.material = mats[kind];
      p.m.position.copy(pos);
      p.m.rotation.set(Math.random() * 6, Math.random() * 6, 0);
      p.m.scale.setScalar(0.001);
      p.m.visible = true;
      p.life = life; p.age = 0; p.size = size;
      if (vel) p.vel.copy(vel);
      else p.vel.copy(pos).normalize().multiplyScalar(1.1).add(jit.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(0.9));
    },
    update(dt) {
      for (const p of pool) {
        if (!p.m.visible) continue;
        p.age += dt;
        const k = p.age / p.life;
        if (k >= 1) { p.m.visible = false; continue; }
        p.m.position.addScaledVector(p.vel, dt);
        p.m.scale.setScalar(p.size * (0.45 + k * 1.1) * (k > 0.6 ? (1 - k) / 0.4 : 1));
      }
    },
  };
})();

// герой – тоже вещь: его можно унести и обжечь
let burnT = -10;
const heroThing = makeThing({
  name: 'герой', acc: 'героя', tags: ['alive'], dir: P.dir, radius: 0.3,
  lift(dir, h) { P.dir.copy(dir); P.h = h; P.vy = 0; P.grounded = false; },
  on: {
    burn() {
      if (heroThing.held || time - burnT < 2.5) return;
      burnT = time;
      P.vy = 10; P.grounded = false;
      hero.kick(0.25); sfx.land();
      for (let i = 0; i < 6; i++) fx.puff(P.world, 'smoke', 0.25, 0.9);
      announce('Герой обжёгся');
    },
  },
});

// ---------- следы ----------
const FP = 160, FP_LIFE = 45;
const fpMesh = new THREE.InstancedMesh(
  new THREE.CircleGeometry(0.085, 12),
  new THREE.MeshLambertMaterial({ color: '#4d4870', transparent: true, opacity: 0.42, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }),
  FP,
);
fpMesh.frustumCulled = false;
scene.add(fpMesh);
const fps = Array.from({ length: FP }, () => ({ pos: new THREE.Vector3(), q: new THREE.Quaternion(), born: -1e9 }));
let fpNext = 0;
const Z = new THREE.Vector3(0, 0, 1), _fs = new THREE.Vector3(), _fm = new THREE.Matrix4();

function addFootprint(side) {
  const f = fps[fpNext]; fpNext = (fpNext + 1) % FP;
  _v.crossVectors(P.dir, P.face).multiplyScalar(side * 0.13).add(P.world);
  surfacePoint(_v, 0.03, f.pos);
  f.q.setFromUnitVectors(Z, _v.copy(f.pos).normalize());
  f.born = time;
}

function updateFootprints() {
  for (let i = 0; i < FP; i++) {
    const f = fps[i], age = time - f.born;
    const s = age > FP_LIFE ? 0 : Math.min(1, age * 8) * Math.min(1, (FP_LIFE - age) / 6);
    _fs.setScalar(Math.max(s, 1e-4));
    fpMesh.setMatrixAt(i, _fm.compose(f.pos, f.q, _fs));
  }
  fpMesh.instanceMatrix.needsUpdate = true;
}

// ---------- камера ----------
const _eye = new THREE.Vector3(), _tgt = new THREE.Vector3(), _upv = new THREE.Vector3();
const _cm = new THREE.Matrix4(), _cq = new THREE.Quaternion();
let camSnap = true, orbitA = 0.55;
// наклон камеры относительно обычного вида из-за спины: < 0 – взгляд вверх, в небо; > 0 – камера над героем, смотрит под ноги
let camPitch = 0;
const PITCH_UP = -1, PITCH_DOWN = 1.05;
const FOV = 55;

function setFov(f) {
  if (Math.abs(camera.fov - f) < 0.01) return;
  camera.fov += (f - camera.fov) * 0.2;   // плавно, вместе с движением камеры
  camera.updateProjectionMatrix();
}

function updateCamera(dt) {
  const portrait = camera.aspect < 1;
  modeT += dt;
  let rate;
  if (mode === 'play') {
    // камера ходит по дуге вокруг головы героя; при camPitch = 0 вид тот же, что раньше
    const dist = portrait ? 9.5 : 7.4, height = portrait ? 5.2 : 3.7;
    const D0 = Math.hypot(dist, height - 1.1), base = Math.atan2(height - 1.1, dist);
    // взгляд вверх (u от 0 до 1): камера опускается к земле, подходит к герою, смотрит в небо
    // и шире охватывает – внизу кадра остаются герой и край планеты, выше – небо и солнце
    const u = camPitch < 0 ? camPitch / PITCH_UP : 0;
    const elev = camPitch < 0 ? base * (1 - u) + 0.1 * u : base + camPitch;   // вниз: камера поднимается над героем
    const D = D0 * (1 - u) + 4 * u + P.flightView * 2.3, tilt = u * 0.32;
    _tgt.copy(P.world).addScaledVector(P.dir, 1.1);
    _eye.copy(_tgt).addScaledVector(camF, -Math.cos(elev) * D).addScaledVector(P.dir, Math.sin(elev) * D);
    _tgt.addScaledVector(camF, 1.6).addScaledVector(P.dir, Math.tan(tilt) * (D + 1.6));
    _upv.copy(P.dir);
    setFov(FOV + u * 30 + P.flightView * 9);
    rate = modeT < 2.2 ? 2.4 : 8;
  } else {
    orbitA += dt * 0.16;
    const D = R * (portrait ? 4.9 : 3.3);
    _eye.set(Math.sin(orbitA) * D, D * 0.34, Math.cos(orbitA) * D);
    _tgt.set(0, mode === 'intro' ? -R * 0.55 : 0, 0);
    _upv.set(0, 1, 0);
    rate = 2.2;
    setFov(FOV);
  }
  const k = camSnap ? 1 : 1 - Math.exp(-rate * dt);
  camSnap = false;
  camera.position.lerp(_eye, k);
  if (camera.position.length() < R + 1.6) camera.position.setLength(R + 1.6);   // не пролетать сквозь планету
  _cq.setFromRotationMatrix(_cm.lookAt(_eye, _tgt, _upv));
  camera.quaternion.slerp(_cq, k);
}

function updateSun(dt) {
  const a = Math.atan2(sunDir.z, sunDir.x) + dt * ((Math.PI * 2) / 320);   // оборот за 5 минут с небольшим
  sunDir.set(Math.cos(a), 1.1, Math.sin(a)).normalize();
  sun.position.copy(sunDir).multiplyScalar(60);
  sunSprite.position.copy(sunDir).multiplyScalar(850);
}

// ---------- дни ----------
const active = [];        // включённые дни по порядку
const landmarks = [];     // места, рядом с которыми всплывает подпись
const obstacles = [];     // то, сквозь что герой не проходит
let currentDay = -1;

// табличка «Вести с планеты»: стоит всегда, заговаривает с героем и зовёт в Telegram (src/follow.js)
const follow = createFollowSign({
  THREE, world, R, latLon, surfacePoint, orient, textTexture, obstacles, P, sfx, camera, canvas,
  isPlaying: () => mode === 'play' && $('npc-dlg').hidden,
});

// подпись события: текст комментария, ник автора и число лайков
function creditLine(d) {
  if (!d.author) return '';
  return (d.comment ? `«${d.comment}» – ` : 'Идея: ') + d.author + (d.likes ? ` · ♥ ${d.likes.toLocaleString('ru-RU')}` : '');
}

// ---------- пятна и итоги дней ----------
// Пятно – след на поверхности: корка лавы, трава. Пятна входят в итог дня.
const marks = [];
function addMark({ kind, dir, lat, lon, r, color, day }) {
  const d = dir ? dir.clone().normalize() : latLon(lat, lon);
  const mesh = new THREE.Mesh(
    surfacePatch(d, r, 18, 3, 0.05 + marks.length * 0.002),   // каждое следующее чуть выше: поздние ложатся поверх ранних
    new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
  );
  mesh.receiveShadow = true;
  world.add(mesh);
  const m = { kind, dir: d, r, color, day, mesh };
  marks.push(m);
  return m;
}

function clearMarks() {
  for (const m of marks) { world.remove(m.mesh); m.mesh.geometry.dispose(); m.mesh.material.dispose(); }
  marks.length = 0;
}

// Итог дня – то, что осталось на планете к его концу: что сгорело, что выросло, где лежит лава.
// Итоги хранятся в файле рядом с игрой. Следующий день начинается с итога предыдущего,
// поэтому у всех гостей одна и та же история.
const CANON_FILE = DEMO ? 'canon-demo.json' : 'canon.json';
let canon = {};

function snapshot() {
  const deg = 180 / Math.PI, out = { things: {}, marks: [] };
  for (const t of things) { const st = t.save?.(); if (st) out.things[t.name] = st; }
  for (const m of marks) {
    out.marks.push({
      kind: m.kind, lat: +(Math.asin(m.dir.y) * deg).toFixed(2), lon: +(Math.atan2(m.dir.x, m.dir.z) * deg).toFixed(2),
      r: +m.r.toFixed(2), color: m.color, day: m.day,
    });
  }
  return out;
}

// записать итог текущего дня и вернуть весь файл итогов текстом
function saveDay() {
  canon[currentDay] = snapshot();
  return JSON.stringify(canon, null, 1);
}

// привести мир к итогу дня n (или ближайшего сохранённого до него)
function applyCanon(n) {
  let key = -1;
  for (const k of Object.keys(canon)) { const v = +k; if (v <= n && v > key) key = v; }
  if (key < 0) return;
  const snap = canon[key];
  for (const [name, st] of Object.entries(snap.things || {})) things.find((t) => t.name === name)?.restore?.(st);
  for (const m of snap.marks || []) addMark(m);
}

function instantiate(d, animate, live, viewedDay) {
  const root = new THREE.Group();
  root.name = `day-${d.day}`;
  world.add(root);
  const disposers = [], lms = [], obs = [], own = [];
  const ctx = {
    THREE, R, day: d, viewedDay, demo: DEMO, root, scene, camera, rules, sfx, fx, player: P,
    // live: день идёт вживую (он сегодняшний); иначе он уже история, и его последствия берутся из итога
    live,
    // повторяемая случайность: у всех гостей сцена дня идёт одинаково
    random: mulberry32(1000 + d.day),
    // пятна на поверхности, которые остаются в итоге дня
    marks, addMark(m) { return addMark({ ...m, day: d.day }); },
    latLon, surfacePoint, surfaceRadius, surfacePatch, orient, textTexture,
    // вещи и события
    things, hero: heroThing, playerKick: hero.kick, heroActive: () => mode === 'play',
    canTalk: () => mode === 'play' && !follow.open && $('log').hidden && !document.body.classList.contains('clean'),
    arc, moveToward, randomNear, pushOut, findThing, affect, announce,
    // зарегистрировать вещь: { name, acc, tags, dir, radius, on: { burn, scare }, lift(dir, h) }
    addThing(t) { const th = makeThing(t); own.push(th); return th; },
    // подпись, всплывающая рядом с местом dir; если объект движется, передай его «живой» вектор
    addLandmark(lm) { const o = { radius: 3, ...lm, day: d.day }; landmarks.push(o); lms.push(o); return o; },
    // круглое препятствие радиуса radius вокруг dir; для движущихся вещей передай «живой» вектор
    addObstacle(dir, radius) { const o = { dir, radius }; obstacles.push(o); obs.push(o); return o; },
    // стандартная подпись «День N · название · автор идеи»
    credit(dir, radius = 3) { return ctx.addLandmark({ dir, radius, title: `День ${d.day} · ${d.title}`, text: creditLine(d) }); },
    // вернуть на место то, что день поменял в общих правилах
    onDispose(fn) { disposers.push(fn); },
  };
  const inst = d.setup(ctx) || {};
  for (const c of root.children) c.userData.baseScale = c.scale.clone();
  return { d, root, inst, disposers, lms, obs, own, pop: animate ? 0 : 1, t: 0 };   // t – сколько секунд день уже идёт
}

function teardown(a) {
  a.inst.dispose?.();
  a.disposers.forEach((f) => f());
  for (const lm of a.lms) { const i = landmarks.indexOf(lm); if (i >= 0) landmarks.splice(i, 1); }
  for (const o of a.obs) { const i = obstacles.indexOf(o); if (i >= 0) obstacles.splice(i, 1); }
  for (const t of a.own) { const i = things.indexOf(t); if (i >= 0) things.splice(i, 1); }
  world.remove(a.root);
  a.root.traverse((o) => {
    o.geometry?.dispose();
    if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { m.map?.dispose(); m.dispose(); });
  });
}

function setDay(n) {
  const dayIndex = days.findLastIndex((d) => d.day <= n);
  const index = Math.max(0, dayIndex);
  n = days[index].day;
  if (n === currentDay) return;
  const next = currentDay >= 0 && days[index - 1]?.day === currentDay;   // шаг на день вперёд: новое появляется с анимацией
  // Мир собирается заново: прошлые дни берутся из сохранённых итогов, а день n идёт вживую.
  while (active.length) teardown(active.pop());
  clearMarks();
  heroThing.held = false;
  for (const d of days) if (d.day < n) active.push(instantiate(d, false, false, n));
  applyCanon(n - 1);
  for (const d of days) if (d.day === n) active.push(instantiate(d, next, true, n));
  if (next) sfx.pop();
  currentDay = n;

  const d = active[active.length - 1].d;
  $('daynum').textContent = `ДЕНЬ ${n}`;
  $('daytitle').textContent = n === 0 ? 'Пустая планета' : `+ ${d.title}` + (d.demo ? ' · пример' : d.author ? ` · ${d.author}` : '');
  $('intro-day').textContent = `День ${n}`;
  $('intro-copy').textContent = d === DAYS[1]
    ? 'Сегодня в прогнозе – фрикадельки. Круглосуточно.'
    : 'Самая пустая игра в мире. Каждый день здесь появляется одна новая вещь – та, которую выбрал самый залайканный комментарий.';
  // в день 0 ничего не происходит – переигрывать нечего
  $('b-replay').hidden = !(n === maxDay && n > 0);
  renderPassport();
  renderLog();
}

function updateDays(dt) {
  for (const a of active) {
    a.t += dt;
    if (a.pop < 1) {
      a.pop = Math.min(1, a.pop + dt / 0.55);
      const s = Math.max(0.001, easeOutBack(a.pop));
      for (const c of a.root.children) if (c.userData.baseScale) c.scale.copy(c.userData.baseScale).multiplyScalar(s);
    }
    a.inst.update?.(dt, time);
  }
}

// ---------- паспорт находок ----------
// Вещь каждого дня надо найти на планете. Отметки хранятся в браузере гостя.
const PASS_KEY = DEMO ? 'planet-passport-demo' : 'planet-passport';
const found = new Set();
try { for (const n of JSON.parse(localStorage.getItem(PASS_KEY) || '[]')) found.add(n); } catch { /* хранилище недоступно – играем без сохранения */ }

function passport() {
  const all = new Set(landmarks.map((lm) => lm.day));
  let have = 0;
  for (const n of all) if (found.has(n)) have++;
  return { have, total: all.size };
}

function renderPassport() {
  const p = passport();
  $('passport').textContent = `Найдено ${p.have} из ${p.total}`;
}

function markFound(lm) {
  if (found.has(lm.day)) return;
  found.add(lm.day);
  try { localStorage.setItem(PASS_KEY, JSON.stringify([...found])); } catch { /* не сохранилось – не страшно */ }
  const p = passport();
  announce(`Найдено: ${lm.title}. ` + (p.have === p.total ? 'Это всё, что есть на планете. Возвращайся завтра.' : `Осталось найти: ${p.total - p.have}`), 'find');
  sfx.pop();
  renderPassport();
  renderLog();
  // нашёл всё, что есть на планете: самое время позвать следить за продолжением
  if (p.have === p.total) {
    const b = $('b-follow');
    b.classList.remove('nudge');
    void b.offsetWidth;
    b.classList.add('nudge');
  }
}

// ---------- интерфейс ----------
const tipEl = $('tip');
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

function renderLog() {
  const list = $('log-list');
  list.textContent = '';
  for (const d of [...days].reverse()) {
    const li = el('li', d.day > currentDay ? 'future' : '');
    const dayNumber = !DEMO && d.day === 0 ? 1 : d.day;
    li.append(el('div', 'n', `День ${dayNumber}` + (found.has(d.day) ? ' · найдено' : '')), el('div', 't', d.title + (d.demo ? ' (пример)' : '')));
    if (d.summary) li.append(el('div', 's', d.summary));
    const c = creditLine(d);
    if (c) li.append(el('div', 'c', c));
    list.append(li);
  }
}

let tipLm = null;
function updateTip() {
  let best = null, bd = Infinity;
  if (mode === 'play') {
    for (const lm of landmarks) {
      const d = Math.acos(THREE.MathUtils.clamp(P.dir.dot(lm.dir), -1, 1)) * R;
      if (d < lm.radius && d < bd) { bd = d; best = lm; }
    }
  }
  if (best === tipLm) return;
  tipLm = best;
  tipEl.textContent = '';
  if (best) {
    tipEl.append(el('b', '', best.title));
    if (best.text) tipEl.append(el('span', '', best.text));
  }
  tipEl.hidden = !best;
  if (best) markFound(best);
}

function setMode(m) {
  mode = m; modeT = 0;
  document.body.dataset.mode = m;
  $('b-orbit').textContent = m === 'orbit' ? 'На планету' : 'Орбита';
}

function toggleLog(show = $('log').hidden) { $('log').hidden = !show; }

const touch = matchMedia('(pointer: coarse)').matches;
document.body.classList.toggle('touch', touch);

const gameScreen = document.documentElement;
const fullscreenButton = $('b-fullscreen');
const appMode = navigator.standalone || matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches;
const requestFullscreen = document.fullscreenEnabled && gameScreen.requestFullscreen;
const requestWebkitFullscreen = document.webkitFullscreenEnabled && gameScreen.webkitRequestFullscreen;
const canEnterFullscreen = touch && !appMode && (requestFullscreen || requestWebkitFullscreen);
const isAppleMobile = 'standalone' in navigator || /iPhone|iPad|iPod/.test(navigator.userAgent);
$('ios-install-tip').hidden = !touch || !isAppleMobile || appMode || Boolean(canEnterFullscreen);
fullscreenButton.hidden = !canEnterFullscreen;

function isFullscreen() {
  return Boolean(document.fullscreenElement || document.webkitFullscreenElement);
}

async function toggleFullscreen() {
  try {
    if (isFullscreen()) {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.webkitExitFullscreen();
    } else if (requestFullscreen) {
      await gameScreen.requestFullscreen({ navigationUI: 'hide' });
    } else if (requestWebkitFullscreen) {
      await gameScreen.webkitRequestFullscreen();
    }
  } catch {
    // При отказе браузера игра продолжает работать в обычном режиме.
  }
}

function syncFullscreen() {
  fullscreenButton.textContent = isFullscreen() ? 'Выйти из полного экрана' : 'На весь экран';
  resize();
}
document.addEventListener('fullscreenchange', syncFullscreen);
document.addEventListener('webkitfullscreenchange', syncFullscreen);
fullscreenButton.onclick = toggleFullscreen;
$('hint').textContent = 'WASD – идти · Пробел – прыжок · Зажать мышь и вести – осмотреться · O – орбита · H – скрыть интерфейс';

// подсказка новичку: как осмотреться. Показывается один раз и уходит, когда гость сам повернул камеру
function showCoach() {
  if (coachDone || mode !== 'play') return;
  const c = $('coach');
  c.innerHTML = document.body.classList.contains('touch')
    ? '<b>Осмотреться:</b> ведите пальцем по экрану – в стороны, вверх в небо, вниз под ноги'
    : '<b>Осмотреться:</b> зажмите кнопку мыши и ведите – в стороны, вверх в небо, вниз под ноги';
  c.hidden = false;
}
function finishCoach() {
  coachDone = true;
  try { localStorage.setItem(COACH_KEY, '1'); } catch { /* не страшно */ }
  const c = $('coach');
  if (c.hidden) return;
  c.classList.add('off');
  setTimeout(() => { c.hidden = true; }, 700);
}

$('play').onclick = () => {
  sfx.unlock();
  if (canEnterFullscreen && !isFullscreen()) toggleFullscreen();
  sfx.ui();
  $('intro').classList.add('off');
  setMode('play');
  setTimeout(showCoach, 1500);
};
$('b-orbit').onclick = () => { sfx.unlock(); sfx.ui(); setMode(mode === 'orbit' ? 'play' : 'orbit'); };
$('b-log').onclick = () => toggleLog();
$('log-close').onclick = () => toggleLog(false);
$('b-sound').onclick = () => {
  sfx.unlock(); sfx.setMuted(!sfx.muted);
  $('b-sound').textContent = sfx.muted ? 'Звук: выкл' : 'Звук: вкл';
};
// иначе пробел и стрелки после клика нажимали бы кнопку повторно
document.querySelectorAll('#ui button').forEach((b) => b.addEventListener('click', () => b.blur()));

addEventListener('keydown', (e) => {
  if (e.repeat) return;
  if (follow.onKey(e)) return;
  if (mode === 'intro') { if (e.code === 'Enter' || e.code === 'Space') $('play').click(); return; }
  if (e.code === 'KeyO') $('b-orbit').click();
  else if (e.code === 'KeyL') toggleLog();
  else if (e.code === 'KeyM') $('b-sound').click();
  else if (e.code === 'KeyH') document.body.classList.toggle('clean');
});

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

// режим автора (?author): кнопка скачивает файл с итогами дней
if (qs.has('author')) {
  $('b-save').hidden = false;
  $('b-save').onclick = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([saveDay()], { type: 'application/json' }));
    a.download = CANON_FILE;
    a.click();
    URL.revokeObjectURL(a.href);
    announce(`Итог дня ${currentDay} записан в ${CANON_FILE}. Положи файл в папку игры`, 'find');
  };
}

// ---------- запуск ----------
try {
  const res = await fetch(CANON_FILE, { cache: 'no-store' });
  if (res.ok) canon = await res.json();
} catch { /* файла нет – история идёт без сохранённых итогов */ }

setDay(qs.has('day') ? +qs.get('day') || 0 : maxDay);

// ---------- память сегодняшнего дня на время вкладки ----------
// Сегодняшний день идёт вживую с начала. Чтобы обновление страницы не начинало его заново,
// вкладка помнит, сколько секунд он уже шёл, и после перезагрузки мгновенно прокручивает мир
// до того же места. Случайность в сценах повторяемая (ctx.random), поэтому итог тот же:
// что сгорело – сгорело. Память живёт, пока открыта вкладка (sessionStorage);
// кнопка «День заново» её сбрасывает.
const LIVE_KEY = DEMO ? 'planet-live-demo' : 'planet-live';
const FF_MAX = 240;   // дольше прокручивать не нужно: событие дня укладывается в 4 минуты

const liveDay = () => (currentDay === maxDay ? active[active.length - 1] : null);
function rememberLive() {
  const a = liveDay();
  if (!a) return;
  try { sessionStorage.setItem(LIVE_KEY, JSON.stringify({ day: currentDay, t: Math.round(a.t * 10) / 10 })); } catch { /* без памяти */ }
}
function fastForward(sec) {
  quiet = true;
  for (let left = Math.min(sec, FF_MAX); left > 0; left -= 1 / 30) {
    const dt = Math.min(1 / 30, left);
    time += dt;
    updateDays(dt);
    fx.update(dt);
  }
  quiet = false;
  const a = liveDay();
  if (a) a.t = Math.max(a.t, sec);
}
try {
  const saved = JSON.parse(sessionStorage.getItem(LIVE_KEY) || 'null');
  if (saved && saved.day === maxDay && liveDay() && saved.t > 0.5) fastForward(saved.t);
} catch { /* памяти нет – день идёт с начала */ }
setInterval(rememberLive, 1000);
addEventListener('pagehide', rememberLive);

$('b-replay').onclick = () => {
  sfx.unlock(); sfx.ui();
  try { sessionStorage.removeItem(LIVE_KEY); } catch { /* не страшно */ }
  const n = currentDay;
  currentDay = -1;   // иначе setDay решит, что день уже открыт
  setDay(n);
  announce('День начался заново', 'find');
};

// один шаг мира; вынесен отдельно, чтобы его можно было прокрутить из консоли
function tick(dt) {
  time += dt;
  updateSun(dt);
  updatePlayer(dt, mode === 'play' && !follow.open && $('npc-dlg').hidden);
  follow.update(dt, time);
  updateDays(dt);
  fx.update(dt);
  updateFootprints();
  updateCamera(dt);
  updateTip();
}

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  tick(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// для отладки и съёмки из консоли: __game.setDay(5), __game.setMode('orbit')
window.__game = { setDay, setMode, tick, snapshot, saveDay, P, input, rules, days, things, marks, canon: () => canon, get day() { return currentDay; }, get mode() { return mode; } };
