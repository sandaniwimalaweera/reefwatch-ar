/* ReefWatch AR — marker scene
   Image tracking with MindAR. Tap the coral to bleach it.
   Shared components live in js/lib-reef.js. */

/* One tap runs healthy → bleached. Tap again to recover. */
AFRAME.registerComponent('tap-to-bleach', {
  schema: {
    duration: { type: 'number', default: 3400 }
  },

  init: function () {
    this.running = false;
    this.bleached = false;
    this.elapsed = 0;

    this.onTap = this.onTap.bind(this);
    this.el.addEventListener('click', this.onTap);

    // The MindAR canvas swallows some pointer events on certain
    // Android builds, so listen at document level too.
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

    // Ease out — colour drains fast, then the last of it lingers.
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
      setTimeout(() => hint.classList.remove('is-visible'), 4500);
    }
  });

  target.addEventListener('targetLost', () => {
    prompt.classList.remove('is-hidden');
    card.classList.remove('is-visible');
  });

  // Fish react to bleaching — they scatter and fade as it advances.
  scene.addEventListener('reef-bleach-progress', (ev) => {
        document.querySelectorAll('[reef-school]').forEach((el) => {
      const comp = el.components['reef-school'];
      if (comp && comp.setScatter) comp.setScatter(ev.detail.amount);
    });
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

  // If the camera never starts, say why rather than leaving a black screen.
  setTimeout(() => {
    if (!document.querySelector('video')) {
      prompt.querySelector('.ar-prompt-title').textContent = 'Camera not available';
      prompt.querySelector('.ar-prompt-copy').textContent =
        'Allow camera access and reload. The page must be opened over https.';
      prompt.classList.add('is-error');
    }
  }, 6000);

  /* Sizing diagnostics.

     The coral comes out several times larger on some Android phones
     than on iPhone, and neither the cause nor the effect is visible
     from a desktop browser. There are only two places the size can
     come from, and they need opposite fixes, so the readout below
     separates them:

       fit    — what fit-model measured off the .glb, and the scale
                it chose from it. The measurement is taken from local
                matrices only, so the same file must produce the same
                number on every device. If these differ across two
                phones, the bug is in fit-model.

       world  — the scale that actually reaches the screen. This
                carries fit-model's scale multiplied by whatever
                MindAR wrote into the target's matrix. If `fit`
                matches across two phones and `world` does not, the
                difference is in the tracker's pose estimate and no
                change to fit-model will fix it.

     ?size=N overrides the fitted size on the device, so a value can
     be found by hand without a redeploy between each attempt. */

  const params = new URLSearchParams(location.search);
  const coral  = document.getElementById('coral');

  if (params.has('size')) {
    const s = parseFloat(params.get('size'));
    if (s > 0.01 && s < 5) {
      coral.setAttribute('fit-model', 'size', s);

      /* fit-model has no update handler — it fits once per model
         load — so changing the size after init does nothing on its
         own. Clearing the high-water mark and re-running the fit
         applies it. Safe to repeat: measure() ignores the entity's
         own transform, so re-fitting is idempotent rather than
         compounding the previous fit. */
      const comp = coral.components['fit-model'];
      if (comp) {
        comp.largest = 0;
        comp.begin();
      }
    }
  }

  if (params.has('debug')) {
    const panel = document.createElement('pre');
    panel.className = 'sensor-debug';
    // Clear the BACK button, which sits in the same corner here.
    panel.style.top = 'calc(env(safe-area-inset-top, 0px) + 3.4rem)';
    document.body.appendChild(panel);

    // fit-model reports the measured span when it fits.
    let span = null;
    coral.addEventListener('fitted', (ev) => { span = ev.detail.span; });

    const coralScale  = new THREE.Vector3();
    const targetScale = new THREE.Vector3();

    const num = (v, d) => (v === null || v === undefined || isNaN(v))
      ? '--'
      : v.toFixed(d === undefined ? 3 : d);

    setInterval(() => {
      const comp    = coral.components['fit-model'];
      const size    = comp ? comp.data.size : null;
      const largest = comp ? comp.largest : 0;
      const factor  = largest ? size / largest : null;

      coral.object3D.getWorldScale(coralScale);
      target.object3D.getWorldScale(targetScale);

      const video  = document.querySelector('video');
      const canvas = scene.canvas;
      const rows   = [];

      rows.push('size      ' + num(size) + (params.has('size') ? '  (override)' : ''));
      rows.push('largest   ' + num(largest, 4));
      rows.push('factor    ' + num(factor, 4));
      rows.push('span      ' + (span
        ? num(span.x, 2) + ' ' + num(span.y, 2) + ' ' + num(span.z, 2)
        : '--'));
      rows.push('local     ' + num(coral.object3D.scale.x, 4));
      rows.push('world     ' + num(coralScale.x, 4));
      rows.push('target    ' + num(targetScale.x, 4));
      rows.push('tracking  ' + (target.object3D.visible ? 'found' : 'lost'));
      rows.push('video     ' + (video && video.videoWidth
        ? video.videoWidth + 'x' + video.videoHeight
        : '--'));
      rows.push('canvas    ' + (canvas
        ? canvas.clientWidth + 'x' + canvas.clientHeight
        : '--'));
      rows.push('dpr       ' + (window.devicePixelRatio || 1));

      panel.textContent = rows.join('\n');
    }, 200);
  }
});
