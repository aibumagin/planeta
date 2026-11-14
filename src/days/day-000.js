// День 0. На планете нет ничего, кроме таблички. Она останется навсегда как первый памятник.
export default {
  day: 0,
  title: 'Пустота',
  summary: 'Планета, герой и одна табличка. Больше ничего – так задумано.',
  author: null, likes: null, comment: null,

  setup(ctx) {
    const { THREE, root } = ctx;
    const dir = ctx.latLon(64, 180);
    const start = new THREE.Vector3(0, 1, 0);
    const dayTwo = !ctx.demo && ctx.viewedDay >= 2;

    const wood = new THREE.MeshStandardMaterial({ color: '#6b5a4a', roughness: 0.9 });
    const face = new THREE.MeshStandardMaterial({
      roughness: 0.8,
      map: ctx.textTexture(1024, 576, (g, w, h) => {
        const font = (px, weight) => `${weight} ${px}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
        g.fillStyle = '#f3ead8'; g.fillRect(0, 0, w, h);
        g.strokeStyle = '#2a2233'; g.lineWidth = 14; g.strokeRect(24, 24, w - 48, h - 48);
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillStyle = '#2a2233';
        g.font = font(190, 900);
        g.fillText(dayTwo ? 'ДЕНЬ 2' : 'ДЕНЬ 0', w / 2, h * (dayTwo ? 0.51 : 0.36));
        if (dayTwo) return;
        g.font = font(62, 700); g.fillText('здесь пока ничего нет', w / 2, h * 0.68);
        g.fillStyle = '#7a6f66';
        g.font = font(44, 600); g.fillText('что появится завтра – решают комментарии', w / 2, h * 0.85);
      }),
    });

    const sign = new THREE.Group();
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.075, 1.6, 8), wood);
    post.position.y = 0.8; post.castShadow = true;
    const board = new THREE.Mesh(new THREE.BoxGeometry(1.78, 1.0, 0.07), [wood, wood, wood, wood, face, wood]);
    board.position.set(0, 1.55, 0.07); board.rotation.z = 0.035; board.castShadow = true;
    sign.add(post, board);

    sign.position.copy(ctx.surfacePoint(dir, -0.06));
    ctx.orient(sign, dir, start.clone().sub(dir));   // лицом к месту высадки
    root.add(sign);

    ctx.addObstacle(dir, 0.55);
    ctx.addLandmark({
      dir, radius: 3.4,
      title: dayTwo ? 'Табличка «День 2»' : 'День 0 · Пустота',
      text: dayTwo ? '' : 'Здесь пока ничего нет. Что появится завтра – решит самый залайканный комментарий.',
    });

    // табличка деревянная: от огня она обугливается, но остаётся стоять
    let smoke = 0, mossy = false;
    const tmp = new THREE.Vector3();
    const scorch = () => { thing.spent = true; face.color.set('#5a4a3c'); wood.color.set('#2b2420'); board.rotation.z = 0.16; };
    const moss = () => { mossy = true; face.color.set('#86a36a'); wood.color.set('#3f4a2c'); };
    const thing = ctx.addThing({
      name: 'табличка', acc: 'табличку', tags: ['flammable'], dir, radius: 0.6,
      // что табличка помнит между днями
      save: () => (thing.spent ? { scorched: true, mossy } : undefined),
      restore(st) { if (st.scorched) scorch(); if (st.mossy) moss(); },
      on: {
        burn() {
          if (thing.spent) return;
          scorch();
          smoke = 4;
          ctx.announce('Табличка обуглилась');
        },
        // зелень добирается и до обугленной таблички
        grow() {
          if (!thing.spent || mossy) return;
          moss();
          ctx.announce('Табличка поросла мхом');
        },
      },
    });

    return {
      update(dt) {
        if (smoke <= 0) return;
        smoke -= dt;
        if (Math.random() < dt * 9) ctx.fx.puff(board.getWorldPosition(tmp), 'smoke', 0.28, 1.3);
      },
    };
  },
};
