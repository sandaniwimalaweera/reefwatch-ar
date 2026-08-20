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
   sensor-ar

   Markerless tracking for devices that cannot run WebXR. ARCore
   certification is hardware-locked, so a large share of Android
   phones — and every iPhone — cannot open an immersive-ar
   session at all. Without a second path, half this project
   would be undemonstrable on the devices actually to hand.

   The brief permits "the WebXR Device API or supported browser
   equivalents". This is that equivalent:

     getUserMedia            → live camera passthrough
     DeviceOrientation       → rotational tracking of the phone
     assumed eye height      → a ground plane at y = 0
     ray/plane intersection  → where the user is pointing

   Honest limitation: there is no positional tracking. Rotation
   is tracked, translation is not, so walking toward the reef
   does not close the distance. Recorded in docs/TESTING.md.
   ------------------------------------------------------------ */
AFRAME.registerComponent('sensor-ar', {
  schema: {
    reticle:   { type: 'selector' },
    target:    { type: 'selector' },
    eyeHeight: { type: 'number', default: 1.4 },   // metres
    maxRange:  { type: 'number', default: 6.0 },
    minRange:  { type: 'number', default: 0.6 }
  },

  init: function () {
    this.active = false;
    this.hasGround = false;
    this.placed = false;

    this.dir = new THREE.Vector3();
    this.camPos = new THREE.Vector3();
    this.point = new THREE.Vector3();
    this.forward = new THREE.Vector3(0, 0, -1);
  },

  start: function () {
    const el = this.el;

    return navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
      audio: false
    }).then((stream) => {
      this.stream = stream;

      const video = document.createElement('video');
      video.setAttribute('playsinline', '');
      video.setAttribute('autoplay', '');
      video.setAttribute('muted', '');
      video.muted = true;
      video.srcObject = stream;
      video.className = 'sensor-feed';
      document.body.appendChild(video);
      this.video = video;

      return video.play();
    }).then(() => {
      this.active = true;
      document.body.classList.add('in-sensor-ar');
      el.emit('sensor-ar-started');
    });
  },

  stop: function () {
    this.active = false;
    this.placed = false;
    this.hasGround = false;

    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    if (this.video) {
      this.video.remove();
      this.video = null;
    }
    document.body.classList.remove('in-sensor-ar');
  },

  tick: function () {
    if (!this.active || this.placed) return;

    const cam = this.el.sceneEl.camera;
    if (!cam) return;

    cam.getWorldPosition(this.camPos);
    this.dir.copy(this.forward).applyQuaternion(cam.getWorldQuaternion(new THREE.Quaternion()));

    // Only meaningful when the phone is tilted downward; otherwise
    // the ray never meets the ground plane.
    if (this.dir.y > -0.08) {
      if (this.hasGround) {
        this.hasGround = false;
        if (this.data.reticle) this.data.reticle.setAttribute('visible', false);
        this.el.emit('ground-lost');
      }
      return;
    }

    // Intersect the view ray with the plane y = 0.
    const t = -this.camPos.y / this.dir.y;
    const distance = Math.min(this.data.maxRange, Math.max(this.data.minRange, t));

    this.point.copy(this.dir).multiplyScalar(distance).add(this.camPos);
    this.point.y = 0;

    if (this.data.reticle) {
      this.data.reticle.object3D.position.copy(this.point);
      this.data.reticle.object3D.rotation.set(0, 0, 0);
      this.data.reticle.setAttribute('visible', true);
    }

    if (!this.hasGround) {
      this.hasGround = true;
      this.el.emit('ground-found');
    }
  },

  place: function () {
    if (!this.active || !this.hasGround || !this.data.target) return;

    this.data.target.object3D.position.copy(this.point);
    this.data.target.object3D.rotation.set(0, 0, 0);
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
  const placer    = document.getElementById('placer');
  const sensor    = document.getElementById('sensor');
  const reticle   = document.getElementById('reticle');
  const reef      = document.getElementById('reef');
  const gate      = document.getElementById('gate');
  const gateTitle = document.getElementById('gateTitle');
  const gateCopy  = document.getElementById('gateCopy');
  const gateNote  = document.getElementById('gateNote');
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
  let mode = null;          // 'webxr' | 'sensor'

  /* ---------- messaging helpers ---------- */

  const say = (title, copy) => {
    scanMsg.hidden = false;
    scanMsg.classList.add('is-visible');
    scanMsg.querySelector('.ar-scan-title').textContent = title;
    scanMsg.querySelector('.ar-scan-copy').textContent = copy;
  };

  const lockRing = (locked) => {
    scanMsg.querySelector('.ar-scan-ring').classList.toggle('is-locked', locked);
  };

  const gateFailed = (msg) => {
    gate.classList.remove('is-hidden');
    document.body.classList.remove('in-ar');
    startBtn.disabled = false;
    startBtn.textContent = 'Try again';
    gateTitle.textContent = 'Could not start';
    gateCopy.textContent = msg || 'Something prevented the session from starting.';
  };

  // Turn a DOMException into something a person can act on.
  const describe = (err) => {
    const name = err && err.name;
    if (name === 'NotAllowedError')  return 'Camera permission was denied. Allow it in the site settings and try again.';
    if (name === 'NotFoundError')    return 'No camera was found on this device.';
    if (name === 'NotReadableError') return 'The camera is in use by another app. Close it and try again.';
    if (name === 'SecurityError')    return 'The browser blocked camera access. The page must be served over https.';
    if (name === 'NotSupportedError')return 'This device cannot provide an immersive AR session.';
    return (name ? name + ': ' : '') + ((err && err.message) || 'Unknown error.');
  };

  /* ---------- capability detection ----------
     WebXR is preferred because it gives true six-degrees-of-
     freedom tracking. The sensor path is the fallback for the
     many devices that are not ARCore-certified. */

  const chooseMode = () => {
    if (!navigator.xr || !navigator.xr.isSessionSupported) {
      return Promise.resolve('sensor');
    }
    return navigator.xr.isSessionSupported('immersive-ar')
      .then((ok) => (ok ? 'webxr' : 'sensor'))
      .catch(() => 'sensor');
  };

  chooseMode().then((m) => {
    mode = m;

    if (mode === 'webxr') {
      gateNote.textContent = 'WebXR · full spatial tracking';
      startBtn.textContent = 'Start AR';
    } else {
      gateNote.textContent = 'Sensor tracking · this device is not ARCore-certified';
      startBtn.textContent = 'Start camera view';
      gateCopy.textContent =
        'This device cannot run WebXR, so the reef is placed using the camera and ' +
        'motion sensors instead. Point the phone down at the floor and tap to place it.';
    }
  });

  /* ---------- starting ---------- */

  startBtn.addEventListener('click', () => {
    startBtn.disabled = true;
    startBtn.textContent = 'Starting…';

    if (mode === 'webxr') {
      startWebXR();
    } else {
      startSensor();
    }
  });

  function startWebXR () {
    // A-Frame swallows the underlying session error, so request a
    // session first purely to read the real failure reason.
    navigator.xr.requestSession('immersive-ar', {
      requiredFeatures: ['hit-test'],
      optionalFeatures: ['dom-overlay', 'local-floor'],
      domOverlay: { root: document.getElementById('overlay') }
    }).then((probe) => probe.end()).then(() => {
      let entered = false;
      scene.addEventListener('enter-vr', () => { entered = true; }, { once: true });

      if (typeof scene.enterAR === 'function') {
        scene.enterAR();
      } else {
        scene.enterVR(true);
      }

      setTimeout(() => {
        if (!entered) gateFailed('The session was granted but AR mode did not start. Try reloading.');
      }, 5000);
    }).catch((err) => {
      // Fall back rather than dead-ending the user.
      mode = 'sensor';
      startSensor();
    });
  }

  function startSensor () {
    requestMotionPermission()
      .then(() => sensor.components['sensor-ar'].start())
      .then(() => {
        gate.classList.add('is-hidden');
        say('Point at the floor', 'Tilt your phone down until the ring appears, then tap to place the reef.');
      })
      .catch((err) => gateFailed(describe(err)));
  }

  // iOS 13+ gates DeviceOrientation behind an explicit request that
  // must originate from a user gesture.
  function requestMotionPermission () {
    const DOE = window.DeviceOrientationEvent;
    if (!DOE || typeof DOE.requestPermission !== 'function') {
      return Promise.resolve();
    }
    return DOE.requestPermission().then((state) => {
      if (state !== 'granted') {
        throw new Error('Motion access was denied. Allow it and try again.');
      }
    });
  }

  /* ---------- WebXR session events ---------- */

  scene.addEventListener('enter-vr', () => {
    if (!scene.is('ar-mode')) return;
    document.body.classList.add('in-ar');
    gate.classList.add('is-hidden');
    say('Looking for a surface', 'Move your phone slowly across the floor.');
  });

  scene.addEventListener('exit-vr', () => {
    document.body.classList.remove('in-ar');
    gate.classList.remove('is-hidden');
    startBtn.disabled = false;
    startBtn.textContent = mode === 'webxr' ? 'Start AR' : 'Start camera view';
    scanMsg.classList.remove('is-visible');
    hud.classList.remove('is-visible');
    placed = false;
    reef.setAttribute('visible', false);
  });

  /* ---------- tracking feedback (both paths) ---------- */

  placer.addEventListener('hit-test-ready', () =>
    say('Looking for a surface', 'Move your phone slowly across the floor.'));

  placer.addEventListener('hit-test-found', () => {
    if (placed) return;
    say('Surface found', 'Tap anywhere to place the reef.');
    lockRing(true);
  });

  placer.addEventListener('hit-test-lost', () => {
    if (placed) return;
    say('Looking for a surface', 'Move your phone slowly across the floor.');
    lockRing(false);
  });

  placer.addEventListener('hit-test-failed', (ev) =>
    say('Hit-testing unavailable', (ev.detail && ev.detail.message) || 'No hit-test source.'));

  sensor.addEventListener('ground-found', () => {
    if (placed) return;
    say('Floor found', 'Tap anywhere to place the reef.');
    lockRing(true);
  });

  sensor.addEventListener('ground-lost', () => {
    if (placed) return;
    say('Point at the floor', 'Tilt your phone down until the ring appears.');
    lockRing(false);
  });

  /* ---------- placement ---------- */

  const onPlaced = () => {
    placed = true;
    scanMsg.classList.remove('is-visible');
    hud.hidden = false;
    requestAnimationFrame(() => hud.classList.add('is-visible'));
  };

  placer.addEventListener('reef-placed', onPlaced);
  sensor.addEventListener('reef-placed', onPlaced);

  // The sensor path has no XR select event, so taps come from the DOM.
  document.getElementById('overlay').addEventListener('click', (ev) => {
    if (placed) return;
    if (ev.target.closest('.ar-back, .ar-btn, .hud')) return;
    const comp = sensor.components['sensor-ar'];
    if (comp && comp.active) comp.place();
  });

  resetBtn.addEventListener('click', () => {
    placed = false;
    hud.classList.remove('is-visible');

    const xr = placer.components['hit-test-placer'];
    const sn = sensor.components['sensor-ar'];
    if (xr && xr.rearm) xr.rearm();
    if (sn && sn.rearm) sn.rearm();

    lockRing(false);
    say(mode === 'webxr' ? 'Looking for a surface' : 'Point at the floor',
        'Tap again to place the reef somewhere else.');
  });

  /* ---------- temperature ---------- */

  const setTemp = (c) => scene.setAttribute('reef-state', 'celsius', c);

  slider.addEventListener('input', () => setTemp(parseFloat(slider.value)));

  scene.addEventListener('temperature-change', (ev) => {
    const { celsius, label } = ev.detail;
    hudTemp.textContent   = celsius.toFixed(1) + ' \u00B0C';
    sliderVal.textContent = celsius.toFixed(1) + ' \u00B0C';
    hudState.textContent  = label.text;
    hudState.className    = 'hud-state is-' + label.tone;
  });

  /* ---------- live data ----------
     The slider stays available either way, so the user can explore
     temperatures the sea is not currently at. The HUD always says
     where the starting figure came from. */
  if (window.ReefAPI && typeof window.ReefAPI.load === 'function') {
    window.ReefAPI.load().then((reading) => {
      let source;
      if (!reading.offline)     source = 'live';
      else if (reading.cached)  source = 'cached';
      else                      source = 'seasonal average';

      hudSite.textContent = reading.site + ' \u00B7 ' + source;
      hudSite.classList.toggle('is-stale', reading.offline);

      slider.value = reading.celsius;
      setTemp(reading.celsius);
    }).catch(() => {
      hudSite.textContent = 'Manual control';
    });
  } else {
    hudSite.textContent = 'Manual control';
  }

  // Publish an initial state so the HUD is never blank.
  setTemp(parseFloat(slider.value));
});
