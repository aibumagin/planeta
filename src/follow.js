// Табличка «Вести с планеты» рядом с табличкой дня. При первой встрече она сама заговаривает,
// как персонаж в RPG, и предлагает заглянуть в Telegram-канал автора: «Да» или «Нет».
// Дальше сама не пристаёт: поговорить снова – кликнуть по ней мышью или тапнуть пальцем.
// Это не часть истории дней: табличка стоит всегда, в итоги дней и паспорт находок не входит.

export const FOLLOW_URL = 'https://t.me/aibumagin';

const SPEAKER = 'Табличка «Вести с планеты»';
const FIRST = 'Путник, постой! Что появится здесь завтра, решают комментарии. Следить за новыми днями планеты можно в Telegram-канале автора. Заглянешь?';
const AGAIN = 'Снова привет, путник! Новые дни планеты – в Telegram-канале автора. Заглянешь?';
const TALK_R = 1.5;                    // на каком расстоянии табличка заговаривает в первый раз
const ASKED_KEY = 'planet-follow-asked';   // гость уже слышал предложение – больше сама не заговорит

export function createFollowSign({ THREE, world, R, latLon, surfacePoint, orient, textTexture, obstacles, P, sfx, isPlaying, camera, canvas }) {
  const dir = latLon(67, 152);                     // рядом с табличкой «День 0», ближе к месту высадки
  const start = new THREE.Vector3(0, 1, 0);
  const TG = '#2aabee';

  // бумажный самолётик – знак Telegram, нарисованный простыми линиями
  const plane = (g, x, y, s, color) => {
    const p = [[0.0, 0.47], [1.0, 0.0], [0.73, 0.95], [0.46, 0.7], [0.33, 0.88], [0.32, 0.6]];
    g.fillStyle = color; g.beginPath();
    p.forEach(([px, py], i) => (i ? g.lineTo(x + px * s, y + py * s) : g.moveTo(x + px * s, y + py * s)));
    g.closePath(); g.fill();
  };

  const wood = new THREE.MeshStandardMaterial({ color: '#6b5a4a', roughness: 0.9 });
  const face = new THREE.MeshStandardMaterial({
    roughness: 0.7,
    map: textTexture(1024, 576, (g, w, h) => {
      const font = (px, weight) => `${weight} ${px}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
      g.fillStyle = '#1484c8'; g.fillRect(0, 0, w, h);   // темнее фирменного: на солнце планеты синий светлеет
      g.strokeStyle = '#fff'; g.lineWidth = 14; g.strokeRect(24, 24, w - 48, h - 48);
      plane(g, 80, 150, 250, '#fff');
      g.fillStyle = '#fff'; g.textAlign = 'left'; g.textBaseline = 'middle';
      g.font = font(124, 900); g.fillText('ВЕСТИ', 380, h * 0.33);
      g.font = font(80, 800); g.fillText('С ПЛАНЕТЫ', 382, h * 0.55);
      g.font = font(46, 600); g.globalAlpha = 0.9; g.fillText('канал автора в Telegram', 384, h * 0.78);
    }),
  });

  // табличка чуть светится сама, как экран: иначе в тени планеты синий сереет
  face.emissive.set('#ffffff'); face.emissiveMap = face.map; face.emissiveIntensity = 0.35;

  const sign = new THREE.Group();
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.075, 1.4, 8), wood);
  post.position.y = 0.7; post.castShadow = true;
  const board = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.84, 0.07), [wood, wood, wood, wood, face, wood]);
  board.position.set(0, 1.38, 0.07); board.rotation.z = -0.04; board.castShadow = true;
  sign.add(post, board);
  sign.position.copy(surfacePoint(dir, -0.06));
  orient(sign, dir, start.clone().sub(dir));      // лицом к месту высадки
  world.add(sign);
  obstacles.push({ dir, radius: 0.5 });

  // значок над табличкой, как у персонажа с заданием: покачивается, пока с ней не поговорили
  const mark = new THREE.Sprite(new THREE.SpriteMaterial({
    depthWrite: false,
    map: textTexture(256, 256, (g, w) => {
      g.fillStyle = TG; g.beginPath(); g.arc(w / 2, w / 2, w * 0.46, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#fff'; g.lineWidth = 10; g.stroke();
      plane(g, w * 0.24, w * 0.3, w * 0.5, '#fff');
    }),
  }));
  mark.scale.setScalar(0.5);
  world.add(mark);
  const _m = new THREE.Vector3();

  // ---------- диалог ----------
  const $ = (id) => document.getElementById(id);
  const box = $('dlg'), txt = $('dlg-text'), opts = [...box.querySelectorAll('#dlg-opts button')];
  $('dlg-name').textContent = SPEAKER;
  let asked = false;
  try { asked = localStorage.getItem(ASKED_KEY) === '1'; } catch { /* без хранилища спросит в каждый визит */ }
  let open = false, talked = asked, sel = 0, shown = 0, typing = 0, LINE = FIRST;

  const select = (i) => { sel = i; opts.forEach((b, k) => b.classList.toggle('sel', k === i)); };
  const finishTyping = () => { shown = LINE.length; txt.textContent = LINE; box.classList.add('ready'); };

  function show() {
    LINE = asked ? AGAIN : FIRST;
    if (!asked) { asked = true; try { localStorage.setItem(ASKED_KEY, '1'); } catch { /* не страшно */ } }
    open = true; talked = true;
    shown = 0; typing = 0; txt.textContent = '';
    box.classList.remove('ready');
    select(0);
    box.hidden = false;
    document.body.classList.add('talking');
    sfx.ui();
  }
  function close(yes) {
    if (!open) return;
    open = false;
    box.hidden = true;
    document.body.classList.remove('talking');
    sfx.ui();
    if (yes) window.open(FOLLOW_URL, '_blank', 'noopener');
  }
  function choose(i) {
    if (shown < LINE.length) { finishTyping(); return; }   // первое нажатие – дочитать реплику целиком
    close(i === 0);
  }

  opts.forEach((b, i) => {
    b.addEventListener('pointerenter', () => select(i));
    b.addEventListener('click', () => { finishTyping(); close(i === 0); });
  });
  txt.addEventListener('click', finishTyping);

  // клик мышью или тап по табличке (или по значку над ней) – заговорить снова.
  // Отличаем от поворота камеры: палец или мышь почти не сдвинулись и отпустили быстро.
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), pick = [post, board, mark];
  const hit = (e) => {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    return ray.intersectObjects(pick, false).length > 0;
  };
  let down = null;
  canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId }; });
  canvas.addEventListener('pointerup', (e) => {
    if (!down || down.id !== e.pointerId) return;
    const tap = Math.hypot(e.clientX - down.x, e.clientY - down.y) < 8 && performance.now() - down.t < 500;
    down = null;
    if (tap && !open && isPlaying() && hit(e)) show();
  });
  // на компьютере курсор-рука над табличкой подсказывает, что по ней можно кликнуть
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse' || e.buttons) return;
    canvas.style.cursor = !open && isPlaying() && hit(e) ? 'pointer' : '';
  });

  // клавиши, пока открыт диалог; true – клавиша обработана здесь
  function onKey(e) {
    if (!open) return false;
    const c = e.code;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyS', 'KeyA', 'KeyD'].includes(c)) { select(1 - sel); sfx.step(); }
    else if (c === 'Enter' || c === 'Space' || c === 'KeyE') choose(sel);
    else if (c === 'Escape') close(false);
    else return false;
    e.preventDefault();
    return true;
  }

  function update(dt, t) {
    // значок покачивается и тихо поворачивается; после разговора становится меньше
    surfacePoint(dir, 2.05 + Math.sin(t * 2.2) * 0.08, _m);
    mark.position.copy(_m);
    mark.scale.setScalar(talked ? 0.32 : 0.5);

    if (open) {
      if (!isPlaying()) { close(false); return; }
      if (shown < LINE.length) {
        typing += dt * 48;                                  // печатает по буквам, как в RPG
        const n = Math.min(LINE.length, Math.floor(typing));
        if (n !== shown) { shown = n; txt.textContent = LINE.slice(0, n); }
        if (shown >= LINE.length) box.classList.add('ready');
      }
      return;
    }
    // сама заговаривает только при первой встрече
    if (asked || !isPlaying()) return;
    const d = Math.acos(THREE.MathUtils.clamp(P.dir.dot(dir), -1, 1)) * R;
    if (d < TALK_R) show();
  }

  return { update, onKey, get open() { return open; } };
}
