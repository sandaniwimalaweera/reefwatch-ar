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
    this.tries = 0;

    // The model may already be attached by the time this component
    // initialises — a-asset-item preloading makes that race real —
    // so check for it as well as listening for the event.
    this.el.addEventListener('model-loaded', () => this.attempt());
    if (this.el.getObject3D('mesh')) this.attempt();
  },

  // Draco geometry decodes asynchronously, so the first measurement
  // can come back empty. Retry until the box is real, rather than
  // silently leaving the model at its raw export size.
  attempt: function () {
    if (this.done) return;
    this.fit();
    if (!this.done && this.tries++ < 40) {
      setTimeout(() => this.attempt(), 100);
    }
  },

  fit: function () {
    const mesh = this.el.getObject3D('mesh');
    if (!mesh || this.done) return;

    const obj = this.el.object3D;

    // Measure at neutral transform, otherwise each fit compounds
    // the last one. Rotation is parked too: an entity that is being
    // animated while it loads would otherwise be measured tilted,
    // and sit slightly off the surface for it.
    const spin = obj.quaternion.clone();
    obj.scale.set(1, 1, 1);
    obj.position.set(0, 0, 0);
    obj.quaternion.identity();
    obj.updateMatrixWorld(true);

    // setFromObject returns world space. Convert into this entity's
    // local space so the numbers mean something we can act on.
    const box = new THREE.Box3().setFromObject(mesh);
    const toLocal = new THREE.Matrix4().copy(obj.matrixWorld).invert();
    box.applyMatrix4(toLocal);
    obj.quaternion.copy(spin);

    const span = new THREE.Vector3();
    box.getSize(span);
       const largest = Math.max(span.x, span.y, span.z);
    if (!largest || !isFinite(largest)) {
      console.warn('[fit-model] bounding box not ready', span);
      return;
    }

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
    amount: { type: 'number', default: 0 },
    // Multiplied into the model's own colours as it loads, so one
    // coral export can stand in for several species. Bleaching
    // still runs from whatever base colour that leaves.
    tint:   { type: 'color',  default: '#FFFFFF' }
  },

  init: function () {
    this.materials = [];
    this.bone = new THREE.Color('#FFF6EC');
    this.tint = new THREE.Color(this.data.tint);

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
            base: (c.color ? c.color.clone() : new THREE.Color('#ffffff')).multiply(this.tint),
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
  schema: {
    intensity: { type: 'number', default: 1.1 }
  },

  init: function () {
    const light = new THREE.PointLight(0x9fe8ff, this.data.intensity, 3, 2);
    light.position.set(0, 0.7, 0.2);
    this.el.setObject3D('caustic', light);
    this.light = light;
    this.base = this.data.intensity;
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

/* ------------------------------------------------------------
   contact-shadow

   A soft dark ellipse on the ground beneath an object. Real
   shadow mapping cannot help here — there is no virtual light
   matching the room's actual lighting — but the eye reads any
   dark patch under an object as contact. Without it, placed
   models appear to hover.

   The gradient is drawn once into a canvas and used as an alpha
   map, so it costs one texture and two triangles.
   ------------------------------------------------------------ */
AFRAME.registerComponent('contact-shadow', {
  schema: {
    radius:  { type: 'number', default: 0.8 },
    opacity: { type: 'number', default: 0.45 },
    lift:    { type: 'number', default: 0.004 }
  },

  init: function () {
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');

    const g = ctx.createRadialGradient(
      size / 2, size / 2, 0,
      size / 2, size / 2, size / 2
    );
    // Dense at the centre, falling away quickly — penumbra widens
    // with distance from the contact point.
    g.addColorStop(0.00, 'rgba(0,0,0,1)');
    g.addColorStop(0.45, 'rgba(0,0,0,0.55)');
    g.addColorStop(0.75, 'rgba(0,0,0,0.16)');
    g.addColorStop(1.00, 'rgba(0,0,0,0)');

    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace || tex.colorSpace;

    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      opacity: this.data.opacity,
      depthWrite: false,
      color: 0x000000
    });

    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(this.data.radius * 2, this.data.radius * 2),
      mat
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = this.data.lift;
    mesh.renderOrder = -1;

    this.el.setObject3D('shadow', mesh);
    this.mat = mat;
    this.base = this.data.opacity;

    // A bleached reef loses its own shading, so soften the contact
    // shadow slightly to match.
    this.el.sceneEl.addEventListener('temperature-change', (ev) => {
      if (this.mat) this.mat.opacity = this.base * (1 - ev.detail.bleach * 0.3);
    });
  },

  remove: function () {
    if (this.mat && this.mat.map) this.mat.map.dispose();
    if (this.mat) this.mat.dispose();
  }
});

/* ------------------------------------------------------------
   buildFish
   The mesh construction from reef-fish, pulled out so the school
   can stamp out many bodies without duplicating the geometry code.
   Returns the group plus the parts that need animating.
   ------------------------------------------------------------ */
function buildFish (L, hue) {
  const group = new THREE.Group();

  const skin = new THREE.MeshStandardMaterial({
    color: new THREE.Color(hue),
    roughness: 0.34,
    metalness: 0.18,
    transparent: true,
    opacity: 1
  });

  const finSkin = new THREE.MeshStandardMaterial({
    color: new THREE.Color(hue),
    roughness: 0.5,
    metalness: 0.05,
    transparent: true,
    opacity: 0.72,
    side: THREE.DoubleSide
  });

  /* --- body: revolve a tapered profile --- */
  const profile = [];
  const steps = 14;
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;                  // 0 = tail root, 1 = nose
    const x = -L * 0.5 + u * L;
    const r = Math.sin(Math.pow(u, 0.62) * Math.PI) * L * 0.21 + L * 0.010;
    profile.push(new THREE.Vector2(Math.max(r, 0.0006), x));
  }

  const body = new THREE.Mesh(new THREE.LatheGeometry(profile, 12), skin);
  body.rotation.z = Math.PI / 2;
  body.scale.set(1, 1, 0.62);
  group.add(body);

  /* --- caudal fin --- */
  const tailShape = new THREE.Shape();
  tailShape.moveTo(0, 0);
  tailShape.lineTo(-L * 0.34, L * 0.26);
  tailShape.lineTo(-L * 0.22, 0);
  tailShape.lineTo(-L * 0.34, -L * 0.26);
  tailShape.lineTo(0, 0);

  const tailMesh = new THREE.Mesh(new THREE.ShapeGeometry(tailShape), finSkin);
  tailMesh.position.x = -L * 0.04;
  const tailPivot = new THREE.Group();
  tailPivot.position.x = -L * 0.46;
  tailPivot.add(tailMesh);
  group.add(tailPivot);

  /* --- dorsal --- */
  const dorsalShape = new THREE.Shape();
  dorsalShape.moveTo(L * 0.18, 0);
  dorsalShape.lineTo(-L * 0.01, L * 0.26);
  dorsalShape.lineTo(-L * 0.24, 0);
  const dorsal = new THREE.Mesh(new THREE.ShapeGeometry(dorsalShape), finSkin);
  dorsal.position.y = L * 0.08;
  group.add(dorsal);

  /* --- anal --- */
  const analShape = new THREE.Shape();
  analShape.moveTo(-L * 0.06, 0);
  analShape.lineTo(-L * 0.16, -L * 0.13);
  analShape.lineTo(-L * 0.26, 0);
  const anal = new THREE.Mesh(new THREE.ShapeGeometry(analShape), finSkin);
  anal.position.y = -L * 0.07;
  group.add(anal);

  /* --- pectorals --- */
  const pecShape = new THREE.Shape();
  pecShape.moveTo(0, 0);
  pecShape.lineTo(-L * 0.14, L * 0.05);
  pecShape.lineTo(-L * 0.13, -L * 0.06);

  const pecs = [];
  [1, -1].forEach((side) => {
    const pec = new THREE.Mesh(new THREE.ShapeGeometry(pecShape), finSkin);
    pec.position.set(L * 0.02, -L * 0.02, side * L * 0.06);
    pec.rotation.y = side * 0.5;
    pec.rotation.z = -0.25;
    pecs.push({ mesh: pec, side: side });
    group.add(pec);
  });

  /* --- eyes --- */
  const eyeGeo   = new THREE.SphereGeometry(L * 0.055, 10, 10);
  const eyeMat   = new THREE.MeshStandardMaterial({ color: 0x101c26, roughness: 0.15, metalness: 0.3 });
  const glintGeo = new THREE.SphereGeometry(L * 0.024, 8, 8);
  const glintMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  [1, -1].forEach((side) => {
    const eye = new THREE.Mesh(eyeGeo, eyeMat);
    eye.position.set(L * 0.30, L * 0.045, side * L * 0.075);
    group.add(eye);

    const glint = new THREE.Mesh(glintGeo, glintMat);
    glint.position.set(L * 0.325, L * 0.062, side * L * 0.098);
    group.add(glint);
  });

  // Yaw, then pitch, then roll about the body's own long axis.
  group.rotation.order = 'YZX';

  return { group: group, tail: tailPivot, pecs: pecs, materials: [skin, finSkin] };
}

/* ------------------------------------------------------------
   reef-school
   Boids flocking (Reynolds, 1987). Each fish steers by three
   local rules — separation, alignment, cohesion — summed with
   two environmental forces: stay inside the reef volume, and
   don't swim through the coral.

   No path is authored anywhere. The schooling, the splitting
   around the coral and the re-forming afterwards are all
   emergent from those five weights.

   Neighbour search is brute force. At this count that is a few
   hundred distance checks per frame, which is cheaper on mobile
   than maintaining a spatial index.
   ------------------------------------------------------------ */
AFRAME.registerComponent('reef-school', {
  schema: {
    count:      { type: 'number', default: 14 },
    radius:     { type: 'number', default: 0.42 },  // reef volume, horizontal
    minHeight:  { type: 'number', default: 0.05 },
    maxHeight:  { type: 'number', default: 0.34 },
    length:     { type: 'number', default: 0.075 }, // body length
    speed:      { type: 'number', default: 0.16 },  // cruising, units/sec
    perception: { type: 'number', default: 0.16 },  // neighbour radius
    personal:   { type: 'number', default: 0.055 }, // separation radius
    coral:      { type: 'number', default: 0.13 },  // keep-out cylinder
    palette:    { type: 'string', default: '#FFB35C,#6FE3D0,#FF8FA8,#FFE066,#8FB8FF' }
  },

  init: function () {
    const d = this.data;
    const hues = d.palette.split(',').map((s) => s.trim());

    this.root  = new THREE.Group();
    this.boids = [];
    this.scatter = 0;

    for (let i = 0; i < d.count; i++) {
      // Size varies a little so the school doesn't look stamped.
      const L = d.length * (0.75 + Math.random() * 0.5);
      const fish = buildFish(L, hues[i % hues.length]);

      const angle = Math.random() * Math.PI * 2;
      const dist  = d.coral + Math.random() * (d.radius - d.coral);

      fish.position = new THREE.Vector3(
        Math.cos(angle) * dist,
        d.minHeight + Math.random() * (d.maxHeight - d.minHeight),
        Math.sin(angle) * dist
      );

      // Launch roughly tangentially, so the school starts with a
      // shared sense of direction rather than exploding outward.
      fish.velocity = new THREE.Vector3(
        -Math.sin(angle), (Math.random() - 0.5) * 0.2, Math.cos(angle)
      ).normalize().multiplyScalar(d.speed);

      fish.cruise = d.speed * (0.85 + Math.random() * 0.3);
      fish.beat   = Math.random() * Math.PI * 2;
      fish.wander = Math.random() * Math.PI * 2;

      fish.group.position.copy(fish.position);
      this.root.add(fish.group);
      this.boids.push(fish);
    }

    this.el.setObject3D('school', this.root);

    // Scratch vectors, reused every frame. Allocating inside tick
    // would hand the garbage collector 14 × 6 vectors per frame and
    // show up as stutter on a mid-range phone.
    this._sep = new THREE.Vector3();
    this._ali = new THREE.Vector3();
    this._coh = new THREE.Vector3();
    this._acc = new THREE.Vector3();
    this._tmp = new THREE.Vector3();
  },

  tick: function (time, delta) {
    if (!this.boids.length) return;

    const d  = this.data;
    const dt = Math.min(delta, 50) / 1000;   // clamp: a stalled frame must not teleport the school
    const s  = this.scatter;

    // Bleaching drives the school apart: personal space grows, the
    // urge to stay together fades, and everything speeds up.
    const wSep = 0.9  + s * 3.2;
    const wAli = 0.55 * (1 - s * 0.8);
    const wCoh = 0.42 * (1 - s * 0.9);
    const personal = d.personal * (1 + s * 1.8);

    for (let i = 0; i < this.boids.length; i++) {
      const b = this.boids[i];

      this._sep.set(0, 0, 0);
      this._ali.set(0, 0, 0);
      this._coh.set(0, 0, 0);
      let near = 0;
      let crowd = 0;

      for (let j = 0; j < this.boids.length; j++) {
        if (i === j) continue;
        const o = this.boids[j];

        this._tmp.subVectors(b.position, o.position);
        const dist = this._tmp.length();
        if (dist === 0 || dist > d.perception) continue;

        // Alignment and cohesion use every neighbour in range.
        this._ali.add(o.velocity);
        this._coh.add(o.position);
        near++;

        // Separation only kicks in inside personal space, and falls
        // off with the square of distance so contact is urgent and
        // distance is ignored.
        if (dist < personal) {
          this._sep.addScaledVector(this._tmp.normalize(), 1 / (dist * dist));
          crowd++;
        }
      }

      this._acc.set(0, 0, 0);

      if (crowd > 0) {
        this._sep.divideScalar(crowd);
        this._acc.addScaledVector(this._sep, wSep * 0.02);
      }

      if (near > 0) {
        this._ali.divideScalar(near).sub(b.velocity);
        this._acc.addScaledVector(this._ali, wAli);

        this._coh.divideScalar(near).sub(b.position);
        this._acc.addScaledVector(this._coh, wCoh);
      }

      /* --- wander ---
         Separation, alignment and cohesion alone reach equilibrium:
         the school settles into a fixed ring and stops looking alive.
         A slow random walk on each fish's heading keeps the system
         permanently unsettled, which is what real schools do. */
      b.wander += (Math.random() - 0.5) * dt * 7;
      this._acc.x += Math.cos(b.wander) * 0.40;
      this._acc.z += Math.sin(b.wander) * 0.40;
      this._acc.y += Math.sin(b.wander * 1.7) * 0.15;

      /* --- stay inside the reef volume --- */
      const hx = b.position.x;
      const hz = b.position.z;
      const horiz = Math.sqrt(hx * hx + hz * hz);

      // Start pulling back before the edge, quadratically, so the
      // boundary feels like water pressure rather than a wall. A
      // hard edge makes every fish pile up on the same circle.
      const soft = d.radius * 0.7;
      if (horiz > soft) {
        const over = (horiz - soft) / (d.radius - soft);
        const strength = 0.3 + over * over * 2.6;
        this._acc.x -= (hx / horiz) * strength;
        this._acc.z -= (hz / horiz) * strength;
      }

      const band = d.maxHeight - d.minHeight;
      const lowY  = d.minHeight + band * 0.25;
      const highY = d.maxHeight - band * 0.25;
      if (b.position.y < lowY)  this._acc.y += (lowY - b.position.y) * 7;
      if (b.position.y > highY) this._acc.y -= (b.position.y - highY) * 7;

      /* --- don't swim through the coral --- */
      // A vertical cylinder around the model. Fish approaching it are
      // pushed sideways, which is what produces the split-and-rejoin.
      if (horiz < d.coral && horiz > 0.0001) {
        const push = (d.coral - horiz) / d.coral;
        this._acc.x += (hx / horiz) * push * 2.6;
        this._acc.z += (hz / horiz) * push * 2.6;
      }

      /* --- integrate --- */
      b.velocity.addScaledVector(this._acc, dt);

      const target = b.cruise * (1 + s * 1.6);
      const speed  = b.velocity.length();
      if (speed > 0.0001) {
        // Ease toward cruising speed rather than clamping, so
        // acceleration reads as effort.
        b.velocity.multiplyScalar(1 + (target / speed - 1) * Math.min(1, dt * 3));
      } else {
        b.velocity.set(target, 0, 0);
      }

      b.position.addScaledVector(b.velocity, dt);

      // Hard floor. During a scatter the steering forces lose to
      // panic speed, and a fish sinking through the printed card
      // breaks the illusion instantly.
      if (b.position.y < d.minHeight) {
        b.position.y = d.minHeight;
        if (b.velocity.y < 0) b.velocity.y *= -0.4;
      }

      b.group.position.copy(b.position);

      /* --- orientation --- */
      const v = b.velocity;
      const vLen = v.length() || 0.0001;
      const yaw = Math.atan2(-v.z, v.x);

      // Shortest-path turn, so crossing ±π doesn't spin the fish.
      let dy = yaw - b.group.rotation.y;
      while (dy >  Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      b.group.rotation.y += dy * Math.min(1, dt * 8);

      b.group.rotation.z = Math.asin(Math.max(-1, Math.min(1, v.y / vLen))) * 0.8;

      // Bank into the turn: lean proportional to how hard it's turning.
      const bank = Math.max(-0.7, Math.min(0.7, -dy * 6));
      b.group.rotation.x += (bank - b.group.rotation.x) * Math.min(1, dt * 6);

      /* --- tail beat, tied to actual speed --- */
      const rate = 12 + (vLen / d.speed) * 8;
      b.beat += dt * rate;
      if (b.tail) b.tail.rotation.y = Math.sin(b.beat) * (0.35 + s * 0.3);
      b.pecs.forEach((p) => {
        p.mesh.rotation.z = -0.25 + p.side * Math.sin(b.beat * 0.6) * 0.18;
      });
    }
  },

  /* Called as the reef bleaches: 0 = healthy school, 1 = fled. */
  setScatter: function (v) {
    this.scatter = Math.min(1, Math.max(0, v));

    // The school doesn't just disperse, it empties out.
    const fade = Math.max(0, 1 - this.scatter * 1.15);
    this.boids.forEach((b, i) => {
      // Stagger it so they leave a few at a time.
      const own = Math.max(0, Math.min(1, fade * 1.4 - (i / this.boids.length) * 0.4));
      b.materials[0].opacity = own;
      b.materials[1].opacity = own * 0.72;
      b.group.visible = own > 0.02;
    });
  },

  remove: function () {
    this.el.removeObject3D('school');
  }
});
