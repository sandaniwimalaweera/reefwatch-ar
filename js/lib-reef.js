/* ============================================================
   ReefWatch AR — shared scene library

   Components used by both the marker scene and the markerless
   scene. Loaded before either page's own script.
   ============================================================ */

/* ------------------------------------------------------------
   fit-model
   Source models come in wildly different units — one Sketchfab
   export may be 0.2 units across, another 400. Hard-coding a
   scale means re-tuning every time the model changes.

   This measures the loaded mesh's bounding box and scales it so
   its largest dimension equals `size` in scene units, then
   drops it so its base sits on the surface below it.
   ------------------------------------------------------------ */
AFRAME.registerComponent('fit-model', {
  schema: {
    size: { type: 'number', default: 0.22 },
    lift: { type: 'number', default: 0.0 }
  },

  init: function () {
    // The model may already be attached by the time this component
    // initialises — a-asset-item preloading makes that race real —
    // so check for it as well as listening for the event.
    this.el.addEventListener('model-loaded', () => this.fit());
    if (this.el.getObject3D('mesh')) this.fit();
  },

  fit: function () {
    const mesh = this.el.getObject3D('mesh');
    if (!mesh || this.done) return;

    const obj = this.el.object3D;

    // Measure at neutral transform, otherwise each fit compounds
    // the last one.
    obj.scale.set(1, 1, 1);
    obj.position.set(0, 0, 0);
    obj.updateMatrixWorld(true);

    // setFromObject returns world space. Convert into this entity's
    // local space so the numbers mean something we can act on.
    const box = new THREE.Box3().setFromObject(mesh);
    const toLocal = new THREE.Matrix4().copy(obj.matrixWorld).invert();
    box.applyMatrix4(toLocal);

    const span = new THREE.Vector3();
    box.getSize(span);
    const largest = Math.max(span.x, span.y, span.z);
    if (!largest || !isFinite(largest)) return;

    const factor = this.data.size / largest;
    obj.scale.setScalar(factor);

    // Centre horizontally, then sit the base on the card surface.
    const centre = new THREE.Vector3();
    box.getCenter(centre);

    obj.position.x = -centre.x * factor;
    obj.position.z = -centre.z * factor;
    obj.position.y = -box.min.y * factor + this.data.lift;

    this.done = true;
    this.el.emit('fitted', { factor: factor, span: span });
  }
});

/* ------------------------------------------------------------
   bleachable
   Clones every material so we never mutate a shared one, stores
   the original colour, then blends toward bone white as
   `amount` runs 0 → 1.

   This is why no second white model is needed.
   ------------------------------------------------------------ */
AFRAME.registerComponent('bleachable', {
  schema: {
    amount: { type: 'number', default: 0 }
  },

  init: function () {
    this.materials = [];
    this.bone = new THREE.Color('#FFF6EC');

    this.el.addEventListener('model-loaded', () => {
      const root = this.el.getObject3D('mesh');
      if (!root) return;

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
    });
  },

  update: function () { this.apply(); },

  apply: function () {
    const t = Math.min(1, Math.max(0, this.data.amount));

    this.materials.forEach(({ mat, base, baseRough, baseMetal }) => {
      if (mat.color) mat.color.copy(base).lerp(this.bone, t);
      // A dead skeleton is chalkier and less reflective than living tissue.
      if (mat.roughness !== undefined) mat.roughness = baseRough + (0.95 - baseRough) * t;
      if (mat.metalness !== undefined) mat.metalness = baseMetal * (1 - t);
      mat.needsUpdate = true;
    });
  }
});

/* ------------------------------------------------------------
   reef-fish
   A proper fish rather than a sphere on a stick.

   Body is a lathe — a profile curve revolved around the long
   axis — which gives the tapered fusiform shape real fish have.
   Flattening it laterally makes it read as a fish from the side.
   Fins are thin cones and triangles. Tail beat, banking and
   pitch are driven per-frame in tick().
   ------------------------------------------------------------ */
AFRAME.registerComponent('reef-fish', {
  schema: {
    hue:     { type: 'color',  default: '#FFB35C' },
    belly:   { type: 'color',  default: '#FFF0D8' },
    length:  { type: 'number', default: 0.11 },
    radius:  { type: 'number', default: 0.14 },   // orbit radius
    height:  { type: 'number', default: 0.10 },   // orbit height above card
    speed:   { type: 'number', default: 0.55 },   // revolutions per second-ish
    phase:   { type: 'number', default: 0 },
    wobble:  { type: 'number', default: 0.035 }
  },

  init: function () {
    const d = this.data;
    const group = new THREE.Group();

    const skin = new THREE.MeshStandardMaterial({
      color: new THREE.Color(d.hue),
      roughness: 0.34,
      metalness: 0.18,
      transparent: true,
      opacity: 1
    });

    const finSkin = new THREE.MeshStandardMaterial({
      color: new THREE.Color(d.hue),
      roughness: 0.5,
      metalness: 0.05,
      transparent: true,
      opacity: 0.72,
      side: THREE.DoubleSide
    });

    this.materials = [skin, finSkin];

    /* --- body: revolve a tapered profile --- */
    const L = d.length;
    const profile = [];
    const steps = 14;
    for (let i = 0; i <= steps; i++) {
      const u = i / steps;                       // 0 = tail root, 1 = nose
      const x = -L * 0.5 + u * L;
      // Fullest just behind the head, tapering to a narrow caudal
      // peduncle at one end and a pointed snout at the other.
      const r = Math.sin(Math.pow(u, 0.62) * Math.PI) * L * 0.21 + L * 0.010;
      profile.push(new THREE.Vector2(Math.max(r, 0.0006), x));
    }

    const bodyGeo = new THREE.LatheGeometry(profile, 12);
    const body = new THREE.Mesh(bodyGeo, skin);
    body.rotation.z = Math.PI / 2;   // lay the lathe axis along X
    body.scale.set(1, 1, 0.62);      // flatten laterally
    group.add(body);

    /* --- caudal fin (tail) --- */
    const tailShape = new THREE.Shape();
    tailShape.moveTo(0, 0);
    tailShape.lineTo(-L * 0.34, L * 0.26);
    tailShape.lineTo(-L * 0.22, 0);
    tailShape.lineTo(-L * 0.34, -L * 0.26);
    tailShape.lineTo(0, 0);

    const tail = new THREE.Mesh(new THREE.ShapeGeometry(tailShape), finSkin);
    tail.position.x = -L * 0.5;
    this.tail = new THREE.Group();
    this.tail.position.x = -L * 0.46;
    tail.position.x = -L * 0.04;
    this.tail.add(tail);
    group.add(this.tail);

    /* --- dorsal fin --- */
    const dorsalShape = new THREE.Shape();
    dorsalShape.moveTo(L * 0.18, 0);
    dorsalShape.lineTo(-L * 0.01, L * 0.26);
    dorsalShape.lineTo(-L * 0.24, 0);
    const dorsal = new THREE.Mesh(new THREE.ShapeGeometry(dorsalShape), finSkin);
    dorsal.position.y = L * 0.08;
    group.add(dorsal);

    /* --- anal fin, smaller and underneath --- */
    const analShape = new THREE.Shape();
    analShape.moveTo(-L * 0.06, 0);
    analShape.lineTo(-L * 0.16, -L * 0.13);
    analShape.lineTo(-L * 0.26, 0);
    const anal = new THREE.Mesh(new THREE.ShapeGeometry(analShape), finSkin);
    anal.position.y = -L * 0.07;
    group.add(anal);

    /* --- pectoral fins --- */
    const pecShape = new THREE.Shape();
    pecShape.moveTo(0, 0);
    pecShape.lineTo(-L * 0.14, L * 0.05);
    pecShape.lineTo(-L * 0.13, -L * 0.06);
    [1, -1].forEach((side) => {
      const pec = new THREE.Mesh(new THREE.ShapeGeometry(pecShape), finSkin);
      pec.position.set(L * 0.02, -L * 0.02, side * L * 0.06);
      pec.rotation.y = side * 0.5;
      pec.rotation.z = -0.25;
      this['pec' + (side > 0 ? 'L' : 'R')] = pec;
      group.add(pec);
    });

    /* --- eye --- */
    const eyeGeo   = new THREE.SphereGeometry(L * 0.055, 10, 10);
    const eyeMat   = new THREE.MeshStandardMaterial({ color: 0x101c26, roughness: 0.15, metalness: 0.3 });
    const pupilGeo = new THREE.SphereGeometry(L * 0.024, 8, 8);
    const pupilMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    [1, -1].forEach((side) => {
      const eye = new THREE.Mesh(eyeGeo, eyeMat);
      eye.position.set(L * 0.30, L * 0.045, side * L * 0.075);
      group.add(eye);

      const glint = new THREE.Mesh(pupilGeo, pupilMat);
      glint.position.set(L * 0.325, L * 0.062, side * L * 0.098);
      group.add(glint);
    });

    this.el.setObject3D('fish', group);
    this.group = group;
    this.t = d.phase;
    this.scatter = 0;
  },

  tick: function (time, delta) {
    if (!this.group) return;
    const d = this.data;
    const dt = delta / 1000;
    this.t += dt * d.speed;

    // Orbit, flattened into an ellipse so it reads as a real
    // swim path rather than a perfect circle.
    const a = this.t * Math.PI * 2;
    const spread = 1 + this.scatter * 2.4;
    const r  = d.radius * spread;
    const x  = Math.cos(a) * r;
    const z  = Math.sin(a) * r * 0.72;
    const y  = d.height + Math.sin(this.t * 3.1 + d.phase) * d.wobble;

    this.group.position.set(x, y, z);

    // Face the direction of travel, then bank into the turn.
    const nextA = a + 0.08;
    const nx = Math.cos(nextA) * r;
    const nz = Math.sin(nextA) * r * 0.72;
    this.group.rotation.y = Math.atan2(-(nz - z), (nx - x));
    this.group.rotation.z = Math.sin(this.t * 3.1 + d.phase) * 0.22;
    this.group.rotation.x = Math.cos(this.t * 2.2 + d.phase) * 0.10;

    // Tail beat, faster when scattering.
    const beat = 9 + this.scatter * 14;
    if (this.tail) this.tail.rotation.y = Math.sin(this.t * beat) * 0.55;
    if (this.pecL) this.pecL.rotation.z = -0.25 + Math.sin(this.t * beat * 0.6) * 0.2;
    if (this.pecR) this.pecR.rotation.z = -0.25 - Math.sin(this.t * beat * 0.6) * 0.2;
  },

  setScatter: function (v) {
    this.scatter = v;
    this.data.speed = 0.55 + v * 1.5;
    this.materials.forEach((m, i) => {
      m.opacity = (i === 0 ? 1 : 0.72) * Math.max(0, 1 - v * 1.2);
    });
  }
});

/* ------------------------------------------------------------
   marine-snow
   Slow drifting particulate. Sells "underwater" more cheaply
   than any amount of extra geometry.
   ------------------------------------------------------------ */
AFRAME.registerComponent('marine-snow', {
  schema: {
    count:  { type: 'number', default: 90 },
    spread: { type: 'number', default: 0.9 },
    top:    { type: 'number', default: 0.75 }
  },

  init: function () {
    const d = this.data;
    const pos = new Float32Array(d.count * 3);
    this.speeds = new Float32Array(d.count);
    this.sway   = new Float32Array(d.count);

    for (let i = 0; i < d.count; i++) {
      pos[i * 3]     = (Math.random() - 0.5) * d.spread;
      pos[i * 3 + 1] = Math.random() * d.top;
      pos[i * 3 + 2] = (Math.random() - 0.5) * d.spread;
      this.speeds[i] = 0.012 + Math.random() * 0.03;
      this.sway[i]   = Math.random() * Math.PI * 2;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));

    const mat = new THREE.PointsMaterial({
      color: 0xdff6ff,
      size: 0.006,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });

    this.points = new THREE.Points(geo, mat);
    this.el.setObject3D('snow', this.points);
  },

  tick: function (time, delta) {
    if (!this.points) return;
    const dt = delta / 1000;
    const arr = this.points.geometry.attributes.position.array;
    const d = this.data;

    for (let i = 0; i < d.count; i++) {
      arr[i * 3 + 1] -= this.speeds[i] * dt;
      arr[i * 3] += Math.sin(time * 0.0004 + this.sway[i]) * 0.00012;

      if (arr[i * 3 + 1] < 0) {
        arr[i * 3 + 1] = d.top;
        arr[i * 3]     = (Math.random() - 0.5) * d.spread;
        arr[i * 3 + 2] = (Math.random() - 0.5) * d.spread;
      }
    }
    this.points.geometry.attributes.position.needsUpdate = true;
  }
});

/* ------------------------------------------------------------
   caustics
   Sunlight breaking on the surface, projected down onto the
   scene. A slowly animated pattern on a spotlight is enough to
   suggest water above without rendering any.
   ------------------------------------------------------------ */
AFRAME.registerComponent('caustic-light', {
  init: function () {
    const light = new THREE.PointLight(0x9fe8ff, 1.1, 3, 2);
    light.position.set(0, 0.7, 0.2);
    this.el.setObject3D('caustic', light);
    this.light = light;
    this.base = 1.1;
  },

  tick: function (time) {
    if (!this.light) return;
    // Two out-of-phase sines read as irregular flicker.
    const f = Math.sin(time * 0.0016) * 0.5 + Math.sin(time * 0.0041) * 0.28;
    this.light.intensity = this.base + f * 0.45;
    this.light.position.x = Math.sin(time * 0.0007) * 0.22;
    this.light.position.z = Math.cos(time * 0.0009) * 0.22;
  }
});
