import * as THREE from 'three';

// Герой: маленький исследователь с тёмным визором и фонариком на антенне.
// Модель смотрит вдоль +Z, начало координат – у подошв.
export function createPlayer() {
  const root = new THREE.Group();
  const rig = new THREE.Group();
  root.add(rig);

  const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...o });
  const shell = std('#fff5e8', { roughness: 0.5 });
  const dark = std('#17142b', { roughness: 0.25 });
  const warm = std('#ff9a3d');

  const add = (geo, mat, x, y, z, parent = rig) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z); m.castShadow = true; parent.add(m);
    return m;
  };

  add(new THREE.CapsuleGeometry(0.3, 0.3, 8, 20), shell, 0, 0.6, 0);
  const visor = add(new THREE.SphereGeometry(0.24, 24, 16), dark, 0, 0.72, 0.17);
  visor.scale.set(1, 0.7, 0.62);
  const eyeMat = new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false });
  const eyes = [-1, 1].map((s) => {
    const e = add(new THREE.SphereGeometry(0.036, 12, 10), eyeMat, s * 0.085, 0.735, 0.312);
    e.castShadow = false;
    return e;
  });
  add(new THREE.BoxGeometry(0.3, 0.32, 0.14), warm, 0, 0.6, -0.3);                 // ранец
  add(new THREE.CylinderGeometry(0.012, 0.012, 0.24, 6), dark, 0, 1.14, 0);        // антенна
  const bulbMat = new THREE.MeshStandardMaterial({ color: '#ffd27a', emissive: '#ff9a1f', emissiveIntensity: 3 });
  add(new THREE.SphereGeometry(0.05, 14, 10), bulbMat, 0, 1.29, 0).castShadow = false;
  const lamp = new THREE.PointLight('#ffb054', 7, 7, 2);
  lamp.position.set(0, 1.3, 0);
  rig.add(lamp);

  const hands = [-1, 1].map((s) => add(new THREE.SphereGeometry(0.07, 12, 10), warm, s * 0.34, 0.52, 0.02));
  const feet = [-1, 1].map((s) => {
    const f = add(new THREE.SphereGeometry(0.1, 14, 10), warm, s * 0.13, 0.07, 0.03, root);
    f.scale.set(1, 0.62, 1.4);
    return f;
  });

  let phase = 0, lastStep = 0, lean = 0, blinkT = 2;
  let sq = 0, sqV = 0;   // пружина «сжатие-растяжение»

  return {
    root,
    // толчок пружины: плюс – вытянуться, минус – присесть
    kick(a) { sqV += a * 13; },

    // возвращает -1 или 1, когда нога коснулась земли (для звука и следа), иначе 0
    update(dt, s) {
      const m = s.grounded ? s.move : 0;
      phase += dt * 11.5 * s.move;

      feet.forEach((f, i) => {
        const ph = phase + i * Math.PI;
        f.position.z = 0.03 + Math.sin(ph) * 0.17 * m;
        f.position.y = 0.07 + Math.max(0, Math.cos(ph)) * 0.1 * m + (s.grounded ? 0 : 0.05);
      });
      hands.forEach((h, i) => { h.position.z = 0.02 - Math.sin(phase + i * Math.PI) * 0.12 * m; });

      rig.position.y = Math.abs(Math.sin(phase)) * 0.04 * m + Math.sin(s.time * 2.2) * 0.008;
      lean += (s.move * 0.17 - lean) * (1 - Math.exp(-10 * dt));
      rig.rotation.x = lean;

      sqV += (-180 * sq - 16 * sqV) * dt;
      sq += sqV * dt;
      const air = s.grounded ? 0 : THREE.MathUtils.clamp(s.vy * 0.012, -0.08, 0.12);
      const k = THREE.MathUtils.clamp(sq + air, -0.4, 0.4);
      rig.scale.set(1 - k * 0.5, 1 + k, 1 - k * 0.5);

      blinkT -= dt;
      const blink = blinkT < 0.1 ? 0.12 : 1;
      if (blinkT < 0) blinkT = 2 + Math.random() * 3.5;
      eyes.forEach((e) => { e.scale.y = blink; });

      const n = Math.floor(phase / Math.PI);
      if (n !== lastStep) {
        lastStep = n;
        if (m > 0.2) return n % 2 === 0 ? 1 : -1;
      }
      return 0;
    },
  };
}
