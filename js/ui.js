/* ============================================================
   ReefWatch AR — shared interface behaviour

   Asset loading feedback, the ambience toggle, and the credits
   sheet. Used by both scenes.
   ============================================================ */

(function () {
  'use strict';

  /* ------------------------------------------------------------
     Loading progress

     A-Frame blocks the scene until every a-asset-item resolves.
     On mobile data that is a few seconds of nothing, which reads
     as a broken page — so report progress and only then reveal
     the scene.
     ------------------------------------------------------------ */
  function setupLoader () {
    const loader = document.getElementById('loader');
    if (!loader) return;

    const fill  = loader.querySelector('.loader-fill');
    const label = loader.querySelector('.loader-label');
    const assets = document.querySelector('a-assets');

    const finish = () => {
      fill.style.width = '100%';
      label.textContent = 'Ready';
      setTimeout(() => loader.classList.add('is-done'), 260);
    };

    if (!assets) { finish(); return; }

    const items = Array.from(assets.querySelectorAll('a-asset-item, img, audio'));
    const total = items.length;

    if (total === 0) { finish(); return; }

    let done = 0;
    const step = () => {
      done += 1;
      const pct = Math.round((done / total) * 100);
      fill.style.width = pct + '%';
      label.textContent = 'Loading ' + pct + '%';
    };

    items.forEach((item) => {
      if (item.hasLoaded) { step(); return; }
      item.addEventListener('loaded', step, { once: true });
      // A missing asset must not leave the loader stuck forever.
      item.addEventListener('error', step, { once: true });
    });

    if (assets.hasLoaded) {
      finish();
    } else {
      assets.addEventListener('loaded', finish, { once: true });
    }

    // Hard ceiling: whatever happens, never trap the user behind
    // the loading screen.
    setTimeout(finish, 12000);
  }

  /* ------------------------------------------------------------
     Ambience toggle
     Audio starts muted. Browsers block autoplay without a
     gesture, and unexpected sound is hostile anyway.
     ------------------------------------------------------------ */
  function setupAudio () {
    const btn = document.getElementById('audio');
    if (!btn || !window.ReefAmbience) return;

    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();   // must not also place the reef
      window.ReefAmbience.toggle().then((on) => {
        btn.classList.toggle('is-on', on);
        btn.setAttribute('aria-label', on ? 'Mute ambience' : 'Play ambience');
      }).catch(() => {
        btn.disabled = true;
        btn.title = 'Audio is unavailable on this device';
      });
    });

    // The reef gets quieter as it bleaches — snapping shrimp and
    // fish leave a dying reef, so the soundscape thins out.
    const scene = document.querySelector('a-scene');
    if (!scene) return;

    scene.addEventListener('temperature-change', (ev) => {
      window.ReefAmbience.setHealth(1 - ev.detail.bleach);
    });

    scene.addEventListener('reef-bleach-progress', (ev) => {
      window.ReefAmbience.setHealth(1 - ev.detail.amount);
    });
  }

  /* ------------------------------------------------------------
     Credits sheet
     Open-Meteo data is CC BY 4.0 and the models are CC-BY, so
     attribution has to be reachable from inside the app itself,
     not only from the repository.
     ------------------------------------------------------------ */
  function setupCredits () {
    const sheet = document.getElementById('credits');
    if (!sheet) return;

    const open  = document.getElementById('creditsOpen');
    const close = sheet.querySelector('.credits-close');

    if (open) {
      open.addEventListener('click', (ev) => {
        ev.stopPropagation();
        sheet.classList.add('is-open');
      });
    }

    const hide = (ev) => {
      if (ev) ev.stopPropagation();
      sheet.classList.remove('is-open');
    };

    if (close) close.addEventListener('click', hide);

    sheet.addEventListener('click', (ev) => {
      if (ev.target === sheet) hide(ev);
    });

    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') hide();
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    setupLoader();
    setupAudio();
    setupCredits();
  });

})();
