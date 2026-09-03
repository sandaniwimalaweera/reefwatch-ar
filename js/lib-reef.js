/* ReefWatch AR — shared scene library

   Components used by both the marker scene and the markerless
   scene. Loaded before either page's own script. */

/* Source models come in wildly different units — one Sketchfab
   export may be 0.2 units across, another 400. Hard-coding a
   scale means re-tuning every time the model changes.

   This measures the loaded model and scales it so its largest
   dimension equals `size` in the parent's units, then drops it
   so its base sits on the surface below it.

   Two rules keep that measurement honest, both learned from the
   marker scene sizing its coral differently on iOS and Android:

   1. Measure from local matrices only, never world ones. A world
      measurement is taken through whatever the image tracker had
      written into the target's matrix that instant, so the answer
      depended on when the model happened to finish loading.

   2. Keep measuring for a moment, and re-fit whenever the model
      turns out to be bigger than it first looked. A model whose
      geometry is still arriving measures small, and a first-and-
      final fit locks that in as a model several times too large. */
AFRAME.registerComponent('fit-model', {
  schema: {
    size:   { type: 'number', default: 0.22 },
    lift:   { type: 'number', default: 0.0 },
    settle: { type: 'number', default: 1500 }   // ms to keep re-measuring
  },

  init: function () {
    this.largest = 0;
    this.until = 0;
    this.polling = false;

    this.box = new THREE.Box3();
    this.nodeBox = new THREE.Box3();
    this.local = new THREE.Matrix4();
    this.span = new THREE.Vector3();
    this.centre = new THREE.Vector3();

    // The model may already be attached by the time this component
    // initialises — a-asset-item preloading makes that race real —
    // so check for it as well as listening for the event.
    this.el.addEventListener('model-loaded', () => this.begin());
    if (this.el.getObject3D('mesh')) this.begin();
  },

  begin: function () {
    this.until = performance.now() + this.data.settle;
    if (this.polling) return;
    this.polling = true;
    this.attempt();
  },

  attempt: function () {
    this.fit();
    if (performance.now() < this.until) {
      setTimeout(() => this.attempt(), 100);
    } else {
      this.polling = false;
      if (!this.largest) console.warn('[fit-model] never measured a model', this.el);
    }
  },

  /* Bounding box of the model in this entity's own frame.

     Built by walking each mesh's own matrix up to — but not
     including — this entity, so the result ignores the entity's
     transform and everything above it. That makes the number the
     same on every device, and makes re-fitting idempotent rather
     than compounding the last fit. */
  measure: function () {
    const root = this.el.getObject3D('mesh');
    const box = this.box.makeEmpty();
    if (!root) return box;

    const stop = this.el.object3D;

    root.traverse((node) => {
      if (!node.isMesh || !node.geometry) return;

      if (!node.geometry.boundingBox) node.geometry.computeBoundingBox();
      const local = node.geometry.boundingBox;
      if (!local) return;

      this.local.identity();
      for (let n = node; n && n !== stop; n = n.parent) {
        n.updateMatrix();
        this.local.premultiply(n.matrix);
      }

      box.union(this.nodeBox.copy(local).applyMatrix4(this.local));
    });

    return box;
  },

  fit: function () {
    const box = this.measure();
    if (box.isEmpty()) return;

    box.getSize(this.span);
    const largest = Math.max(this.span.x, this.span.y, this.span.z);
    if (!largest || !isFinite(largest)) return;

    // Only ever grow. A later measurement that comes back smaller
    // is a partially loaded model, not a smaller one.
    if (largest <= this.largest + 1e-6) return;
    this.largest = largest;

    const obj = this.el.object3D;
    const factor = this.data.size / largest;
    obj.scale.setScalar(factor);

    // Centre horizontally, then sit the base on the surface.
    box.getCenter(this.centre);
    obj.position.x = -this.centre.x * factor;
    obj.position.z = -this.centre.z * factor;
    obj.position.y = -box.min.y * factor + this.data.lift;

    this.done = true;
    this.el.emit('fitted', { factor: factor, span: this.span.clone() });
  }
});

/* Clones every material so we never mutate a shared one, stores
   the original colour, then blends toward bone white as
   `amount` runs 0 → 1.

   This is why no second white model is needed. */
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

/* A proper fish rather than a sphere on a stick.

   Body is a lathe — a profile curve revolved around the long
   axis — which gives the tapered fusiform shape real fish have.
   Flattening it laterally makes it read as a fish from the side.
   Fins are thin cones and triangles. Tail beat, banking and
   pitch are driven per-frame in tick(). */
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

    const dorsalShape = new THREE.Shape();
    dorsalShape.moveTo(L * 0.18, 0);
    dorsalShape.lineTo(-L * 0.01, L * 0.26);
    dorsalShape.lineTo(-L * 0.24, 0);
    const dorsal = new THREE.Mesh(new THREE.ShapeGeometry(dorsalShape), finSkin);
    dorsal.position.y = L * 0.08;
    group.add(dorsal);

    const analShape = new THREE.Shape();
    analShape.moveTo(-L * 0.06, 0);
    analShape.lineTo(-L * 0.16, -L * 0.13);
    analShape.lineTo(-L * 0.26, 0);
    const anal = new THREE.Mesh(new THREE.ShapeGeometry(analShape), finSkin);
    anal.position.y = -L * 0.07;
    group.add(anal);

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

    const eyeGeo   = new THREE.SphereGeometry(L * 0.055, 10, 10);
    const eyeMat   = new THREE.MeshStandardMaterial({ color: 0x101c26, roughness: 0.15, metalness: 0.0 });
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

/* Slow drifting particulate. Sells "underwater" more cheaply
   than any amount of extra geometry. */
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

/* Sunlight breaking on the surface, projected down onto the
   scene. A slowly animated pattern on a spotlight is enough to
   suggest water above without rendering any. */
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

/* A soft dark ellipse on the ground beneath an object. Real
   shadow mapping cannot help here — there is no virtual light
   matching the room's actual lighting — but the eye reads any
   dark patch under an object as contact. Without it, placed
   models appear to hover.

   The gradient is drawn once into a canvas and used as an alpha
   map, so it costs one texture and two triangles. */
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

/* The mesh construction from reef-fish, pulled out so the school
   can stamp out many bodies without duplicating the geometry code.
   Returns the group plus the parts that need animating. */
function buildFish (L, hue) {
  const group = new THREE.Group();

  /* metalness stays at zero deliberately.

     A metallic surface in a physically based renderer takes its
     colour from what it reflects, and this scene has no environment
     map to reflect — the background is a live camera feed, which the
     renderer knows nothing about. Any metalness above zero therefore
     mixes in black rather than a reflection, and the fish come out
     darker and duller than the palette says they are. The corals are
     exported at metallicFactor 0 for the same reason.

     Gloss comes from low roughness instead, which needs no
     environment: it sharpens the highlight from the lights that are
     actually in the scene. */
  const skin = new THREE.MeshStandardMaterial({
    color: new THREE.Color(hue),
    roughness: 0.34,
    metalness: 0.0,

    /* Opaque until something fades it. setScatter turns blending on
       only while a fish is actually fading out; see the note there. */
    transparent: false,
    opacity: 1
  });

  // Fins are thin membranes, so these stay genuinely translucent.
  const finSkin = new THREE.MeshStandardMaterial({
    color: new THREE.Color(hue),
    roughness: 0.5,
    metalness: 0.0,
    transparent: true,
    opacity: 0.72,
    side: THREE.DoubleSide
  });

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

  const dorsalShape = new THREE.Shape();
  dorsalShape.moveTo(L * 0.18, 0);
  dorsalShape.lineTo(-L * 0.01, L * 0.26);
  dorsalShape.lineTo(-L * 0.24, 0);
  const dorsal = new THREE.Mesh(new THREE.ShapeGeometry(dorsalShape), finSkin);
  dorsal.position.y = L * 0.08;
  group.add(dorsal);

  const analShape = new THREE.Shape();
  analShape.moveTo(-L * 0.06, 0);
  analShape.lineTo(-L * 0.16, -L * 0.13);
  analShape.lineTo(-L * 0.26, 0);
  const anal = new THREE.Mesh(new THREE.ShapeGeometry(analShape), finSkin);
  anal.position.y = -L * 0.07;
  group.add(anal);

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

  const eyeGeo   = new THREE.SphereGeometry(L * 0.055, 10, 10);
  const eyeMat   = new THREE.MeshStandardMaterial({ color: 0x101c26, roughness: 0.15, metalness: 0.0 });
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

/* Clone a rigged model so each copy gets its own skeleton.

   THREE.Object3D.clone() copies the meshes but leaves every clone
   pointing at the original's skeleton, so a school of twelve fish
   would deform as one: the same bones, the same pose, twelve times.
   The fix is to clone the skeleton too and re-point its bone array
   at the cloned bones, which is what three.js ships as
   SkeletonUtils.clone in its examples.

   A-Frame 1.5.0 does not bundle those examples — THREE.SkeletonUtils
   is undefined — and pulling in a loose copy risks it being built
   against a different three.js than the one A-Frame carries. The
   algorithm is short and stable, so it is reproduced here instead.
   If a future A-Frame does ship it, applyModel prefers theirs. */
function cloneRigged (source) {
  const toSource = new Map();
  const toClone  = new Map();
  const copy = source.clone(true);

  // Walk both trees together. clone(true) preserves child order, so
  // the two traversals stay in step and each clone can be paired
  // with the node it came from.
  (function pair (a, b) {
    toSource.set(b, a);
    toClone.set(a, b);
    for (let i = 0; i < a.children.length; i++) {
      if (b.children[i]) pair(a.children[i], b.children[i]);
    }
  })(source, copy);

  copy.traverse((node) => {
    if (!node.isSkinnedMesh) return;

    const origin = toSource.get(node);
    if (!origin || !origin.skeleton) return;

    const skeleton = origin.skeleton.clone();
    // Re-point the cloned skeleton at this copy's own bones. Without
    // this the bones are still the original's and nothing changes.
    skeleton.bones = origin.skeleton.bones.map((bone) => toClone.get(bone) || bone);

    node.bindMatrix.copy(origin.bindMatrix);
    node.bind(skeleton, node.bindMatrix);
  });

  return copy;
}

/* Boids flocking (Reynolds, 1987). Each fish steers by three
   local rules — separation, alignment, cohesion — summed with
   two environmental forces: stay inside the reef volume, and
   don't swim through the coral.

   No path is authored anywhere. The schooling, the splitting
   around the coral and the re-forming afterwards are all
   emergent from those five weights.

   Neighbour search is brute force. At this count that is a few
   hundred distance checks per frame, which is cheaper on mobile
   than maintaining a spatial index. */
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
    palette:    { type: 'string', default: '#FFB35C,#6FE3D0,#FF8FA8,#FFE066,#8FB8FF' },

    /* Optional glTF fish: a comma-separated list of URLs, or `#id`
       of an <a-asset-item>. Left empty, every fish is built by
       buildFish from primitives, which is the default: it loads
       nothing, it costs a few hundred triangles a fish, and it is
       what the report describes.

       A list rather than one model because the procedural school
       cycles five colours from `palette`, so it already reads as a
       mixed reef. A single model would replace that with twelve
       identical fish, which looks worse than what it replaced.
       Species are dealt round-robin across the school, so three
       models give four of each in a school of twelve.

       Each is loaded after the school is already swimming and
       swapped in when it arrives, so a slow or failed download
       costs that species and nothing else — the fish still waiting
       on it keep their procedural bodies. */
    model:         { type: 'string',  default: '' },

    /* Degrees, applied to the model inside each fish. tick() steers
       by `Math.atan2(-v.z, v.x)`, so a fish's nose must point +X.
       Almost nothing is exported that way - a model facing -Z needs
       `modelRotation: 0 -90 0`. Wrong values are obvious on screen:
       the school swims sideways or backwards.

       One value applies to every model in the list. Models from a
       single pack face the same way, so this is usually right;
       mixing sources means rotating the odd one out before
       exporting it. */
    modelRotation: { type: 'vec3',    default: { x: 0, y: 0, z: 0 } },

    /* Play the model's own first animation clip, if it has one, in
       place of the procedural tail beat. */
    modelAnimate:  { type: 'boolean', default: true }
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

      // Kept so a model swapped in later can be sized to the same
      // body length this fish was built at.
      fish.L = L;

      /* Each material's own opacity, so the bleaching fade scales
         what the material already had rather than overwriting it.
         For the procedural fish that is 1 for the body and 0.72 for
         the fins; for a model it is whatever the artist exported. */
      fish.matFade = fish.materials.map((m) => m.opacity);
      fish.mixer = null;

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

    this.loadModel();
  },

  /* An `#id` refers to an <a-asset-item>, which is how both pages
     already preload their coral. Anything else is used as a URL. */
  resolveUrl: function (value) {
    if (!value) return null;
    if (value.charAt(0) !== '#') return value;

    const el = document.querySelector(value);
    if (!el) {
      console.warn('[reef-school] no asset matching', value);
      return null;
    }
    return el.getAttribute('src') || el.src || null;
  },

  loadModel: function () {
    const urls = this.data.model
      .split(',')
      .map((v) => this.resolveUrl(v.trim()))
      .filter(Boolean);

    if (!urls.length) return;

    if (!THREE.GLTFLoader) {
      console.warn('[reef-school] THREE.GLTFLoader unavailable, keeping procedural fish');
      return;
    }

    const loader = new THREE.GLTFLoader();

    /* Each species claims every Nth fish. Doing it by index rather
       than by load order keeps the mix stable whichever file wins
       the download race, and lets a species that fails to load
       leave its fish procedural instead of shifting the others. */
    urls.forEach((url, index) => {
      loader.load(
        url,
        (gltf) => { if (this.boids.length) this.applyModel(gltf, index, urls.length); },
        null,
        (err) => {
          // The procedural school is already swimming, so this is a
          // downgrade in looks and not a failure the user ever sees.
          console.warn('[reef-school] fish model failed to load:', url, err);
        }
      );
    });
  },

  /* Replace every fish's body with a clone of the loaded model,
     leaving its position, velocity and place in the flock alone.
     The boids simulation neither knows nor cares what is being
     drawn, which is the whole reason this swap is safe mid-flight. */
  applyModel: function (gltf, index, total) {
    const source = gltf.scene || (gltf.scenes && gltf.scenes[0]);
    if (!source) return;

    const slot  = index || 0;
    const every = total || 1;

    source.updateMatrixWorld(true);

    /* Measure once. The longest dimension of a fish is its body, so
       scaling that to L reproduces the size the procedural fish was
       built at and keeps the flocking distances meaningful - those
       are all in the same units as `length`. */
    const span = new THREE.Vector3();
    const centre = new THREE.Vector3();
    const box = new THREE.Box3().setFromObject(source);
    box.getSize(span);
    box.getCenter(centre);

    const longest = Math.max(span.x, span.y, span.z);
    if (!longest || !isFinite(longest)) {
      console.warn('[reef-school] fish model measured nothing, keeping procedural fish');
      return;
    }

    /* A rigged model must be cloned with SkeletonUtils: a plain
       clone copies the meshes but shares the skeleton, so every
       fish in the school deforms identically to the first one. */
    let rigged = false;
    source.traverse((n) => { if (n.isSkinnedMesh) rigged = true; });

    /* Prefer three's own implementation if a future A-Frame starts
       bundling it; fall back to the copy above, which is why a
       rigged model works here at all. */
    const utils = THREE.SkeletonUtils;
    const cloneRig = (utils && utils.clone) ? utils.clone : cloneRigged;
    const cloneOf = rigged ? (o) => cloneRig(o) : (o) => o.clone(true);

    const r = this.data.modelRotation;
    const clips = (this.data.modelAnimate && gltf.animations) || [];

    this.boids.forEach((b, i) => {
      if (i % every !== slot) return;   // another species' fish

      this.clearVisual(b);

      const model = cloneOf(source);

      /* Materials are shared across clones by default, so fading one
         fish would fade the whole school. Clone them per fish, and
         force `transparent` on - with it false, setting `opacity` is
         silently ignored and a fish would pop out of existence at
         the visibility cutoff instead of fading. */
      const materials = [];
      model.traverse((node) => {
        if (!node.isMesh && !node.isSkinnedMesh) return;
        if (!node.material) return;

        const many = Array.isArray(node.material);
        const list = many ? node.material : [node.material];

        const cloned = list.map((mat) => {
          const c = mat.clone();
          c.transparent = true;
          materials.push(c);
          return c;
        });

        node.material = many ? cloned : cloned[0];

        // The flock never stops moving, so per-fish culling costs
        // more than it saves.
        node.frustumCulled = false;
      });

      /* Centre the body on the fish's own origin, then turn and size
         it. Wrapping rather than editing the clone's own transform
         leaves whatever the exporter baked into the root intact. */
      const centred = new THREE.Group();
      centred.position.copy(centre).negate();
      centred.add(model);

      const holder = new THREE.Group();
      holder.rotation.set(
        THREE.MathUtils.degToRad(r.x),
        THREE.MathUtils.degToRad(r.y),
        THREE.MathUtils.degToRad(r.z));
      holder.scale.setScalar(b.L / longest);
      holder.add(centred);

      b.group.add(holder);

      b.materials = materials;
      b.matFade = materials.map((m) => m.opacity);
      b.tail = null;      // no pivot in the model we could name
      b.pecs = [];

      if (clips.length) {
        b.mixer = new THREE.AnimationMixer(model);
        const action = b.mixer.clipAction(clips[0]);
        // Offset each fish into the clip so the school does not beat
        // in unison, which reads as one animated object.
        action.time = Math.random() * clips[0].duration;
        action.play();
      }
    });

    // A swap part-way through a bleaching run must not reset the fade.
    this.setScatter(this.scatter);
  },

  /* Drop a fish's current body. The procedural geometries are built
     per fish so they are genuinely this fish's to free; a model's
     geometry is shared between clones, and disposing it repeatedly
     is harmless because the whole school goes at once. */
  clearVisual: function (b) {
    if (b.mixer) {
      b.mixer.stopAllAction();
      b.mixer = null;
    }

    while (b.group.children.length) {
      const child = b.group.children[0];
      b.group.remove(child);

      child.traverse((node) => {
        if (node.geometry) node.geometry.dispose();
        if (!node.material) return;
        const list = Array.isArray(node.material) ? node.material : [node.material];
        list.forEach((m) => m.dispose());
      });
    }
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

      /* wander
         Separation, alignment and cohesion alone reach equilibrium:
         the school settles into a fixed ring and stops looking alive.
         A slow random walk on each fish's heading keeps the system
         permanently unsettled, which is what real schools do. */
      b.wander += (Math.random() - 0.5) * dt * 7;
      this._acc.x += Math.cos(b.wander) * 0.40;
      this._acc.z += Math.sin(b.wander) * 0.40;
      this._acc.y += Math.sin(b.wander * 1.7) * 0.15;

      /* stay inside the reef volume */
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

      // A vertical cylinder around the model. Fish approaching it are
      // pushed sideways, which is what produces the split-and-rejoin.
      if (horiz < d.coral && horiz > 0.0001) {
        const push = (d.coral - horiz) / d.coral;
        this._acc.x += (hx / horiz) * push * 2.6;
        this._acc.z += (hz / horiz) * push * 2.6;
      }

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

      /* Tail beat, tied to actual speed. A model carrying its own
         swim clip drives that instead, run faster as the school
         scatters for the same reason the procedural beat is. A model
         without a clip simply glides, which still reads at this size. */
      if (b.mixer) {
        b.mixer.update(dt * (1 + s * 1.2));
      } else {
        const rate = 12 + (vLen / d.speed) * 8;
        b.beat += dt * rate;
        if (b.tail) b.tail.rotation.y = Math.sin(b.beat) * (0.35 + s * 0.3);
        b.pecs.forEach((p) => {
          p.mesh.rotation.z = -0.25 + p.side * Math.sin(b.beat * 0.6) * 0.18;
        });
      }
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

      /* Scale each material against its own starting opacity rather
         than assuming there are exactly two. A model may arrive with
         any number, and hard-coding [0] and [1] threw on a single-
         material fish. */
      b.materials.forEach((m, k) => {
        const base = (b.matFade && b.matFade[k] !== undefined) ? b.matFade[k] : 1;
        const value = own * base;
        m.opacity = value;

        /* Blend only while there is something to blend.

           A material left permanently transparent is pushed into the
           renderer's transparent queue for the life of the scene:
           re-sorted by depth every frame, unable to reject fragments
           early, and liable to draw in the wrong order against the
           coral and against other fish. At full opacity none of that
           buys anything, so the flag follows the fade. */
        const blend = value < 0.999;
        if (m.transparent !== blend) {
          m.transparent = blend;
          m.needsUpdate = true;
        }
      });

      b.group.visible = own > 0.02;
    });
  },

  remove: function () {
    this.boids.forEach((b) => this.clearVisual(b));
    this.boids.length = 0;
    this.el.removeObject3D('school');
  }
});
