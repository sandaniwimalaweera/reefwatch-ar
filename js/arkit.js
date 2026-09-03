/* ReefWatch AR — ARKit hand-off

   The sensor fallback in js/xr-scene.js tracks rotation only, for
   the reasons set out there. ARKit is still reachable on iOS, but
   only by handing the model to the operating system: AR Quick Look
   is a native viewer built on ARKit, and Safari launches it for a
   link marked `rel="ar"` pointing at a USDZ. Inside it the reef
   gets visual-inertial SLAM, real plane detection and world
   anchoring — so walking around the reef works.

   The cost is that Quick Look is Apple's viewer, not this page.
   The temperature control cannot live inside it, so the reef is
   exported at whatever temperature the page is showing when the
   button is pressed. Change the slider, open it again.

   <model-viewer> does the export rather than hand-rolled USDZ. It
   converts the GLB on the fly for Safari and picks Scene Viewer or
   WebXR on Android, so one button covers every device that has
   native AR at all. On Chrome and Firefox for iOS a generated USDZ
   does not launch at all; the button reports that rather than
   appearing to do nothing. */

(function () {
  'use strict';

  const VIEWER_SRC =
    'https://ajax.googleapis.com/ajax/libs/model-viewer/3.5.0/model-viewer.min.js';

  /* The reef's single material is untextured — `baseColorFactor` is
     the colour, so the same bleaching curve the scene uses can be
     reproduced exactly by writing that factor.

     glTF factors are linear, while `bleachable` works in the sRGB
     values written in the source. #FFF6EC converted once here rather
     than at every slider movement. */
  const BONE = [1.0, 0.9215, 0.8437];

  /* Published before the capability checks below, because the page
     calls setBleach on every slider movement whether or not this
     device has anything to hand off to. The real implementations
     replace these once there is a model to act on. */
  const api = {
    ready: false,
    supported: false,
    reason: null,
    bleach: 0,
    setBleach: function (amount) { api.bleach = amount; },
    launch: function () { return false; }
  };
  window.ReefARKit = api;

  /* Quick Look needs Safari on iOS; Scene Viewer needs Android with
     Google Play Services for AR. `canActivateAR` on the element is
     the honest answer for both, but it is only meaningful once the
     component has upgraded, so the coarse check runs first and the
     element confirms it. */

  const ua = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua) ||
                (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/.test(ua);

  // Chrome, Firefox and Edge on iOS are Safari underneath but do not
  // launch Quick Look from a generated USDZ.
  const isIOSNonSafari = isIOS && /CriOS|FxiOS|EdgiOS/.test(ua);

  if (!isIOS && !isAndroid) {
    api.reason = 'Native AR is only available on a phone or tablet.';
    return;
  }
  if (isIOSNonSafari) {
    api.reason = 'Open this page in Safari to use ARKit.';
    return;
  }

  /* model-viewer has to have loaded the model before it can convert
     it, and it will not load while it has no layout box, so it is
     kept a single transparent pixel rather than display:none. */

  /* reef-ar.glb, not reef.glb. The source model is 9 m across and
     floats 0.68 m above its own origin; in the scene `fit-model`
     normalises that at runtime, but Quick Look gets the file as it
     is. reef-ar.glb is the same mesh under a root transform that
     applies the identical rule — longest edge 1.25 m, base on y = 0
     — so `ar-scale: fixed` puts a reef of the right size on the
     floor rather than a nine-metre one hovering in the room.
     Regenerate it if fit-model's size changes. */
  const viewer = document.createElement('model-viewer');
  viewer.setAttribute('src', 'assets/models/reef-ar.glb');
  viewer.setAttribute('ar', '');
  viewer.setAttribute('ar-modes', 'webxr scene-viewer quick-look');
  viewer.setAttribute('ar-placement', 'floor');
  viewer.setAttribute('ar-scale', 'fixed');     // real size, not resizable
  viewer.setAttribute('loading', 'eager');
  viewer.setAttribute('reveal', 'auto');
  viewer.setAttribute('camera-controls', '');
  viewer.setAttribute('shadow-intensity', '1');
  viewer.setAttribute('alt', 'A section of coral reef');
  viewer.className = 'arkit-viewer';
  document.body.appendChild(viewer);

  /* Materials are read once the model is loaded, so the original
     colour is known before anything bleaches it. */
  let material = null;
  let baseColor = null;
  let baseRough = 0.8;
  let baseMetal = 0.0;

  viewer.addEventListener('load', () => {
    const materials = viewer.model && viewer.model.materials;
    if (!materials || !materials.length) return;

    material = materials[0];
    const pbr = material.pbrMetallicRoughness;
    baseColor = pbr.baseColorFactor.slice(0, 3);
    baseRough = pbr.roughnessFactor;
    baseMetal = pbr.metallicFactor;

    api.ready = true;
    applyBleach();
    announce();
  });

  viewer.addEventListener('error', (ev) => {
    api.reason = 'The reef model could not be prepared for ARKit.';
    document.dispatchEvent(new CustomEvent('arkit-status', { detail: api }));
    console.warn('[arkit] model-viewer failed', ev);
  });

  function announce () {
    // `canActivateAR` is false until the component knows the device
    // has a viewer it can hand off to.
    api.supported = !!viewer.canActivateAR;
    if (!api.supported && !api.reason) {
      api.reason = isAndroid
        ? 'This device does not have Google Play Services for AR.'
        : 'This device cannot open AR Quick Look.';
    }
    document.dispatchEvent(new CustomEvent('arkit-status', { detail: api }));
  }

  /* The same curve as the `bleachable` component: colour lerped
     toward bone, roughness up as living tissue turns to chalk,
     metalness down. Kept in step so the reef the user sends to
     ARKit is the reef they were just looking at. */

  function applyBleach () {
    if (!material || !baseColor) return;

    const t = Math.min(1, Math.max(0, api.bleach));
    const pbr = material.pbrMetallicRoughness;

    pbr.setBaseColorFactor([
      baseColor[0] + (BONE[0] - baseColor[0]) * t,
      baseColor[1] + (BONE[1] - baseColor[1]) * t,
      baseColor[2] + (BONE[2] - baseColor[2]) * t,
      1
    ]);
    pbr.setRoughnessFactor(baseRough + (0.95 - baseRough) * t);
    pbr.setMetallicFactor(baseMetal * (1 - t));
  }

  api.setBleach = function (amount) {
    api.bleach = amount;
    applyBleach();
  };

  /* Called straight from the tap. Quick Look is opened by a user
     gesture; putting an await in front of it loses the gesture and
     Safari offers a download instead of the viewer. */

  api.launch = function () {
    if (!viewer.canActivateAR) {
      document.dispatchEvent(new CustomEvent('arkit-status', { detail: api }));
      return false;
    }
    applyBleach();
    viewer.activateAR();
    return true;
  };

  const script = document.createElement('script');
  script.type = 'module';
  script.src = VIEWER_SRC;
  script.onerror = () => {
    api.reason = 'The AR component could not be loaded. Check the connection.';
    document.dispatchEvent(new CustomEvent('arkit-status', { detail: api }));
  };
  document.head.appendChild(script);

  // Custom elements upgrade asynchronously; the load event above is
  // the real signal, this only catches a device that can hand off
  // before the model has finished arriving.
  if (window.customElements) {
    customElements.whenDefined('model-viewer').then(announce);
  }
})();
