/* ============================================================
   ReefWatch AR — marker scene

   The printed card is treated as an opening cut into the table
   rather than a pedestal. A well descends beneath it, and an
   occluder plane at the card surface hides everything outside
   the opening, so the reef only shows through the hole.
   ============================================================ */

/* ------------------------------------------------------------
   portal-well

   The occlusion trick: draw a large plane at the card surface
   with a rectangular hole in it. Its material writes depth but
   no colour, and renders first. Anything below the card that
   is not inside the hole fails the depth test and disappears.

   The result reads as a genuine opening rather than a model
   floating above a picture.
   ------------------------------------------------------------ */
AFRAME.registerComponent('portal-well', {
  schema: {
    width:  { type: 'number', default: 0.76 },
    depth:  { type: 'number', default: 0.44 },
    drop:   { type: 'number', default: 0.52 },
    rock:   { type: 'color',  default: '#123742' },
    sand:   { type: 'color',  default: '#C9BCA0' }
  },

  init: function () {
    const d = this.data;
    const group = new THREE.Group();

    const hw = d.width * 0.5;
    const hd = d.depth * 0.5;

    /* --- occluder: big plane, hole in the middle --- */
    const outer = new THREE.Shape();
    outer.moveTo(-6, -6);
    outer.lineTo( 6, -6);
    outer.lineTo( 6,  6);
    outer.lineTo(-6,  6);
    outer.lineTo(-6, -6);

    const hole = new THREE.Path();
    const r = 0.04;                     // corner rounding
    hole.moveTo(-hw + r, -hd);
    hole.lineTo( hw - r, -hd);
    hole.quadraticCurveTo( hw, -hd,  hw, -hd + r);
    hole.lineTo( hw,  hd - r);
    hole.quadraticCurveTo( hw,  hd,  hw - r,  hd);
    hole.lineTo(-hw + r,  hd);
    hole.quadraticCurveTo(-hw,  hd, -hw,  hd - r);
    hole.lineTo(-hw, -hd + r);
    hole.quadraticCurveTo(-hw, -hd, -hw + r, -hd);
    outer.holes.push(hole);

    const occMat = new THREE.MeshBasicMaterial({
      colorWrite: false,      // invisible
      depthWrite: true,       // but still occludes
      side: THREE.DoubleSide
    });

    const occluder = new THREE.Mesh(new THREE.ShapeGeometry(outer), occMat);
    occluder.rotation.x = -Math.PI / 2;   // lay flat at the card surface
    occluder.renderOrder = -10;           // must write depth before anything else
    group.add(occluder);

    /* --- the well itself: an inside-out box ---
       Vertex colours darken the walls with depth, which does the
       job of water absorption without a custom shader. */
    const wellGeo = new THREE.BoxGeometry(d.width, d.drop, d.depth, 1, 6, 1);
    const posAttr = wellGeo.attributes.position;
    const colours = new Float32Array(posAttr.count * 3);
    const top = new THREE.Color(d.rock);
    const bottom = new THREE.Color(d.rock).multiplyScalar(0.28);
    const c = new THREE.Color();

    for (let i = 0; i < posAttr.count; i++) {
      // y runs from -drop/2 (bottom) to +drop/2 (top)
      const t = (posAttr.getY(i) + d.drop * 0.5) / d.drop;
      c.copy(bottom).lerp(top, Math.pow(t, 0.8));
      colours[i * 3] = c.r;
      colours[i * 3 + 1] = c.g;
      colours[i * 3 + 2] = c.b;
    }
    wellGeo.setAttribute('color', new THREE.BufferAttribute(colours, 3));

    const wallMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.95,
      metalness: 0.0,
      side: THREE.BackSide
    });

    const well = new THREE.Mesh(wellGeo, wallMat);
    well.position.y = -d.drop * 0.5;
    group.add(well);

    /* --- sand floor --- */
    const floorMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(d.sand),
      roughness: 1.0,
      metalness: 0.0,
      emissive: new THREE.Color(d.sand).multiplyScalar(0.16)
    });
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(d.width * 0.99, d.depth * 0.99),
      floorMat
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -d.drop + 0.004;
    group.add(floor);

    // A dedicated downward light keeps the sand bright without
    // washing out the walls.
    const sun = new THREE.DirectionalLight(0xFFF6E4, 0.9);
    sun.position.set(0.1, 1, 0.15);
    sun.target.position.set(0, -d.drop, 0);
    group.add(sun);
    group.add(sun.target);

    /* --- rim highlight so the opening edge reads clearly --- */
    const rimGeo = new THREE.EdgesGeometry(
      new THREE.PlaneGeometry(d.width, d.depth)
    );
    const rim = new THREE.LineSegments(
      rimGeo,
      new THREE.LineBasicMaterial({ color: 0x9FE8FF, transparent: true, opacity: 0.55 })
    );
    rim.rotation.x = -Math.PI / 2;
    rim.position.y = 0.002;
    group.add(rim);

    this.el.setObject3D('well', group);
    this.wallMat = wallMat;
    this.floorMat = floorMat;
  }
});

/* ------------------------------------------------------------
   fit-in-well
   Source models arrive in arbitrary units, so a fixed scale
   value breaks the moment the model is swapped. This measures
   the bounding box after load and scales the model to a target
   size, then sits its base on the sand.
   ------------------------------------------------------------ */
AFRAME.registerComponent('fit-in-well', {
  schema: {
    size:  { type: 'number', default: 0.30 },
    floor: { type: 'number', default: -0.52 }
  },

  init: function () {
    // The model can already be attached by the time this runs —
    // a-asset-item preloading makes that race real — so check as
    // well as listen.
    this.el.addEventListener('model-loaded', () => this.fit());
    if (this.el.getObject3D('mesh')) this.fit();
  },

  fit: function () {
    const mesh = this.el.getObject3D('mesh');
    if (!mesh || this.done) return;

    const obj = this.el.object3D;
    obj.scale.set(1, 1, 1);
    obj.position.set(0, 0, 0);
    obj.updateMatrixWorld(true);

    // setFromObject works in world space; convert into this
    // entity's local space so the numbers are actionable.
    const box = new THREE.Box3().setFromObject(mesh);
    box.applyMatrix4(new THREE.Matrix4().copy(obj.matrixWorld).invert());

    const span = new THREE.Vector3();
    box.getSize(span);
    const largest = Math.max(span.x, span.y, span.z);
    if (!largest || !isFinite(largest)) return;

    const factor = this.data.size / largest;
    obj.scale.setScalar(factor);

    const centre = new THREE.Vector3();
    box.getCenter(centre);

    obj.position.x = -centre.x * factor;
    obj.position.z = -centre.z * factor;
    obj.position.y = this.data.floor - box.min.y * factor;

    this.done = true;
    this.el.emit('fitted', { factor: factor });
  }
});

/* ------------------------------------------------------------
   bleachable
   Clones every material so a shared one is never mutated,
   stores the original colour, then blends toward bone white as
   `amount` runs 0 → 1. This is why no second white model is
   needed.
   ------------------------------------------------------------ */
AFRAME.registerComponent('bleachable', {
  schema: { amount: { type: 'number', default: 0 } },

  init: function () {
    this.materials = [];
    this.bone = new THREE.Color('#FFF6EC');

    const grab = () => {
      const root = this.el.getObject3D('mesh');
      if (!root || this.grabbed) return;
      this.grabbed = true;

      root.traverse((node) => {
        if (!node.isMesh || !node.material) return;
        const many = Array.isArray(node.material);
        const list = many ? node.material : [node.material];

        const cloned = list.map((mat) => {
          const c = mat.clone();
          this.materials.push({
            mat: c,
            base: c.color ? c.color.clone() : new THREE.Color('#ffffff'),
            baseRough: c.roughness !== undefined ? c.roughness : 0.6,
            baseMetal: c.metalness !== undefined ? c.metalness : 0.0
          });
          return c;
        });

        node.material = many ? cloned : cloned[0];
      });

      this.apply();
    };

    this.el.addEventListener('model-loaded', grab);
    grab();
  },

  update: function () { this.apply(); },

  apply: function () {
    const t = Math.min(1, Math.max(0, this.data.amount));
    this.materials.forEach(({ mat, base, baseRough, baseMetal }) => {
      if (mat.color) mat.color.copy(base).lerp(this.bone, t);
      // A dead skeleton is chalkier and less reflective.
      if (mat.roughness !== undefined) mat.roughness = baseRough + (0.95 - baseRough) * t;
      if (mat.metalness !== undefined) mat.metalness = baseMetal * (1 - t);
      mat.needsUpdate = true;
    });
  }
});

/* ------------------------------------------------------------
   tap-to-bleach
   ------------------------------------------------------------ */
AFRAME.registerComponent('tap-to-bleach', {
  schema: { duration: { type: 'number', default: 3600 } },

  init: function () {
    this.running = false;
    this.bleached = false;
    this.elapsed = 0;

    this.onTap = this.onTap.bind(this);

    // The MindAR canvas swallows some pointer events on certain
    // Android builds, so listen at document level.
    this.onScreenTap = (ev) => {
      if (ev.target.closest && ev.target.closest('.ar-back')) return;
      this.onTap();
    };
    document.addEventListener('click', this.onScreenTap);
  },

  onTap: function () {
    if (this.running) return;
    this.running = true;
    this.elapsed = 0;
    this.from = this.bleached ? 1 : 0;
    this.to   = this.bleached ? 0 : 1;
    this.bleached = !this.bleached;
    this.el.sceneEl.emit('reef-state-change', { bleaching: this.to === 1 });
  },

  tick: function (time, delta) {
    if (!this.running) return;
    this.elapsed += delta;
    const t = Math.min(1, this.elapsed / this.data.duration);

    // Ease out — colour drains fast, the last of it lingers.
    const eased = 1 - Math.pow(1 - t, 2.4);
    const value = this.from + (this.to - this.from) * eased;

    this.el.setAttribute('bleachable', 'amount', value);
    this.el.sceneEl.emit('reef-bleach-progress', { amount: value });

    if (t >= 1) this.running = false;
  },

  remove: function () {
    document.removeEventListener('click', this.onScreenTap);
  }
});

/* ------------------------------------------------------------
   reef-fish
   Reef fish are laterally compressed and deep-bodied — closer
   to a disc than a torpedo. Body is a revolved profile, then
   squashed sideways and stretched vertically to get that shape.
   ------------------------------------------------------------ */
AFRAME.registerComponent('reef-fish', {
  schema: {
    hue:    { type: 'color',  default: '#FFB35C' },
    length: { type: 'number', default: 0.075 },
    radius: { type: 'number', default: 0.16 },
    depth:  { type: 'number', default: 0.10 },
    level:  { type: 'number', default: -0.22 },
    speed:  { type: 'number', default: 0.35 },
    phase:  { type: 'number', default: 0 },
    wobble: { type: 'number', default: 0.03 }
  },

  init: function () {
    const d = this.data;
    const L = d.length;
    const group = new THREE.Group();

    const skin = new THREE.MeshStandardMaterial({
      color: new THREE.Color(d.hue),
      roughness: 0.30,
      metalness: 0.22,
      transparent: true,
      opacity: 1
    });

    const fin = new THREE.MeshStandardMaterial({
      color: new THREE.Color(d.hue),
      roughness: 0.55,
      metalness: 0.02,
      transparent: true,
      opacity: 0.68,
      side: THREE.DoubleSide
    });

    this.materials = [skin, fin];

    /* --- body --- */
    const profile = [];
    const steps = 16;
    for (let i = 0; i <= steps; i++) {
      const u = i / steps;                    // 0 = tail root, 1 = snout
      const x = -L * 0.5 + u * L;
      const r = Math.sin(Math.pow(u, 0.58) * Math.PI) * L * 0.22 + L * 0.008;
      profile.push(new THREE.Vector2(Math.max(r, 0.0005), x));
    }

    const body = new THREE.Mesh(new THREE.LatheGeometry(profile, 14), skin);
    body.rotation.z = Math.PI / 2;
    body.scale.set(1, 1.35, 0.34);   // deep-bodied and thin: a reef fish
    group.add(body);

    /* --- caudal fin, forked --- */
    const tailShape = new THREE.Shape();
    tailShape.moveTo(0, 0);
    tailShape.lineTo(-L * 0.30, L * 0.30);
    tailShape.lineTo(-L * 0.19, 0);
    tailShape.lineTo(-L * 0.30, -L * 0.30);
    tailShape.lineTo(0, 0);

    this.tail = new THREE.Group();
    this.tail.position.x = -L * 0.44;
    const tailMesh = new THREE.Mesh(new THREE.ShapeGeometry(tailShape), fin);
    this.tail.add(tailMesh);
    group.add(this.tail);

    /* --- tall dorsal, matching the deep body --- */
    const dorsal = new THREE.Shape();
    dorsal.moveTo( L * 0.20, 0);
    dorsal.lineTo(-L * 0.02, L * 0.30);
    dorsal.lineTo(-L * 0.26, 0);
    const dorsalMesh = new THREE.Mesh(new THREE.ShapeGeometry(dorsal), fin);
    dorsalMesh.position.y = L * 0.12;
    group.add(dorsalMesh);

    /* --- anal fin --- */
    const anal = new THREE.Shape();
    anal.moveTo(-L * 0.04, 0);
    anal.lineTo(-L * 0.15, -L * 0.20);
    anal.lineTo(-L * 0.28, 0);
    const analMesh = new THREE.Mesh(new THREE.ShapeGeometry(anal), fin);
    analMesh.position.y = -L * 0.11;
    group.add(analMesh);

    /* --- pectorals --- */
    const pec = new THREE.Shape();
    pec.moveTo(0, 0);
    pec.lineTo(-L * 0.15, L * 0.06);
    pec.lineTo(-L * 0.14, -L * 0.07);
    [1, -1].forEach((s) => {
      const m = new THREE.Mesh(new THREE.ShapeGeometry(pec), fin);
      m.position.set(L * 0.04, -L * 0.02, s * L * 0.035);
      m.rotation.y = s * 0.6;
      this['pec' + (s > 0 ? 'L' : 'R')] = m;
      group.add(m);
    });

    /* --- eye --- */
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x0d1820, roughness: 0.1, metalness: 0.4 });
    const glintMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    [1, -1].forEach((s) => {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(L * 0.062, 10, 10), eyeMat);
      eye.position.set(L * 0.28, L * 0.06, s * L * 0.045);
      group.add(eye);
      const glint = new THREE.Mesh(new THREE.SphereGeometry(L * 0.024, 6, 6), glintMat);
      glint.position.set(L * 0.305, L * 0.082, s * L * 0.062);
      group.add(glint);
    });

    this.el.setObject3D('fish', group);
    this.group = group;
    this.t = d.phase;
    this.scatter = 0;
    this.baseSpeed = d.speed;
  },

  tick: function (time, delta) {
    if (!this.group) return;
    const d = this.data;
    this.t += (delta / 1000) * (this.baseSpeed + this.scatter * 1.4);

    const a = this.t * Math.PI * 2;
    const x = Math.cos(a) * d.radius;
    const z = Math.sin(a) * d.depth;
    // As the reef dies, fish rise toward the opening and leave.
    const y = d.level + Math.sin(this.t * 3.0 + d.phase) * d.wobble + this.scatter * 0.42;

    this.group.position.set(x, y, z);

    // Face the direction of travel, then bank into the turn.
    const na = a + 0.09;
    const nx = Math.cos(na) * d.radius;
    const nz = Math.sin(na) * d.depth;
    this.group.rotation.y = Math.atan2(-(nz - z), (nx - x));
    this.group.rotation.z = Math.sin(this.t * 3.0 + d.phase) * 0.20;
    this.group.rotation.x = Math.cos(this.t * 2.1 + d.phase) * 0.08;

    const beat = 10 + this.scatter * 16;
    if (this.tail) this.tail.rotation.y = Math.sin(this.t * beat) * 0.6;
    if (this.pecL) this.pecL.rotation.z =  Math.sin(this.t * beat * 0.6) * 0.25;
    if (this.pecR) this.pecR.rotation.z = -Math.sin(this.t * beat * 0.6) * 0.25;
  },

  setScatter: function (v) {
    this.scatter = v;
    this.materials.forEach((m, i) => {
      m.opacity = (i === 0 ? 1 : 0.68) * Math.max(0, 1 - v * 1.15);
    });
  }
});

/* ------------------------------------------------------------
   marine-snow — slow drifting particulate inside the well
   ------------------------------------------------------------ */
AFRAME.registerComponent('marine-snow', {
  schema: {
    count: { type: 'number', default: 70 },
    w:     { type: 'number', default: 0.7 },
    d:     { type: 'number', default: 0.4 },
    top:   { type: 'number', default: 0 },
    drop:  { type: 'number', default: 0.5 }
  },

  init: function () {
    const s = this.data;
    const pos = new Float32Array(s.count * 3);
    this.speeds = new Float32Array(s.count);
    this.sway = new Float32Array(s.count);

    for (let i = 0; i < s.count; i++) {
      pos[i * 3]     = (Math.random() - 0.5) * s.w;
      pos[i * 3 + 1] = s.top - Math.random() * s.drop;
      pos[i * 3 + 2] = (Math.random() - 0.5) * s.d;
      this.speeds[i] = 0.008 + Math.random() * 0.022;
      this.sway[i]   = Math.random() * Math.PI * 2;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));

    this.points = new THREE.Points(geo, new THREE.PointsMaterial({
      color: 0xdff6ff,
      size: 0.005,
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    }));

    this.el.setObject3D('snow', this.points);
  },

  tick: function (time, delta) {
    if (!this.points) return;
    const s = this.data;
    const dt = delta / 1000;
    const arr = this.points.geometry.attributes.position.array;

    for (let i = 0; i < s.count; i++) {
      arr[i * 3 + 1] -= this.speeds[i] * dt;
      arr[i * 3] += Math.sin(time * 0.0004 + this.sway[i]) * 0.0001;

      if (arr[i * 3 + 1] < s.top - s.drop) {
        arr[i * 3 + 1] = s.top;
        arr[i * 3]     = (Math.random() - 0.5) * s.w;
        arr[i * 3 + 2] = (Math.random() - 0.5) * s.d;
      }
    }
    this.points.geometry.attributes.position.needsUpdate = true;
  }
});

/* ------------------------------------------------------------
   caustic-light
   Sunlight breaking on a surface above. Two out-of-phase sines
   read as irregular flicker; a slow drift moves the pattern.
   ------------------------------------------------------------ */
AFRAME.registerComponent('caustic-light', {
  schema: { intensity: { type: 'number', default: 0.55 } },

  init: function () {
    // Wide radius and low decay: a soft shifting wash rather than
    // a hotspot burned onto the nearest wall.
    const light = new THREE.PointLight(0xAEEBFF, this.data.intensity, 4.5, 0.7);
    light.position.set(0, 0.12, 0);
    this.el.setObject3D('caustic', light);
    this.light = light;
    this.base = this.data.intensity;
    this.dim = 0;

    this.el.sceneEl.addEventListener('reef-bleach-progress', (ev) => {
      this.dim = ev.detail.amount;
    });
  },

  tick: function (time) {
    if (!this.light) return;
    const f = Math.sin(time * 0.0016) * 0.5 + Math.sin(time * 0.0041) * 0.28;
    // Water clouds as the reef dies, so the light flattens out.
    this.light.intensity = (this.base + f * 0.18) * (1 - this.dim * 0.45);
    this.light.position.x = Math.sin(time * 0.0007) * 0.16;
    this.light.position.z = Math.cos(time * 0.0009) * 0.10;
    this.light.color.setHSL(0.52, 0.8 - this.dim * 0.55, 0.74);
  }
});

/* ------------------------------------------------------------
   UI wiring
   ------------------------------------------------------------ */
document.addEventListener('DOMContentLoaded', () => {
  const prompt    = document.getElementById('prompt');
  const hint      = document.getElementById('hint');
  const card      = document.getElementById('card');
  const cardState = document.getElementById('cardState');
  const cardCopy  = document.getElementById('cardCopy');
  const target    = document.getElementById('target');
  const scene     = document.querySelector('a-scene');

  let hintShown = false;

  target.addEventListener('targetFound', () => {
    prompt.classList.add('is-hidden');
    card.hidden = false;
    requestAnimationFrame(() => card.classList.add('is-visible'));

    if (!hintShown) {
      hintShown = true;
      hint.hidden = false;
      requestAnimationFrame(() => hint.classList.add('is-visible'));
      setTimeout(() => hint.classList.remove('is-visible'), 5000);
    }
  });

  target.addEventListener('targetLost', () => {
    prompt.classList.remove('is-hidden');
    card.classList.remove('is-visible');
  });

  scene.addEventListener('reef-bleach-progress', (ev) => {
    document.querySelectorAll('[reef-fish]').forEach((el) => {
      const c = el.components['reef-fish'];
      if (c && c.setScatter) c.setScatter(ev.detail.amount);
    });
  });

  scene.addEventListener('reef-state-change', (ev) => {
    if (ev.detail.bleaching) {
      cardState.textContent = 'Bleaching';
      cardState.classList.add('is-warning');
      cardCopy.textContent =
        'Heat stress forces the coral to expel its algae. The white is the bare skeleton showing through, and the fish leave with the shelter.';
    } else {
      cardState.textContent = 'Recovering';
      cardState.classList.remove('is-warning');
      cardCopy.textContent =
        'If the water cools quickly enough, algae return and colour comes back. Prolonged heat kills the coral outright.';
    }
    hint.classList.remove('is-visible');
  });

  // If the camera never starts, say why rather than showing black.
  setTimeout(() => {
    if (!document.querySelector('video')) {
      prompt.querySelector('.ar-prompt-title').textContent = 'Camera not available';
      prompt.querySelector('.ar-prompt-copy').textContent =
        'Allow camera access and reload. The page must be opened over https.';
      prompt.classList.add('is-error');
    }
  }, 6000);
});
