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