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
       → createAnchor on placement
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
    this.anchor = null;
    this.matrix = new THREE.Matrix4();
    this.pos = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.scl = new THREE.Vector3();

    /* A tap does not place the reef there and then. It raises this
       flag, and the next animation frame does the placing. Why, at
       length, in place(). */
    this.wantPlace = false;
    this.wantPlaceAt = 0;

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

      this.onSelect = () => {
        this.wantPlace = true;
        this.wantPlaceAt = performance.now();
      };
      session.addEventListener('select', this.onSelect);

      session.addEventListener('end', () => {
        if (this.source && this.source.cancel) this.source.cancel();
        this.source = null;
        this.hasHit = false;
        this.placed = false;
        this.wantPlace = false;
        this.anchor = null;
      });
    });
  },

  tick: function () {
    const sceneEl = this.el.sceneEl;
    const frame = sceneEl.frame;
    if (!frame || !this.source) return;

    const refSpace = sceneEl.renderer.xr.getReferenceSpace();
    if (!refSpace) return;

    // Once placed, the only job left is to follow the anchor.
    if (this.placed) {
      if (this.anchor && this.data.target) {
        /* An anchor whose physical point the runtime has lost is
           dropped from frame.trackedAnchors, and asking for its pose
           then returns nothing. Holding the last good pose is the
           right response: the reef stays where it was rather than
           snapping to the origin. */
        const pose = frame.getPose(this.anchor.anchorSpace, refSpace);
        if (pose) {
          this.matrix.fromArray(pose.transform.matrix);
          this.matrix.decompose(this.pos, this.quat, this.scl);
          this.data.target.object3D.position.copy(this.pos);
          this.data.target.object3D.quaternion.copy(this.quat);
        }
      }
      return;
    }

    const results = frame.getHitTestResults(this.source);

    if (!results.length) {
      if (this.hasHit) {
        this.hasHit = false;
        if (this.data.reticle) this.data.reticle.setAttribute('visible', false);
        this.el.emit('hit-test-lost');
      }
      /* Tapped while the surface was momentarily lost. Wait a few
         frames for it to come back rather than throwing the tap
         away — but not for ever, or a tap could fire much later. */
      if (this.wantPlace && performance.now() - this.wantPlaceAt > 400) {
        this.wantPlace = false;
      }
      return;
    }

    const hit = results[0];
    const pose = hit.getPose(refSpace);
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

    // The tap raised in the select handler is honoured here, inside
    // the frame, so the hit result it anchors to is still live.
    if (this.wantPlace) {
      this.wantPlace = false;
      this.place(hit, frame, refSpace);
    }
  },

  /* Called only from tick, only with a hit result taken from the
     frame that is currently active.

     That restriction is the whole point. Writing the pose once is
     not enough: the runtime keeps refining its estimate of the room
     as it sees more of it, so a position captured in one frame
     slowly disagrees with the same physical point later, and the
     reef appears to slide across the floor.

     An anchor hands that problem to the platform — it tracks the
     physical point and reports a corrected pose every frame — but
     an XRHitTestResult is only valid for the duration of the frame
     that produced it. Creating the anchor from a result captured in
     an earlier frame, which is what happens if the tap is serviced
     directly in the `select` handler, throws InvalidStateError. The
     catch then reports "anchor failed" and the reef falls back to
     the fixed pose that drifts. The bug and the symptom it causes
     look identical on screen, which is why this is spelled out.

     XRFrame.createAnchor is tried as a second route because some
     runtimes grant the `anchors` feature without supporting
     anchor creation from a hit result. */
  place: function (hit, frame, refSpace) {
    if (!this.data.target) return;

    this.data.target.object3D.position.copy(this.pos);
    this.data.target.object3D.quaternion.copy(this.quat);
    this.data.target.setAttribute('visible', true);

    if (!this.placed) {
      this.placed = true;
      if (this.data.reticle) this.data.reticle.setAttribute('visible', false);
      this.el.emit('reef-placed');
    }

    this.anchorHere(hit, frame, refSpace);
  },

  anchorHere: function (hit, frame, refSpace) {
    const done = (anchor) => {
      this.anchor = anchor;
      this.el.emit('anchor-status', { state: 'anchored' });
    };

    if (hit && hit.createAnchor) {
      hit.createAnchor().then(done).catch(() => this.anchorFromPose(frame, refSpace));
      return;
    }
    this.anchorFromPose(frame, refSpace);
  },

  anchorFromPose: function (frame, refSpace) {
    if (!frame || !frame.createAnchor || !refSpace) {
      this.el.emit('anchor-status', { state: 'anchors unsupported' });
      return;
    }

    let transform;
    try {
      transform = new XRRigidTransform(
        { x: this.pos.x, y: this.pos.y, z: this.pos.z },
        { x: this.quat.x, y: this.quat.y, z: this.quat.z, w: this.quat.w });
    } catch (e) {
      this.el.emit('anchor-status', { state: 'anchors unsupported' });
      return;
    }

    frame.createAnchor(transform, refSpace).then((anchor) => {
      this.anchor = anchor;
      this.el.emit('anchor-status', { state: 'anchored' });
    }).catch(() => {
      // Without an anchor the fixed pose written above still holds;
      // it just drifts more as the session goes on.
      this.el.emit('anchor-status', { state: 'anchor failed' });
    });
  },

  rearm: function () {
    this.placed = false;
    this.wantPlace = false;
    if (this.anchor && this.anchor.delete) this.anchor.delete();
    this.anchor = null;
    if (this.data.target) this.data.target.setAttribute('visible', false);
  }
});

/* ------------------------------------------------------------
   sensor-ar

   Markerless tracking for devices that cannot run WebXR. Every
   iPhone falls here, because iOS Safari does not implement
   immersive-ar at all, as do Android devices that are not
   ARCore-certified. Without a second path, half this project
   would be undemonstrable on a large share of target hardware.

   The brief permits "the WebXR Device API or supported browser
   equivalents". This is that equivalent:

     getUserMedia            → live camera passthrough
     DeviceOrientation       → rotational tracking of the phone
     assumed eye height      → a ground plane at y = 0
     ray/plane intersection  → where the user is pointing

   Orientation is read and applied here rather than left to
   look-controls' magic-window mode. That mode only switches on
   after a handshake with device-orientation-permission-ui, which
   this scene disables so it can ask for motion access at a moment
   of its own choosing; when the handshake does not complete the
   camera never rotates and the reef appears welded to the screen.
   Driving the camera directly removes that failure mode and makes
   the tracking pipeline explicit.

   Honest limitation: there is no positional tracking. Rotation is
   tracked, translation is not, so the reef holds its place when the
   phone turns but follows the user if they walk. Only WebXR gives
   true six degrees of freedom. Recorded in docs/TESTING.md.
   ------------------------------------------------------------ */
AFRAME.registerComponent('sensor-ar', {
  schema: {
    reticle:   { type: 'selector' },
    target:    { type: 'selector' },
    eyeHeight: { type: 'number', default: 1.4 },   // metres
    maxRange:  { type: 'number', default: 6.0 },
    minRange:  { type: 'number', default: 0.6 },

    /* Assumed field of view of the rear camera, in degrees, across
       the long edge of the frame it delivers. No browser API reports
       this, and getting it wrong is what makes a rotation-tracked
       overlay slide across the room: if the virtual camera is wider
       than the real one, the reef sweeps faster than the floor
       underneath it. 65° is typical of a phone's main rear lens. */
    cameraFov: { type: 'number', default: 65 },

    /* Correct the gyro's yaw against the magnetometer. Only iOS
       reports a compass heading on the orientation event; on Android
       `deviceorientationabsolute` is already north-referenced and
       this does nothing. */
    compass:     { type: 'boolean', default: true },
    compassGain: { type: 'number',  default: 0.02 },

    /* Distance in metres from the point the user pivots about to the
       phone's lens. Rotating the camera about a fixed point is not
       what a person does: the phone is held out in front, so turning
       on the spot swings the lens through an arc, and an object two
       metres away appears to shift by roughly arm / distance radians.
       Sweeping the virtual camera through the same arc removes that.

       Off by default because it is a guess about how the phone is
       being held, and a wrong guess trades one error for another.
       Try `?arm=0.3` on the device and keep it if the reef sits
       tighter to the floor while panning. */
    armLength: { type: 'number', default: 0 }
  },

  init: function () {
    this.active = false;
    this.hasGround = false;
    this.placed = false;
    this.tracking = false;
    this.eventName = null;      // which orientation event won the race

    this.dir     = new THREE.Vector3();
    this.camPos  = new THREE.Vector3();
    this.point   = new THREE.Vector3();
    this.forward = new THREE.Vector3(0, 0, -1);
    this.up      = new THREE.Vector3(0, 1, 0);
    this.arm     = new THREE.Vector3();
    this.yawEuler = new THREE.Euler();
    this.yawQuat  = new THREE.Quaternion();

    this.orientation = new THREE.Quaternion();
    this.euler   = new THREE.Euler();
    this.screenQ = new THREE.Quaternion();
    this.zAxis   = new THREE.Vector3(0, 0, 1);

    /* Yaw correction. See onOrientation. */
    this.alphaOffset = null;
    this.heading = null;
    this.headingAccuracy = null;

    // Last raw reading, kept only so the debug panel can show it.
    this.raw = { alpha: 0, beta: 0, gamma: 0, screen: 0 };
    this.fov = 0;

    /* DeviceOrientation describes the screen's frame. The camera
       looks out of the back of the phone, which is that frame
       rotated -90° about X. */
    this.deviceToCamera = new THREE.Quaternion(-Math.SQRT1_2, 0, 0, Math.SQRT1_2);

    this.onOrientation = this.onOrientation.bind(this);
    this.onResize = this.onResize.bind(this);
  },

  cameraEl: function () {
    const cam = this.el.sceneEl.camera;
    return cam && cam.el;
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
      this.takeCamera();

      /* Android fires `deviceorientationabsolute` with a compass-
         referenced heading, which drifts far less over a session.
         iOS only fires `deviceorientation`. Listen for both and keep
         whichever arrives first with usable angles. */
      window.addEventListener('deviceorientationabsolute', this.onOrientation);
      window.addEventListener('deviceorientation', this.onOrientation);
      window.addEventListener('resize', this.onResize);
      this.video.addEventListener('loadedmetadata', this.onResize);
      if (screen.orientation) {
        screen.orientation.addEventListener('change', this.onResize);
      }

      this.active = true;
      document.body.classList.add('in-sensor-ar');
      el.emit('sensor-ar-started');

      /* A phone that reports no orientation at all and a phone with
         no positional tracking look completely different on screen
         but are easy to confuse in a bug report, so say which it is. */
      this.watchdog = setTimeout(() => {
        if (this.active && !this.tracking) {
          el.emit('tracking-status', { state: 'no motion data' });
        }
      }, 1500);
    });
  },

  /* look-controls writes the camera's rotation every tick from its
     own pitch and yaw objects, which would immediately overwrite the
     pose set below. It is removed for the duration of the session
     and restored on the way out. */
  takeCamera: function () {
    const camEl = this.cameraEl();
    if (!camEl) return;

    // Called again from tick if the camera was not ready at start.
    if (this.savedLookControls === undefined) {
      this.savedLookControls = camEl.getAttribute('look-controls');
      const camData = camEl.getAttribute('camera');
      this.savedFov = camData && camData.fov;
    }

    camEl.removeAttribute('look-controls');
    camEl.object3D.position.set(0, this.data.eyeHeight, 0);
    this.onResize();
  },

  releaseCamera: function () {
    const camEl = this.cameraEl();
    if (!camEl) return;

    if (this.savedFov) camEl.setAttribute('camera', 'fov', this.savedFov);
    if (this.savedLookControls) {
      camEl.setAttribute('look-controls', this.savedLookControls);
    }
  },

  /* Match the virtual camera's field of view to the visible part of
     the camera feed. The feed is drawn with `object-fit: cover`, so
     it is scaled until it fills the screen and the overflow is
     cropped — the visible vertical angle is therefore smaller than
     the lens actually captures, and that is the angle the renderer
     has to reproduce for the reef to stay glued to the floor. */
  onResize: function () {
    const camEl = this.cameraEl();
    const video = this.video;
    if (!camEl || !video || !video.videoWidth) return;

    const vw = video.videoWidth;
    const vh = video.videoHeight;

    /* Measure the canvas rather than the window. On iOS Safari a
       `100vh` element is sized against the large viewport, which
       ignores the toolbar, while a `position: fixed; inset: 0`
       element is sized against the visual viewport, which does not.
       Reading the canvas keeps the projection matched to the box the
       feed is actually drawn in. */
    const canvas = this.el.sceneEl.canvas;
    const w = (canvas && canvas.clientWidth)  || window.innerWidth;
    const h = (canvas && canvas.clientHeight) || window.innerHeight;

    const longSide  = Math.max(vw, vh);
    const shortSide = Math.min(vw, vh);

    const fovLong  = THREE.MathUtils.degToRad(this.data.cameraFov);
    const fovShort = 2 * Math.atan(Math.tan(fovLong / 2) * (shortSide / longSide));
    const fovFullV = (vh >= vw) ? fovLong : fovShort;

    // Fraction of the frame's height that survives the crop.
    const scale   = Math.max(w / vw, h / vh);
    const visible = Math.min(1, (h / scale) / vh);

    this.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(fovFullV / 2) * visible));
    camEl.setAttribute('camera', 'fov', this.fov);
  },

  /* ----------------------------------------------------------
     Orientation, and the yaw drift that breaks anchoring on iOS.

     `alpha` is supposed to be the heading. On Android it is, and
     `deviceorientationabsolute` says so. On iOS it is not: Safari
     reports an arbitrary reference taken when listening started,
     and it drifts — not steadily with time, but in proportion to
     how much the phone is moved. That is exactly the symptom of a
     reef that will not stay put: turn away, walk about, turn back,
     and the reef has slid several degrees around the room because
     the yaw the camera is using no longer means what it did when
     the reef was placed.

     Safari does expose a magnetometer heading, `webkitCompassHeading`,
     which is absolute and does not drift, but it is noisy — feeding
     it straight into the yaw makes the whole scene shake.

     So: keep the gyro's alpha for frame-to-frame smoothness, and
     hold a slowly-adjusted offset that pulls it back onto the
     compass. The gyro supplies the detail, the compass supplies
     the truth, and the reef stays on its bearing.

     `webkitCompassHeading` runs clockwise from north; `alpha` runs
     anticlockwise, hence the subtraction from 360.
     ---------------------------------------------------------- */
  onOrientation: function (ev) {
    if (ev.alpha === null || ev.alpha === undefined) return;

    /* The first usable event decides which stream to trust. Mixing
       the absolute and relative streams would make the yaw jump. */
    if (this.eventName === null) this.eventName = ev.type;
    if (ev.type !== this.eventName) return;

    this.raw.alpha = ev.alpha;
    this.raw.beta  = ev.beta  || 0;
    this.raw.gamma = ev.gamma || 0;

    if (this.data.compass) this.correctYaw(ev);

    const alpha = THREE.MathUtils.degToRad(ev.alpha + (this.alphaOffset || 0));
    const beta  = THREE.MathUtils.degToRad(this.raw.beta);
    const gamma = THREE.MathUtils.degToRad(this.raw.gamma);

    let angle = 0;
    if (screen.orientation && typeof screen.orientation.angle === 'number') {
      angle = screen.orientation.angle;
    } else if (typeof window.orientation === 'number') {
      angle = window.orientation;
    }
    this.raw.screen = angle;

    this.euler.set(beta, alpha, -gamma, 'YXZ');
    this.orientation.setFromEuler(this.euler);
    this.orientation.multiply(this.deviceToCamera);
    this.orientation.multiply(
      this.screenQ.setFromAxisAngle(this.zAxis, -THREE.MathUtils.degToRad(angle)));

    if (!this.tracking) {
      this.tracking = true;
      clearTimeout(this.watchdog);
      this.el.emit('tracking-status', { state: 'rotation only' });
    }
  },

  correctYaw: function (ev) {
    const heading = ev.webkitCompassHeading;
    if (typeof heading !== 'number' || isNaN(heading)) return;

    /* Safari reports accuracy in degrees, and -1 when the
       magnetometer is not calibrated or is being disturbed — by a
       magnet, a laptop, or reinforced concrete. Correcting from a
       bad heading would drag the scene around, which is worse than
       the drift it is meant to remove. */
    const accuracy = ev.webkitCompassAccuracy;
    this.heading = heading;
    this.headingAccuracy = accuracy;
    if (typeof accuracy === 'number' && (accuracy < 0 || accuracy > 25)) return;

    const wanted = 360 - heading - ev.alpha;

    if (this.alphaOffset === null) {
      this.alphaOffset = wanted;          // first fix: adopt it outright
      return;
    }

    // Shortest way round, applied gently: about a second to absorb a
    // correction, which is far slower than the magnetometer's jitter
    // and far faster than the drift it is undoing.
    const delta = (((wanted - this.alphaOffset) % 360) + 540) % 360 - 180;
    this.alphaOffset += delta * this.data.compassGain;
  },

  stop: function () {
    this.active = false;
    this.placed = false;
    this.hasGround = false;
    this.tracking = false;
    this.eventName = null;
    this.alphaOffset = null;
    clearTimeout(this.watchdog);

    window.removeEventListener('deviceorientationabsolute', this.onOrientation);
    window.removeEventListener('deviceorientation', this.onOrientation);
    window.removeEventListener('resize', this.onResize);
    if (this.video) this.video.removeEventListener('loadedmetadata', this.onResize);
    if (screen.orientation) {
      screen.orientation.removeEventListener('change', this.onResize);
    }
    this.releaseCamera();

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
    if (!this.active) return;

    const camEl = this.cameraEl();
    if (!camEl) return;
    if (camEl.components['look-controls']) this.takeCamera();

    /* The camera is held at the assumed eye height and turned by the
       device's own orientation. Nothing else writes to it while the
       session runs, so the world stays put when the phone turns —
       which is what makes the reef look placed on the floor rather
       than painted on the screen. */
    if (this.tracking) camEl.object3D.quaternion.copy(this.orientation);

    /* Yaw only. Panning swings the phone through an arc; tilting it
       down with the wrist barely moves the lens at all, so feeding
       pitch into the arm would invent motion that did not happen. */
    if (this.data.armLength > 0 && this.tracking) {
      this.yawEuler.setFromQuaternion(this.orientation, 'YXZ');
      this.yawQuat.setFromAxisAngle(this.up, this.yawEuler.y);
      this.arm.set(0, 0, -this.data.armLength).applyQuaternion(this.yawQuat);
      camEl.object3D.position.set(this.arm.x, this.data.eyeHeight, this.arm.z);
    } else {
      camEl.object3D.position.set(0, this.data.eyeHeight, 0);
    }

    if (this.placed) return;

    this.el.sceneEl.camera.getWorldPosition(this.camPos);
    this.dir.copy(this.forward).applyQuaternion(this.orientation);

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
  let siteLabel = 'Manual control';
  let trackingLabel = null;

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
     freedom tracking. The sensor path is the fallback for iOS
     and for Android devices that are not ARCore-certified. */

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
        'This device cannot run WebXR, so the in-page view places the reef with the ' +
        'camera and motion sensors: it holds its bearing as you turn, but walking is ' +
        'not tracked. For tracking that survives walking around the reef, open it in ' +
        'ARKit instead.';
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
      optionalFeatures: ['dom-overlay', 'local-floor', 'anchors'],
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
    }).catch(() => {
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
        if (trackingLabel) hudSite.textContent = siteLabel + ' \u00B7 ' + trackingLabel;
      })
      .catch((err) => gateFailed(describe(err)));
  }

  /* iOS 13+ gates DeviceOrientation behind an explicit request that
     must originate from a user gesture. Without it no orientation
     events ever arrive, the camera never turns, and the reef looks
     stuck to the screen rather than to the floor. */
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
    // Handing off to a native viewer from inside a live XR session
    // would be asking for a second session; hide it until we are out.
    arkitOpen.classList.remove('is-available');
    document.body.classList.add('in-ar');
    gate.classList.add('is-hidden');
    say('Looking for a surface', 'Move your phone slowly across the floor.');
  });

  scene.addEventListener('exit-vr', () => {
    if (window.ReefARKit) showARKit(window.ReefARKit);
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

  // Anchoring is invisible when it works and invisible when it does
  // not, so report it in the HUD alongside the data source.
  placer.addEventListener('anchor-status', (ev) => {
    hudSite.textContent = siteLabel + ' \u00B7 ' + ev.detail.state;
  });

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

  /* The sensor path tracks rotation but not translation, so the reef
     stays put when the phone turns and follows the user if they walk.
     That is a constraint of the fallback rather than a bug, so the HUD
     states it in the same place the WebXR path states its anchor
     status. A phone reporting no orientation at all is a different
     failure and needs saying out loud. */
  sensor.addEventListener('tracking-status', (ev) => {
    trackingLabel = ev.detail.state;
    hudSite.textContent = siteLabel + ' \u00B7 ' + trackingLabel;

    if (trackingLabel === 'no motion data') {
      say('No motion data',
          'This phone is not reporting its orientation, so the reef cannot ' +
          'hold its place. Check motion access in the browser settings.');
    }
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
    if (ev.target.closest('.ar-back, .ar-btn, .ar-btn-alt, .hud')) return;
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

    // The reef sent to ARKit should be the reef on screen.
    if (window.ReefARKit) window.ReefARKit.setBleach(ev.detail.bleach);

    hudTemp.textContent   = celsius.toFixed(1) + ' \u00B0C';
    sliderVal.textContent = celsius.toFixed(1) + ' \u00B0C';
    hudState.textContent  = label.text;
    hudState.className    = 'hud-state is-' + label.tone;
  });

    // The school thins and disperses as the water warms, so the
  // slider drives behaviour as well as colour.
  scene.addEventListener('temperature-change', (ev) => {
    document.querySelectorAll('[reef-school]').forEach((el) => {
      const comp = el.components['reef-school'];
      if (comp && comp.setScatter) comp.setScatter(ev.detail.bleach);
    });
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

      siteLabel = reading.site + ' \u00B7 ' + source;
      hudSite.textContent = trackingLabel
        ? siteLabel + ' \u00B7 ' + trackingLabel
        : siteLabel;
      hudSite.classList.toggle('is-stale', reading.offline);

      slider.value = reading.celsius;
      setTemp(reading.celsius);
    }).catch(() => {
      hudSite.textContent = siteLabel;
    });
  } else {
    hudSite.textContent = siteLabel;
  }

  /* ---------- ARKit hand-off ----------
     On iOS this is the only path to real six-degrees-of-freedom
     tracking: Safari implements no WebXR, so the reef is handed to
     AR Quick Look, which is ARKit in a native viewer. On Android it
     resolves to Scene Viewer or WebXR. js/arkit.js reports whether
     the device can take the hand-off at all. */

  const arkitStart = document.getElementById('arkitStart');
  const arkitOpen  = document.getElementById('arkitOpen');
  const arkitNote  = document.getElementById('arkitNote');

  const openARKit = () => {
    if (window.ReefARKit && window.ReefARKit.launch()) return;
    const why = (window.ReefARKit && window.ReefARKit.reason) ||
                'Native AR is not available on this device.';
    arkitNote.textContent = why;
    arkitNote.classList.add('is-shown');
  };

  arkitStart.addEventListener('click', openARKit);
  arkitOpen.addEventListener('click', openARKit);

  const showARKit = (detail) => {
    const ok = detail.supported;

    arkitStart.classList.toggle('is-available', ok);
    arkitOpen.classList.toggle('is-available', ok);

    if (ok) {
      /* Worth saying plainly on the device where it matters. The
         in-page session tracks rotation only; this one does not. */
      arkitNote.textContent = mode === 'webxr'
        ? 'Opens the reef in the system AR viewer at real scale.'
        : 'Opens the reef in ARKit, which tracks properly as you walk ' +
          'around it. The temperature is fixed at whatever is set here.';
      arkitNote.classList.add('is-shown');
    } else if (detail.reason) {
      arkitNote.textContent = detail.reason;
      arkitNote.classList.add('is-shown');
    }
  };

  document.addEventListener('arkit-status', (ev) => showARKit(ev.detail));

  // arkit.js can settle before this listener exists, so read it once.
  if (window.ReefARKit && window.ReefARKit.supported) showARKit(window.ReefARKit);

  /* ---------- on-device diagnostics ----------
     Add ?debug to the URL for a live readout of the sensor path, and
     ?fov=NN to override the assumed camera field of view without
     editing the page — the two things that cannot be checked from a
     desktop browser and decide whether the reef holds its place. */

  const params = new URLSearchParams(location.search);

  if (params.has('fov')) {
    const f = parseFloat(params.get('fov'));
    if (f > 20 && f < 130) sensor.setAttribute('sensor-ar', 'cameraFov', f);
  }
  if (params.get('compass') === 'off') {
    sensor.setAttribute('sensor-ar', 'compass', false);
  }
  if (params.has('arm')) {
    const a = parseFloat(params.get('arm'));
    if (a >= 0 && a < 1.5) sensor.setAttribute('sensor-ar', 'armLength', a);
  }

  if (params.has('debug')) {
    const panel = document.createElement('pre');
    panel.className = 'sensor-debug';
    document.getElementById('overlay').appendChild(panel);

    const deg = (r) => (THREE.MathUtils.radToDeg(r)).toFixed(1);
    const num = (v, d) => (v === null || v === undefined ? '--' : v.toFixed(d === undefined ? 1 : d));

    setInterval(() => {
      const c = sensor.components['sensor-ar'];
      const camEl = scene.camera && scene.camera.el;
      const canvas = scene.canvas;
      const rows = [];

      rows.push('mode      ' + mode);

      if (!c || !c.active) {
        rows.push('sensor    idle');
      } else {
        const e = new THREE.Euler().setFromQuaternion(camEl.object3D.quaternion, 'YXZ');
        rows.push('event     ' + (c.eventName || 'none') + (c.tracking ? '' : ' (no data)'));
        rows.push('abg       ' + num(c.raw.alpha) + ' ' + num(c.raw.beta) + ' ' + num(c.raw.gamma));
        rows.push('screen    ' + c.raw.screen + '°');
        rows.push('compass   ' + num(c.heading) + '° acc ' + num(c.headingAccuracy));
        rows.push('offset    ' + num(c.alphaOffset));
        rows.push('cam yaw   ' + deg(e.y) + '°  pitch ' + deg(e.x) + '°');
        rows.push('feed      ' + (c.video ? c.video.videoWidth + 'x' + c.video.videoHeight : '--'));
        rows.push('canvas    ' + (canvas ? canvas.clientWidth + 'x' + canvas.clientHeight : '--'));
        rows.push('fov       ' + num(c.fov, 2) + '° (assume ' + c.data.cameraFov + ')');
        rows.push('arm       ' + c.data.armLength + ' m');
        rows.push('placed    ' + (c.placed ? 'yes' : 'no'));
      }

      const p = reef.object3D.position;
      rows.push('reef      ' + p.x.toFixed(2) + ' ' + p.y.toFixed(2) + ' ' + p.z.toFixed(2));

      panel.textContent = rows.join('\n');
    }, 120);
  }

  // Publish an initial state so the HUD is never blank.
  setTemp(parseFloat(slider.value));
});