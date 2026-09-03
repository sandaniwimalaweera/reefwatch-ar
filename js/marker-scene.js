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
});
