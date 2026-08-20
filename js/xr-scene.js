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
    if (!scene.is('ar-mode')) return;
    gate.classList.add('is-hidden');
    scanMsg.hidden = false;
    requestAnimationFrame(() => scanMsg.classList.add('is-visible'));
  });

  scene.addEventListener('exit-vr', () => {
    gate.classList.remove('is-hidden');
    scanMsg.classList.remove('is-visible');
    hud.classList.remove('is-visible');
    placed = false;
    reef.setAttribute('visible', false);
  });

  /* ---------- hit-test feedback ---------- */
  // A-Frame's ar-hit-test emits these as it finds and loses surfaces.
  reticle.addEventListener('ar-hit-test-start', () => {
    scanMsg.querySelector('.ar-scan-title').textContent = 'Looking for a surface';
    scanMsg.querySelector('.ar-scan-copy').textContent  = 'Move your phone slowly across the floor.';
  });

  reticle.addEventListener('ar-hit-test-achieved', () => {
    if (placed) return;
    scanMsg.querySelector('.ar-scan-title').textContent = 'Surface found';
    scanMsg.querySelector('.ar-scan-copy').textContent  = 'Tap to place the reef.';
  });

  /* ---------- placement ---------- */
  reticle.addEventListener('ar-hit-test-select', (ev) => {
    const p = ev.detail.position;
    const r = ev.detail.orientation;

    reef.object3D.position.copy(p);
    if (r) reef.object3D.quaternion.copy(r);
    reef.setAttribute('visible', true);

    if (!placed) {
      placed = true;
      scanMsg.classList.remove('is-visible');
      hud.hidden = false;
      requestAnimationFrame(() => hud.classList.add('is-visible'));
      // Stop the reticle chasing surfaces once we have a home.
      reticle.setAttribute('ar-hit-test', 'enabled', false);
    }
  });

  resetBtn.addEventListener('click', () => {
    placed = false;
    reef.setAttribute('visible', false);
    hud.classList.remove('is-visible');
    scanMsg.classList.add('is-visible');
    reticle.setAttribute('ar-hit-test', 'enabled', true);
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
