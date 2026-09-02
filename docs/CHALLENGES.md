# Development Challenges and Solutions

This log feeds the compulsory challenges section of the technical report,
which is worth 5 of the 25 marks.

Write an entry the moment a problem happens — not from memory later. Include
real numbers wherever you can measure something.

---

## Template — copy this for each new entry

## Challenge N: [Short title]

**Date:**

**Symptom:** What actually went wrong, exactly what I saw on screen.

**Cause:** Why it happened, once I worked it out.

**What I tried that failed:** Dead ends. Worth writing — they show real
engineering rather than a lucky first guess.

**Solution:** The exact fix. Code, settings, numbers.

**Result:** Measured improvement where possible.

---

## Challenge 1: Reef would not stay put in markerless mode

**Date:** 2026-09-02

**Symptom:** On the markerless page, the reef did not stay on the floor after
it was placed. Turning the phone dragged it along with the screen instead of
leaving it behind on the spot it was dropped.

**Cause:** Two separate faults in the sensor fallback, the path used by any
phone that cannot run WebXR.

1. The camera was rotated by A-Frame's `look-controls` magic-window mode.
   That mode stays switched off until it receives a handshake from the
   `device-orientation-permission-ui` component, which this scene disables so
   it can ask for motion access at a moment of its own choosing. The scene
   tried to complete the handshake by hand, by emitting
   `deviceorientationpermissiongranted` and reaching into
   `look-controls.magicWindowControls`, which depends on A-Frame internals
   and fails silently when they do not line up. With the camera never
   turning, a reef fixed in the world looks welded to the screen.

2. The virtual camera kept A-Frame's default 80° field of view while the real
   camera feed behind it shows roughly 51° vertically once `object-fit: cover`
   has cropped it. A field of view that is too wide makes the reef sweep
   across the screen faster than the floor underneath it, so it slides even
   when the rotation itself is correct.

**What I tried that failed:** Emitting `deviceorientationpermissiongranted` on
the scene and setting `magicWindowControls.enabled = true` directly. It works
only if look-controls happened to build its `DeviceOrientationControls` and is
undetectable when it did not.

**Solution:** `sensor-ar` now takes the camera over for the length of the
session. It removes `look-controls`, listens for `deviceorientationabsolute`
(falling back to `deviceorientation` on iOS), converts the reported angles to
a quaternion with the screen-orientation correction applied, and writes it to
the camera every tick. The field of view is computed from the video track's
own dimensions against the viewport and the `cameraFov` assumption, and is
recomputed on resize and orientation change. A 1.5 s watchdog reports
`no motion data` when no orientation events ever arrive, so a phone that
cannot track at all is distinguishable from one that merely cannot track
translation.

**Result:** The reef holds its position on the floor while the phone turns.
Translation is still untracked — walking sideways moves the reef with the
user — which is inherent to sensor-only tracking and is now stated in the
gate copy and in the HUD, which reads `rotation only` on this path against
`anchored` on the WebXR path.

---

## Challenge 2: The reef still drifted on iPhone after the camera was fixed

**Date:** 2026-09-02

**Symptom:** With the camera turning correctly, the reef held still for a few
seconds and then wandered. Turning away from it and turning back left it
several degrees around the room from where it had been dropped. The error grew
with how much the phone was moved, not with how long the session had run.

**Cause:** iOS Safari's `alpha` is not a heading. Android reports a
north-referenced alpha and announces it through `deviceorientationabsolute`;
Safari reports an arbitrary reference taken when the listener was attached, and
it drifts in proportion to how much the device is moved. Every frame the camera
was being pointed with a yaw that no longer meant what it had meant when the
reef was placed, so the reef appeared to slide even though nothing had written
to its transform since placement.

**What I tried that failed:** Treating it as a smoothing problem and easing the
camera rotation. It hid nothing — the drift is in the measurement, not the
noise, so filtering it just delayed the same error.

**Solution:** A complementary filter over the two sensors. The gyro's `alpha`
still supplies frame-to-frame motion because it is smooth, and Safari's
`webkitCompassHeading` — magnetometer-referenced, absolute, and drift-free but
noisy — supplies the truth. `sensor-ar.correctYaw` holds an offset between them
and moves it toward the compass at a gain of 0.02 per event, roughly a second
to absorb a correction: far slower than the magnetometer's jitter, far faster
than the drift being undone. Readings are ignored when
`webkitCompassAccuracy` is negative or above 25°, which is Safari's way of
saying the magnetometer is uncalibrated or disturbed.

`webkitCompassHeading` runs clockwise from north and `alpha` runs
anticlockwise, hence the `360 - heading` in the conversion.

**Result:** The reef holds its bearing across a session. Two smaller faults
found in the same pass:

- The camera feed was sized `100vw`/`100vh` while the canvas over it was a
  `position: fixed; inset: 0` box. On iOS Safari those resolve against
  different viewports — the large one ignores the toolbar, the visual one does
  not — so the feed was scaled differently from the render by the height of
  the toolbar. Both are percentages now, and the field of view is computed
  from `canvas.clientWidth/Height` rather than `window.inner*`.
- Rotating the virtual camera about a fixed point is not what a person does
  with a phone held out in front of them. `armLength` sweeps the camera
  through the same arc the real lens travels. It is off by default, since it
  is a guess about how the phone is being held, and tunable with `?arm=0.3`.

Add `?debug` to the markerless URL for a live readout of event type, raw
angles, compass heading and accuracy, the offset, feed and canvas dimensions,
the computed field of view and the reef's world position. `?fov=NN` overrides
the assumed lens angle without editing the page.

---

## Challenge 3: Sensor tracking is not anchoring, and on iOS it cannot be

**Date:** 2026-09-02

**Symptom:** Even with the camera turning correctly and the yaw held on the
compass, the reef in the markerless view did not stay where it was put. Walking
towards it did not close the distance; walking sideways took it along.

**Cause:** Not a bug. The sensor fallback measures orientation and nothing
else. There is no way to measure translation from a phone's sensors alone —
integrating the accelerometer twice drifts by metres within seconds, which is
the whole reason ARKit and ARCore fuse the camera with the IMU and run SLAM.
Safari on iOS exposes neither: no WebXR, no `immersive-ar`, no route from
JavaScript to ARKit, and no published Apple timeline for one. So on iPhone the
in-page view has a hard ceiling at three degrees of freedom, and no amount of
work on `sensor-ar` moves it.

**What I tried that failed:** Treating it as a tuning problem — field of view,
compass correction, an arm model for the arc a hand-held phone sweeps through.
All of them are real improvements and all of them are still rotation. None of
them can make walking work.

**Solution:** Stop trying to do it in the page and hand the model to the
operating system. AR Quick Look is a native viewer built on ARKit, and Safari
launches it from a link marked `rel="ar"` pointing at a USDZ. `js/arkit.js`
uses `<model-viewer>` to convert the reef GLB to USDZ on the fly and call
`activateAR()`, which on iOS gets visual-inertial SLAM, real plane detection
and true world anchoring, and on Android resolves to Scene Viewer or WebXR
instead — one button for every device with native AR.

Two details cost time:

- The source model is 9 m across and floats 0.68 m above its own origin. In
  the scene `fit-model` normalises that at runtime, but Quick Look gets the
  file as it is, so `ar-scale: fixed` dropped a nine-metre reef hovering in
  the room. `assets/models/reef-ar.glb` is the same mesh under a baked root
  transform applying the identical rule: longest edge 1.25 m, base on y = 0.
- `activateAR()` has to be called straight from the tap. Awaiting anything
  first loses the user gesture and Safari offers a download instead of the
  viewer.

The bleaching still tracks the temperature. The reef's one material is
untextured, so `baseColorFactor` *is* the colour, and the same curve
`bleachable` uses — lerp toward bone, roughness up, metalness down — is
written straight onto the model-viewer material before the hand-off. The
converted colours are linear rather than sRGB, so `#FFF6EC` is converted once
in `js/arkit.js` rather than at every slider movement.

**Result:** Two honest paths on the same page. The in-page sensor view is
interactive, keeps the live temperature slider, and holds its bearing as the
phone turns. The ARKit view tracks properly as the user walks around the reef,
at the cost of being Apple's viewer with the temperature frozen at whatever
the page was showing. The comparison between them is itself evidence for the
report: the same model and the same data, with and without SLAM, on a device
that cannot run WebXR at all.

---

# Asset optimisation record

Fill this in on day 2. These numbers are direct evidence for the
"appropriately optimized for web delivery" requirement.

| Model | Original size | Original tris | Final size | Final tris | Technique |
|---|---|---|---|---|---|
| coral.glb | 87 KB (unpacked glTF + bin + textures) | — | 225 KB | — | GLB bundling + Draco compression |
| reef.glb | (check raw folder size) | — | 433 KB | — | GLB bundling + Draco compression |

Note: both GLB files are larger than the raw `.bin` mesh data because the GLB
bundles mesh, materials and textures into a single binary. This trades a small
size increase for one HTTP request instead of several, which loads faster on
mobile data. Both models are well under the 2 MB target.