/* ============================================================
   ReefWatch AR — modelled fish school

   `reef-school` in js/lib-reef.js builds its fish from lathed
   profiles and steers them with a boids simulation. That stays:
   it costs nothing to download, it reacts to the temperature by
   actually dispersing, and it is the fallback whenever this
   component cannot load.

   This one draws a photogrammetry-grade school instead —
   LasquetiSpice's "Animated Swimming Tropical Fish School Loop",
   CC BY 4.0 — which is a single skinned mesh with 148 joints and
   one 41-second baked swim cycle. Everything the fish do is in
   that clip, so there is no steering to run: the work here is
   loading it, sizing it into the reef volume, driving its mixer,
   and making it answer to the temperature like the rest of the
   scene does.

   Why one baked school rather than instanced fish: at 8,932
   triangles the whole choreography is one object. Cloning it per
   fish to drive with boids would multiply that by the school size
   — over 100k triangles for twelve fish — which a phone rendering
   an AR passthrough at the same time will not carry. The trade is
   that these fish cannot scatter on cue. They fade and leave
   instead, which is the same story told more quietly.

   The model is loaded by URL rather than through <a-assets> on
   purpose. An asset item pointing at a missing file blocks the
   scene until the loader times out; a URL that 404s here just
   emits `model-error`, the procedural school stays on screen, and
   nobody sees a failure.
   ============================================================ */

AFRAME.registerComponent('school-model', {
  schema: {
    src:   { type: 'string', default: '' },

    /* Longest edge of the swim volume, in metres. The clip moves the
       fish across roughly 41 units of model space, so this is what
       decides both how far they roam and how big each fish ends up —
       there is no separate fish size to set. */
    size:  { type: 'number', default: 1.6 },
    lift:  { type: 'number', default: 0.30 },   // height of the volume's floor

    clip:  { type: 'string', default: '' },     // empty = first clip in the file
    speed: { type: 'number', default: 1.0 },    // playback rate
    spin:  { type: 'number', default: 0.015 },  // slow orbit, rad/s

    /* The procedural school this replaces. Hidden once the model is
       on screen, so the two are never drawn at the same time. */
    replaces: { type: 'selector' }
  },

  init: function () {
    this.mixer = null;
    this.action = null;
    this.materials = [];
    this.scatter = 0;
    this.ready = false;

    if (!this.data.src) return;

    const inner = document.createElement('a-entity');
    inner.setAttribute('gltf-model', 'url(' + this.data.src + ')');
    this.inner = inner;
    this.el.appendChild(inner);

    inner.addEventListener('model-loaded', (ev) => this.onLoaded(ev.detail.model));
    inner.addEventListener('model-error', () => {
      // Deliberately quiet on screen: the procedural school is still
      // running, so the scene is not broken, only less detailed.
      console.warn('[school-model] could not load ' + this.data.src +
                   ' — keeping the procedural school');
      this.el.emit('school-model-failed');
    });

    /* The two scenes name the same idea differently: the markerless
       page emits `temperature-change` carrying `bleach`, the marker
       page emits `reef-bleach-progress` carrying `amount`. Listening
       for both keeps this component usable in either without the
       pages having to agree first. */
    this.onTemperature = (ev) => {
      const d = ev.detail || {};
      const v = (d.bleach !== undefined) ? d.bleach : d.amount;
      if (v !== undefined) this.setScatter(v);
    };
    this.el.sceneEl.addEventListener('temperature-change', this.onTemperature);
    this.el.sceneEl.addEventListener('reef-bleach-progress', this.onTemperature);
  },

  remove: function () {
    if (this.onTemperature) {
      this.el.sceneEl.removeEventListener('temperature-change', this.onTemperature);
      this.el.sceneEl.removeEventListener('reef-bleach-progress', this.onTemperature);
    }
    if (this.action) this.action.stop();
    this.mixer = null;
  },

  onLoaded: function (model) {
    this.fit(model);

    /* Materials are shared between the four meshes and would be
       shared with any second instance of this model too, so they are
       cloned before anything writes opacity to them. Transparency is
       switched on up front: turning it on later forces a shader
       recompile, which stutters at exactly the wrong moment. */
    model.traverse((node) => {
      if (!node.isMesh && !node.isSkinnedMesh) return;

      const list = Array.isArray(node.material) ? node.material : [node.material];
      const cloned = list.map((mat) => {
        const c = mat.clone();
        c.transparent = true;
        c.opacity = 1;
        this.materials.push(c);
        return c;
      });
      node.material = Array.isArray(node.material) ? cloned : cloned[0];

      /* The clip swims these fish far outside their bind-pose bounds,
         which is what three's frustum test measures. Left on, fish
         blink out while still plainly on screen. */
      node.frustumCulled = false;
    });

    const clips = model.animations || [];
    if (clips.length) {
      const clip = this.data.clip
        ? THREE.AnimationClip.findByName(clips, this.data.clip) || clips[0]
        : clips[0];

      this.mixer = new THREE.AnimationMixer(model);
      this.action = this.mixer.clipAction(clip);
      this.action.setLoop(THREE.LoopRepeat, Infinity);
      this.action.setEffectiveTimeScale(this.data.speed);
      this.action.play();
    } else {
      console.warn('[school-model] no animation clip in ' + this.data.src);
    }

    if (this.data.replaces) this.data.replaces.setAttribute('visible', false);

    this.ready = true;
    this.el.emit('school-model-ready', {
      clips: clips.map((c) => c.name),
      duration: clips.length ? clips[0].duration : 0
    });
  },

  /* Same rule as `fit-model`: longest edge to a known size, centred
     horizontally, floor of the volume at `lift`. Measured from the
     bind pose, which is the only pose available before the mixer has
     run — the clip then swims the fish around inside it. */
  fit: function (model) {
    const box = new THREE.Box3().setFromObject(model);
    const span = new THREE.Vector3();
    const centre = new THREE.Vector3();
    box.getSize(span);
    box.getCenter(centre);

    const largest = Math.max(span.x, span.y, span.z);
    if (!largest || !isFinite(largest)) {
      console.warn('[school-model] bounding box not ready', span);
      return;
    }

    const factor = this.data.size / largest;
    model.scale.setScalar(factor);
    model.position.set(
      -centre.x * factor,
      -box.min.y * factor + this.data.lift,
      -centre.z * factor
    );
  },

  tick: function (time, delta) {
    if (!this.ready) return;

    // Clamped, like the boids: a stalled frame must not jump the clip
    // half a second forward.
    const dt = Math.min(delta, 50) / 1000;

    if (this.mixer) this.mixer.update(dt);
    if (this.data.spin) this.el.object3D.rotation.y += this.data.spin * dt;
  },

  /* Called with the bleaching amount, 0 → 1.

     The boids version scatters the school outward. A baked clip
     cannot be steered, so this says the same thing differently: the
     fish quicken, then thin out and go. Reaching zero at 0.85 rather
     than 1.0 means an empty reef arrives slightly before the coral is
     fully white, which is the order it happens in. */
  setScatter: function (v) {
    this.scatter = Math.min(1, Math.max(0, v));

    if (this.action) this.action.setEffectiveTimeScale(this.data.speed * (1 + this.scatter * 0.8));

    const fade = Math.max(0, 1 - this.scatter / 0.85);
    this.materials.forEach((m) => { m.opacity = fade; });
    if (this.inner) this.inner.object3D.visible = fade > 0.02;
  }
});
