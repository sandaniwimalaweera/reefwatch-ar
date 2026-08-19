/* ============================================================
   ReefWatch AR — marker scene
   Image tracking with MindAR. Tap the coral to bleach it.
   ============================================================ */

/* ------------------------------------------------------------
   bleachable
   Walks every mesh in the model once it loads, clones each
   material so we never mutate a shared one, and stores the
   original colour. Setting the `amount` property (0 to 1)
   blends that colour toward bleached bone white.

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

        const list = Array.isArray(node.material) ? node.material : [node.material];

        node.material = list.map((mat) => {
          const clone = mat.clone();
          this.materials.push({
            mat: clone,
            base: clone.color ? clone.color.clone() : new THREE.Color('#ffffff'),
            baseRough: clone.roughness !== undefined ? clone.roughness : 0.6
          });
          return clone;
        });

        if (!Array.isArray(list) || list.length === 1) {
          node.material = node.material[0];
        }
      });

      this.apply();
      this.el.emit('bleach-ready');
    });
  },

  update: function () {
    this.apply();
  },

  apply: function () {
    const t = Math.min(1, Math.max(0, this.data.amount));

    this.materials.forEach(({ mat, base, baseRough }) => {
      if (mat.color) {
        mat.color.copy(base).lerp(this.bone, t);
      }
      // Dead skeleton is chalkier than living tissue.
      if (mat.roughness !== undefined) {
        mat.roughness = baseRough + (0.95 - baseRough) * t;
      }
      if (mat.metalness !== undefined) {
        mat.metalness = mat.metalness * (1 - t);
      }
      mat.needsUpdate = true;
    });
  }
});

/* ------------------------------------------------------------
   tap-to-bleach
   One tap runs the coral from healthy to bleached over a few
   seconds. Tap again to bring it back.
   ------------------------------------------------------------ */
AFRAME.registerComponent('tap-to-bleach', {
  schema: {
    duration: { type: 'number', default: 3200 }
  },

  init: function () {
    this.running = false;
    this.bleached = false;
    this.elapsed = 0;

    this.onTap = this.onTap.bind(this);
    this.el.addEventListener('click', this.onTap);

    // MindAR sits under a canvas that swallows some events on
    // certain Android builds, so listen on the document too.
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
    this.to = this.bleached ? 0 : 1;
    this.bleached = !this.bleached;

    this.el.sceneEl.emit('reef-state-change', { bleaching: this.to === 1 });
  },

  tick: function (time, delta) {
    if (!this.running) return;

    this.elapsed += delta;
    const t = Math.min(1, this.elapsed / this.data.duration);

    // Ease out. Colour drains fast at first, then lingers.
    const eased = 1 - Math.pow(1 - t, 2.4);
    const value = this.from + (this.to - this.from) * eased;

    this.el.setAttribute('bleachable', 'amount', value);
    this.el.sceneEl.emit('reef-bleach-progress', { amount: value });

    if (t >= 1) this.running = false;
  },

  remove: function () {
    this.el.removeEventListener('click', this.onTap);
    document.removeEventListener('click', this.onScreenTap);
  }
});

/* ------------------------------------------------------------
   fish-body
   Small procedural fish, built from primitives. Avoids a third
   model download and keeps the page light.
   ------------------------------------------------------------ */
AFRAME.registerComponent('fish-body', {
  schema: {
    hue: { type: 'color', default: '#FFB35C' }
  },

  init: function () {
    const colour = this.data.hue;

    const body = document.createElement('a-sphere');
    body.setAttribute('radius', 0.035);
    body.setAttribute('scale', '1.7 0.85 0.7');
    body.setAttribute('material', `color: ${colour}; metalness: 0.1; roughness: 0.45`);
    this.el.appendChild(body);

    const tail = document.createElement('a-cone');
    tail.setAttribute('radius-bottom', 0.03);
    tail.setAttribute('radius-top', 0.001);
    tail.setAttribute('height', 0.045);
    tail.setAttribute('position', '-0.058 0 0');
    tail.setAttribute('rotation', '0 0 90');
    tail.setAttribute('material', `color: ${colour}; opacity: 0.85; transparent: true`);
    tail.setAttribute('animation', 'property: rotation; from: 0 -18 90; to: 0 18 90; dir: alternate; loop: true; dur: 320; easing: easeInOutSine');
    this.el.appendChild(tail);

    // Gentle bob so the school does not look rigid.
    this.el.setAttribute('animation__bob',
      'property: position; dir: alternate; loop: true; dur: 2100; easing: easeInOutSine; to: ' +
      this.el.getAttribute('position').x + ' ' +
      (this.el.getAttribute('position').y + 0.05) + ' ' +
      this.el.getAttribute('position').z
    );

    this.el.setAttribute('rotation', '0 -90 0');
  }
});

/* ------------------------------------------------------------
   flee-on-bleach
   Fish leave when the coral dies, and drift back when it
   recovers. Added to the school container from the code below.
   ------------------------------------------------------------ */
AFRAME.registerComponent('flee-on-bleach', {
  init: function () {
    const school = this.el;

    this.el.sceneEl.addEventListener('reef-bleach-progress', (ev) => {
      const t = ev.detail.amount;
      // Fish scatter outward and fade as bleaching advances.
      school.object3D.scale.setScalar(1 + t * 1.6);

      school.object3D.traverse((node) => {
        if (node.material && node.material.transparent !== undefined) {
          node.material.transparent = true;
          node.material.opacity = Math.max(0, 1 - t * 1.15);
        }
      });
    });
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
  const school    = document.getElementById('school');
  const scene     = document.querySelector('a-scene');

  school.setAttribute('flee-on-bleach', '');

  let hintShown = false;

  target.addEventListener('targetFound', () => {
    prompt.classList.add('is-hidden');
    card.hidden = false;
    requestAnimationFrame(() => card.classList.add('is-visible'));

    if (!hintShown) {
      hintShown = true;
      hint.hidden = false;
      requestAnimationFrame(() => hint.classList.add('is-visible'));
      setTimeout(() => hint.classList.remove('is-visible'), 4200);
    }
  });

  target.addEventListener('targetLost', () => {
    prompt.classList.remove('is-hidden');
    card.classList.remove('is-visible');
  });

  scene.addEventListener('reef-state-change', (ev) => {
    if (ev.detail.bleaching) {
      cardState.textContent = 'Bleaching';
      cardState.classList.add('is-warning');
      cardCopy.textContent =
        'Heat stress forces the coral to expel its algae. The white is the bare skeleton showing through.';
    } else {
      cardState.textContent = 'Recovering';
      cardState.classList.remove('is-warning');
      cardCopy.textContent =
        'If the water cools quickly enough, algae return and colour comes back. Prolonged heat kills the coral outright.';
    }
    hint.classList.remove('is-visible');
  });

  // If the camera is blocked or the target file is missing, say so
  // rather than leaving the user staring at a black screen.
  setTimeout(() => {
    if (!document.querySelector('video')) {
      prompt.querySelector('.ar-prompt-title').textContent = 'Camera not available';
      prompt.querySelector('.ar-prompt-copy').textContent =
        'Allow camera access and reload. The page must be opened over https.';
      prompt.classList.add('is-error');
    }
  }, 6000);
});
