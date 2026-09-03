/* ReefWatch AR — shared interface behaviour

   Asset loading feedback and the credits sheet. Used by both
   scenes. The audio button and the interface sounds wire
   themselves in js/ambience.js, so that they also work on the
   landing page, which loads none of this. */

(function () {
  'use strict';

  /* A-Frame blocks the scene until every a-asset-item resolves.
     On mobile data that is a few seconds of nothing, which reads
     as a broken page — so report progress and only then reveal
     the scene. */
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

  /* Snapping shrimp and fish leave a dying reef, so the soundscape
     thins out with the colour. The toggle itself lives in
     js/ambience.js; this is only the link from the scene's state
     to the sound. */
  function setupAudio () {
    const scene = document.querySelector('a-scene');
    if (!scene || !window.ReefAudio) return;

    scene.addEventListener('temperature-change', (ev) => {
      window.ReefAudio.setHealth(1 - ev.detail.bleach);
    });

    scene.addEventListener('reef-bleach-progress', (ev) => {
      window.ReefAudio.setHealth(1 - ev.detail.amount);
    });

    /* The two taps that are not buttons: dropping the reef onto a
       surface, and tapping the coral itself to bleach it. Both are
       aimed at the world rather than at a control, so the delegated
       handler in js/ambience.js never sees them. */
    scene.addEventListener('reef-placed', () => window.ReefAudio.sfx('place'));
    scene.addEventListener('reef-state-change', () => window.ReefAudio.sfx('tap'));
  }

  /* Open-Meteo data is CC BY 4.0 and the models are CC-BY, so
     attribution has to be reachable from inside the app itself,
     not only from the repository. */
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
