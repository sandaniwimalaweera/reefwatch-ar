# Testing Record

Evidence for the Testing & Evaluation criterion (3 marks). Fill this in as you
test, not afterwards.

## Device matrix

| Device | OS / Browser | Marker mode | Markerless mode | Live data | Notes |
|---|---|---|---|---|---|
| | Android / Chrome | | | | |
| | Android / Chrome | | | | |
| | iOS / Safari | | | | |
| | Windows / Chrome | | n/a | | |

Use: PASS / FAIL / PARTIAL / N/A

## Condition tests

| Condition | What I tested | Result | Fix applied |
|---|---|---|---|
| Bright sunlight | Marker tracking stability | | |
| Dim indoor light | Marker tracking stability | | |
| Mobile data (4G) | Model load time | | |
| Wifi | Model load time | | |
| Plain tile floor | Hit-test plane detection | | |
| Patterned carpet | Hit-test plane detection | | |
| Airplane mode | API fallback behaviour | | |

## Performance

| Metric | Target | Measured | Device |
|---|---|---|---|
| First load (4G) | under 3 s | | |
| Frame rate, marker scene | 30 fps or better | | |
| Frame rate, reef placed | 30 fps or better | | |

## Known limitations

Record anything that does not work on a given device, and the fallback you
built for it. A documented limitation with a fallback earns marks. An
undocumented one loses them.

### Markerless mode on iPhone is rotation-only, and cannot be otherwise

Safari on iOS does not implement the WebXR Device API. There is no
`immersive-ar`, no `immersive-vr`, and no route to ARKit from a web page, and
Apple has published no timeline. Every iPhone therefore takes the `sensor-ar`
fallback in `js/xr-scene.js`, which reconstructs as much of the pipeline as the
browser will allow:

| WebXR gives | The sensor fallback gives |
|---|---|
| Six degrees of freedom from visual-inertial SLAM | Three: orientation only |
| Real plane detection by hit-test | A ground plane assumed at y = 0, eye height 1.4 m |
| Anchors the runtime re-corrects each frame | A fixed world position, yaw held by the magnetometer |

The consequence, which is inherent and not a bug: **the reef holds its place
when the phone turns, but follows the user if they walk.** Translation is not
tracked, and cannot be — integrating the accelerometer twice drifts by metres
within seconds, which is precisely the problem SLAM exists to solve. The app
states this in the gate copy before the session starts and in the HUD, which
reads `rotation only` on this path against `anchored` on the WebXR path.

### The ARKit path, which does anchor properly

Because that ceiling is real, the markerless page also hands the reef to ARKit
rather than pretending the sensor fallback is equivalent. `js/arkit.js` puts an
**Open in ARKit** button on the gate and an **ARKit · 6DoF** button in the HUD.
Both go through `<model-viewer>`, which converts `assets/models/reef-ar.glb` to
USDZ on the fly and launches AR Quick Look — a native viewer built on ARKit.

| | In-page sensor view | ARKit via Quick Look |
|---|---|---|
| Tracking | Rotation only | Full six degrees of freedom |
| Walking around the reef | Reef follows the user | Reef stays put |
| Plane detection | Assumed floor at y = 0 | Real, from ARKit |
| Temperature slider | Live | Fixed at whatever was set before opening |
| Lives in the page | Yes | No — Apple's viewer takes over |

`reef-ar.glb` is the same mesh as `reef.glb` under a baked root transform:
longest edge 1.25 m, base on y = 0, matching what `fit-model` does at runtime
in the scene. The source model is 9 m across and floats 0.68 m above its own
origin, so without it `ar-scale: fixed` would drop a nine-metre reef hovering
in the room. Regenerate it if `fit-model`'s `size` changes.

Test both. The point of the comparison is the report: the same reef, the same
data, one path with visual-inertial SLAM and one without, and the difference
visible on a phone that cannot run WebXR at all.

Note that Chrome and Firefox on iOS will not launch Quick Look from a
generated USDZ — only Safari does. The button says so rather than failing
silently. On Android the same button resolves to Scene Viewer or WebXR.

The remaining in-page option for true SLAM on iOS is a commercial library such
as 8th Wall, which is not a browser API and needs a licence.

### Tuning the sensor path on a device

| URL parameter | Effect |
|---|---|
| `?debug` | Live readout: event type, raw alpha/beta/gamma, compass heading and accuracy, yaw offset, feed and canvas size, computed field of view, reef position |
| `?fov=NN` | Override the assumed lens angle. Raise it if the reef lags behind the floor when panning, lower it if it runs ahead |
| `?arm=0.3` | Sweep the camera through the arc a hand-held phone travels when panning, in metres from the pivot. Off by default |
| `?compass=off` | Disable magnetometer yaw correction, for comparison or where the magnetometer is disturbed |
