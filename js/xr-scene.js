/* ============================================================
   ReefWatch AR — markerless scene

   WebXR hit-testing places a reef section on a real surface.
   Sea temperature then drives how bleached that reef appears.
   Shared components live in js/lib-reef.js.
   ============================================================ */

/* ------------------------------------------------------------
   Bleaching model

   A deliberate simplification for visualisation. Real bleaching
   depends on accumulated heat stress over weeks (Degree Heating
   Weeks), not a single instantaneous reading — this is stated in
   the report and in the app's own credits.

   Thresholds are anchored on the regional monthly maximum for
   Sri Lankan reefs, around 29 °C.
   ------------------------------------------------------------ */
const BLEACH = {
  safe:  29.0,   // below this: no visible stress
  fatal: 31.5,   // at or above this: fully bleached

  factor: function (celsius) {
    if (celsius === null || celsius === undefined || isNaN(celsius)) return 0;
    const t = (celsius - this.safe) / (this.fatal - this.safe);
    return Math.min(1, Math.max(0, t));
  },

  label: function (celsius) {
    if (celsius === null || isNaN(celsius)) return { text: 'No data', tone: 'idle' };
    if (celsius < 29.0) return { text: 'Healthy',  tone: 'good' };
    if (celsius < 30.0) return { text: 'Watch',    tone: 'good' };
    if (celsius < 31.0) return { text: 'Warning',  tone: 'warn' };
    return { text: 'Bleaching', tone: 'bad' };
  }
};

/* ------------------------------------------------------------
   reef-state
   Single source of truth for the current temperature. Anything
   that needs to react listens for the `temperature-change`
   event rather than reaching into this component.
   ------------------------------------------------------------ */
AFRAME.registerComponent('reef-state', {
  schema: {
    celsius: { type: 'number', default: 28.0 }
  },

  update: function () {
    const c = this.data.celsius;
    this.el.emit('temperature-change', {
      celsius: c,
      bleach: BLEACH.factor(c),
      label: BLEACH.label(c)
    }, false);
  }
});

/* ------------------------------------------------------------
   temperature-driven
   Puts this entity's `bleachable` amount under the control of
   the scene temperature.
   ------------------------------------------------------------ */
AFRAME.registerComponent('temperature-driven', {
  schema: {
    ease: { type: 'number', default: 2.2 }   // seconds to catch up
  },

  init: function () {
    this.current = 0;
    this.goal = 0;

    this.el.sceneEl.addEventListener('temperature-change', (ev) => {
      this.goal = ev.detail.bleach;
    });
  },

  tick: function (time, delta) {
    if (Math.abs(this.goal - this.current) < 0.001) return;

    // Exponential approach — fast at first, then settles. Avoids
    // the colour snapping when the slider is dragged quickly.
    const k = 1 - Math.exp(-(delta / 1000) / this.data.ease * 4);
    this.current += (this.goal - this.current) * k;
    this.el.setAttribute('bleachable', 'amount', this.current);
  }
});

/* ------------------------------------------------------------
   hit-test-placer

   Hit-testing implemented directly against the WebXR Device API
   rather than through A-Frame's ar-hit-test component, which
   throws during init on some builds when it reads the scene's
   webxr configuration before that component has attached.

   Working at this level also makes the pipeline explicit:
     viewer reference space
       → requestHitTestSource
       → per-frame getHitTestResults
       → pose in the local reference space
   ------------------------------------------------------------ */
AFRAME.registerComponent('hit-test-placer', {
  schema: {
    reticle: { type: 'selector' },
    target:  { type: 'selector' }
  },

  init: function () {
    this.source = null;
    this.hasHit = false;
    this.placed = false;
    this.matrix = new THREE.Matrix4();
    this.pos = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.scl = new THREE.Vector3();

    const sceneEl = this.el.sceneEl;

    sceneEl.addEventListener('enter-vr', () => {
      if (!sceneEl.is('ar-mode')) return;

      const session = sceneEl.renderer.xr.getSession();
      if (!session) return;
      this.session = session;

      session.requestReferenceSpace('viewer')
        .then((viewerSpace) => session.requestHitTestSource({ space: viewerSpace }))
        .then((source) => {
          this.source = source;
          this.el.emit('hit-test-ready');
        })
        .catch((err) => {
          this.el.emit('hit-test-failed', { message: err && err.message });
        });

      this.onSelect = () => this.place();
      session.addEventListener('select', this.onSelect);

      session.addEventListener('end', () => {
        if (this.source && this.source.cancel) this.source.cancel();
        this.source = null;
        this.hasHit = false;
        this.placed = false;
      });
    });
  },

  tick: function () {
    const sceneEl = this.el.sceneEl;
    const frame = sceneEl.frame;
    if (!frame || !this.source || this.placed) return;

    const refSpace = sceneEl.renderer.xr.getReferenceSpace();
    if (!refSpace) return;

    const results = frame.getHitTestResults(this.source);

    if (!results.length) {
      if (this.hasHit) {
        this.hasHit = false;
        if (this.data.reticle) this.data.reticle.setAttribute('visible', false);
        this.el.emit('hit-test-lost');
      }
      return;
    }

    const pose = results[0].getPose(refSpace);
    if (!pose) return;

    this.matrix.fromArray(pose.transform.matrix);
    this.matrix.decompose(this.pos, this.quat, this.scl);

    if (this.data.reticle) {
      this.data.reticle.object3D.position.copy(this.pos);
      this.data.reticle.object3D.quaternion.copy(this.quat);
      this.data.reticle.setAttribute('visible', true);
    }

    if (!this.hasHit) {
      this.hasHit = true;
      this.el.emit('hit-test-found');
    }
  },

  place: function () {
    if (!this.hasHit || !this.data.target) return;

    this.data.target.object3D.position.copy(this.pos);
    this.data.target.object3D.quaternion.copy(this.quat);
    this.data.target.setAttribute('visible', true);

    if (!this.placed) {
      this.placed = true;
      if (this.data.reticle) this.data.reticle.setAttribute('visible', false);
      this.el.emit('reef-placed');
    }
  },

  rearm: function () {
    this.placed = false;
    if (this.data.target) this.data.target.setAttribute('visible', false);
  }
});

/* ------------------------------------------------------------
   Scene wiring
   ------------------------------------------------------------ */
document.addEventListener('DOMContentLoaded', () => {
  const scene     = document.querySelector('a-scene');
  const reticle   = document.getElementById('reticle');
  const reef      = document.getElementById('reef');
  const gate      = document.getElementById('gate');
  const gateTitle = document.getElementById('gateTitle');
  const gateCopy  = document.getElementById('gateCopy');
  const startBtn  = document.getElementById('start');
  const scanMsg   = document.getElementById('scan');
  const hud       = document.getElementById('hud');
  const hudTemp   = document.getElementById('hudTemp');
  const hudState  = document.getElementById('hudState');
  const hudSite   = document.getElementById('hudSite');
  const slider    = document.getElementById('temp');
  const sliderVal = document.getElementById('tempVal');
  const resetBtn  = document.getElementById('reset');

  let placed = false;

  /* ---------- support check ---------- */
  const unsupported = (title, copy) => {
    gateTitle.textContent = title;
    gateCopy.textContent = copy;
    startBtn.hidden = true;
  };

  if (!navigator.xr) {
    unsupported(
      'Not supported on this browser',
      'Markerless AR needs WebXR. Open this page in Chrome on an ARCore-capable Android device. The marker mode works here.'
    );
  } else {
    navigator.xr.isSessionSupported('immersive-ar').then((ok) => {
      if (!ok) {
        unsupported(
          'Not supported on this device',
          'This device does not offer immersive AR sessions. iOS Safari does not implement WebXR hit-testing — use the marker mode instead.'
        );
      }
    }).catch(() => {
      unsupported('Could not check AR support', 'Try reloading, or use the marker mode.');
    });
  }

  /* ---------- enter AR ---------- */
  startBtn.addEventListener('click', () => {
    gate.classList.add('is-hidden');
    // enterAR exists in current A-Frame; enterVR(true) is the older path.
    if (typeof scene.enterAR === 'function') {
      scene.enterAR();
    } else {
      scene.enterVR(true);
    }
  });

  scene.addEventListener('enter-vr', () => {
    if (!scene.is('ar-mode')) {
      note('Session started but not in AR mode.');
      return;
    }
    gate.classList.add('is-hidden');
    scanMsg.hidden = false;
    requestAnimationFrame(() => scanMsg.classList.add('is-visible'));
  });

  // Surface failures on screen rather than leaving a black rectangle.
  const note = (msg) => {
    scanMsg.hidden = false;
    scanMsg.classList.add('is-visible');
    scanMsg.querySelector('.ar-scan-title').textContent = 'Something went wrong';
    scanMsg.querySelector('.ar-scan-copy').textContent = msg;
  };

  scene.addEventListener('enter-vr-error', () => note('The AR session could not start.'));
  window.addEventListener('error', (e) => {
    if (scene.is('ar-mode')) note(e.message || 'Unexpected error.');
  });

  scene.addEventListener('exit-vr', () => {
    gate.classList.remove('is-hidden');
    scanMsg.classList.remove('is-visible');
    hud.classList.remove('is-visible');
    placed = false;
    reef.setAttribute('visible', false);
  });

  /* ---------- hit-test feedback ---------- */
  const placer = document.getElementById('placer');

  const say = (title, copy) => {
    scanMsg.hidden = false;
    scanMsg.classList.add('is-visible');
    scanMsg.querySelector('.ar-scan-title').textContent = title;
    scanMsg.querySelector('.ar-scan-copy').textContent = copy;
  };

  placer.addEventListener('hit-test-ready', () => {
    say('Looking for a surface', 'Move your phone slowly across the floor.');
  });

  placer.addEventListener('hit-test-found', () => {
    if (placed) return;
    say('Surface found', 'Tap anywhere to place the reef.');
    scanMsg.querySelector('.ar-scan-ring').classList.add('is-locked');
  });

  placer.addEventListener('hit-test-lost', () => {
    if (placed) return;
    say('Looking for a surface', 'Move your phone slowly across the floor.');
    scanMsg.querySelector('.ar-scan-ring').classList.remove('is-locked');
  });

  placer.addEventListener('hit-test-failed', (ev) => {
    say('Hit-testing unavailable',
        (ev.detail && ev.detail.message) || 'This device did not provide a hit-test source.');
  });

  /* ---------- placement ---------- */
  placer.addEventListener('reef-placed', () => {
    placed = true;
    scanMsg.classList.remove('is-visible');
    hud.hidden = false;
    requestAnimationFrame(() => hud.classList.add('is-visible'));
  });

  resetBtn.addEventListener('click', () => {
    placed = false;
    hud.classList.remove('is-visible');
    placer.components['hit-test-placer'].rearm();
    say('Looking for a surface', 'Move your phone slowly across the floor.');
    scanMsg.querySelector('.ar-scan-ring').classList.remove('is-locked');
  });

  /* ---------- temperature ---------- */
  const setTemp = (c) => {
    scene.setAttribute('reef-state', 'celsius', c);
  };

  slider.addEventListener('input', () => {
    setTemp(parseFloat(slider.value));
  });

  scene.addEventListener('temperature-change', (ev) => {
    const { celsius, label } = ev.detail;
    hudTemp.textContent   = celsius.toFixed(1) + ' °C';
    sliderVal.textContent = celsius.toFixed(1) + ' °C';
    hudState.textContent  = label.text;
    hudState.className    = 'hud-state is-' + label.tone;
  });

  /* ---------- live data ----------
     Filled in by js/api.js. Until then the HUD shows the slider
     value and marks the source as manual. */
  if (window.ReefAPI && typeof window.ReefAPI.load === 'function') {
    window.ReefAPI.load().then((reading) => {
      hudSite.textContent = reading.site + (reading.cached ? ' · cached' : ' · live');
      slider.value = reading.celsius;
      setTemp(reading.celsius);
    }).catch(() => {
      hudSite.textContent = 'Manual control';
    });
  } else {
    hudSite.textContent = 'Manual control';
  }

  // Publish the initial state so the HUD is never blank.
  setTemp(parseFloat(slider.value));
});
