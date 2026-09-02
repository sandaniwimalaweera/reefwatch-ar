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

Where genuine six-degree-of-freedom placement is needed on iOS, the routes are
AR Quick Look with a `.usdz` export, which hands off to Apple's own viewer and
loses the temperature control, or a commercial SLAM library such as 8th Wall.
Neither is a browser API. The marker page is the stable-tracking path in this
project on any device.

### Tuning the sensor path on a device

| URL parameter | Effect |
|---|---|
| `?debug` | Live readout: event type, raw alpha/beta/gamma, compass heading and accuracy, yaw offset, feed and canvas size, computed field of view, reef position |
| `?fov=NN` | Override the assumed lens angle. Raise it if the reef lags behind the floor when panning, lower it if it runs ahead |
| `?arm=0.3` | Sweep the camera through the arc a hand-held phone travels when panning, in metres from the pivot. Off by default |
| `?compass=off` | Disable magnetometer yaw correction, for comparison or where the magnetometer is disturbed |
