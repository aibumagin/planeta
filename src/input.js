// Управление: клавиатура (по физическим клавишам, раскладка не важна),
// сенсорный джойстик, кнопка прыжка и поворот камеры перетаскиванием.
export class Input {
  constructor({ canvas, joy, knob, jumpBtn }) {
    this.kx = 0; this.ky = 0;     // клавиатура
    this.jx = 0; this.jy = 0;     // джойстик
    this.jumpKey = false; this.jumpTouch = false;
    this._look = 0; this._lookY = 0;

    const keys = new Set();
    const has = (...codes) => codes.some((c) => keys.has(c));
    const sync = () => {
      this.kx = (has('KeyD', 'ArrowRight') ? 1 : 0) - (has('KeyA', 'ArrowLeft') ? 1 : 0);
      this.ky = (has('KeyW', 'ArrowUp') ? 1 : 0) - (has('KeyS', 'ArrowDown') ? 1 : 0);
      this.jumpKey = has('Space');
    };
    addEventListener('keydown', (e) => {
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      keys.add(e.code); sync();
    });
    addEventListener('keyup', (e) => { keys.delete(e.code); sync(); });
    addEventListener('blur', () => { keys.clear(); sync(); });

    // джойстик
    const RAD = 46;
    let jid = null, cx = 0, cy = 0;
    const jmove = (e) => {
      if (e.pointerId !== jid) return;
      let dx = e.clientX - cx, dy = e.clientY - cy;
      const l = Math.hypot(dx, dy);
      if (l > RAD) { dx *= RAD / l; dy *= RAD / l; }
      this.jx = dx / RAD; this.jy = -dy / RAD;
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
    };
    const jend = (e) => {
      if (e.pointerId !== jid) return;
      jid = null; this.jx = this.jy = 0; knob.style.transform = '';
    };
    joy.addEventListener('pointerdown', (e) => {
      jid = e.pointerId; joy.setPointerCapture(jid);
      const r = joy.getBoundingClientRect();
      cx = r.left + r.width / 2; cy = r.top + r.height / 2;
      jmove(e);
    });
    joy.addEventListener('pointermove', jmove);
    joy.addEventListener('pointerup', jend);
    joy.addEventListener('pointercancel', jend);

    // прыжок
    jumpBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); this.jumpTouch = true; });
    const jumpOff = () => { this.jumpTouch = false; };
    jumpBtn.addEventListener('pointerup', jumpOff);
    jumpBtn.addEventListener('pointercancel', jumpOff);
    jumpBtn.addEventListener('pointerleave', jumpOff);

    // поворот камеры
    let lid = null, lx = 0, ly = 0;
    canvas.addEventListener('pointerdown', (e) => { lid = e.pointerId; lx = e.clientX; ly = e.clientY; canvas.setPointerCapture(lid); });
    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerId !== lid) return;
      this._look += e.clientX - lx; lx = e.clientX;
      this._lookY += e.clientY - ly; ly = e.clientY;   // вверх-вниз: небо или земля под ногами
    });
    // колесо и правая кнопка тоже крутят камеру: без автопрокрутки и меню браузера
    canvas.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    const lend = (e) => { if (e.pointerId === lid) lid = null; };
    this.dragging = () => lid !== null;
    canvas.addEventListener('pointerup', lend);
    canvas.addEventListener('pointercancel', lend);
  }

  get x() { return Math.max(-1, Math.min(1, this.kx + this.jx)); }
  get y() { return Math.max(-1, Math.min(1, this.ky + this.jy)); }
  get jump() { return this.jumpKey || this.jumpTouch; }

  // сколько пикселей протащили с прошлого кадра
  takeLook() { const v = this._look; this._look = 0; return v; }
  takeLookY() { const v = this._lookY; this._lookY = 0; return v; }
}
