/* ReefWatch AR — audio

   One AudioContext for the whole app, feeding two things:

     the ambience — a synthesised underwater bed
     the interface — a short water sound on every tap

   Synthesised with the Web Audio API rather than streamed from
   files. No extra download on a mobile connection, no third-party
   licence to track, and the bed can respond to the reef's state:
   a bleached reef genuinely does go quieter, because the fish and
   the snapping shrimp leave.

   Signal chain

       body ┐
      surge ├─ bed bus ─┐
    bubbles │           ├─→ dry ─────────────────┐
    crackle ┘           │                        ├─→ limiter → out
                        └─→ send ┐               │
              sfx bus ───────────┴─→ convolver ──┘

   The convolver's impulse response is generated here as well:
   noise that decays exponentially and darkens as it goes, because
   water absorbs high frequencies far faster than low ones. That
   one filter is most of the difference between "underwater" and
   "static". */

(function (global) {
  'use strict';

  /* Whether the bed is wanted survives a page change, so the
     ambience carries across the landing page and both scenes
     instead of restarting from silence each time.

     The key is versioned: the previous one collected a lot of
     spurious "off" values, because a first tap on the speaker used
     to both arm the bed and then immediately toggle it back off.
     Those readers had silence saved for them and never asked for
     it, so v2 starts them from the default again. */
  var KEY = 'reefwatch:ambience:v2';

  function readPref () {
    try { return global.localStorage.getItem(KEY) !== 'off'; }
    catch (err) { return true; }          // private mode: default on
  }

  function writePref (on) {
    try { global.localStorage.setItem(KEY, on ? 'on' : 'off'); }
    catch (err) { /* nothing to do, the session still works */ }
  }

  function ReefAudio () {
    this.ctx = null;
    this.built = false;
    this.running = false;       // is the bed audible
    this.wanted = readPref();   // does the user want it audible
    this.health = 1;            // 1 = living reef, 0 = bleached
    this.lastSfx = 0;
  }

  ReefAudio.prototype._ensure = function () {
    if (this.built) return true;

    var AudioCtx = global.AudioContext || global.webkitAudioContext;
    if (!AudioCtx) return false;

    try { this.ctx = new AudioCtx(); }
    catch (err) { return false; }

    var ctx = this.ctx;

    /* iOS routes Web Audio through the "ambient" session, which the
       hardware silent switch mutes. Declaring playback intent moves
       it to a session that ignores the switch. Safari 16.4+ only. */
    try {
      if (global.navigator.audioSession) {
        global.navigator.audioSession.type = 'playback';
      }
    } catch (err) { /* audio still plays with the switch off */ }

    /* A limiter on the end. Bubbles and taps are transients on top
       of a continuous bed, and without one a tap during a swell
       clips on a phone speaker. */
    var out = ctx.createDynamicsCompressor();
    out.threshold.value = -16;
    out.knee.value      = 22;
    out.ratio.value     = 8;
    out.attack.value    = 0.004;
    out.release.value   = 0.22;
    out.connect(ctx.destination);

    this.dry = ctx.createGain();
    this.dry.connect(out);

    this.verb = ctx.createConvolver();
    this.verb.buffer = this._impulse(2.8);

    var wet = ctx.createGain();
    wet.gain.value = 0.7;
    this.verb.connect(wet);
    wet.connect(out);

    /* Two buses, because muting the ambience must not also mute the
       interface. Someone who turns the reef quiet still needs to
       hear that their tap registered. */
    this.bed = ctx.createGain();
    this.bed.gain.value = 0;
    this.bed.connect(this.dry);
    this._send(this.bed, 0.30);

    this.ui = ctx.createGain();
    this.ui.gain.value = 0.9;
    this.ui.connect(this.dry);
    this._send(this.ui, 0.42);

    this.noiseBuf = this._noise(4);

    this.built = true;
    this._buildBed();
    return true;
  };

  ReefAudio.prototype._send = function (node, amount) {
    var g = this.ctx.createGain();
    g.gain.value = amount;
    node.connect(g);
    g.connect(this.verb);
  };

  /* Brown noise: integrating white noise tilts the spectrum
     downward, which is much closer to how water actually sounds.
     Four seconds is long enough that the loop point is inaudible. */
  ReefAudio.prototype._noise = function (seconds) {
    var rate = this.ctx.sampleRate;
    var buf  = this.ctx.createBuffer(1, Math.floor(rate * seconds), rate);
    var d    = buf.getChannelData(0);
    var last = 0;

    for (var i = 0; i < d.length; i++) {
      var white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      d[i] = last * 3.2;
    }
    return buf;
  };

  /* Decaying noise, lowpassed harder the further into the tail it
     gets. The one-pole coefficient closes from 0.4 to 0.05 across
     the decay, so the reverb starts bright and ends as a low, soft
     wash — which is what a room full of water sounds like, and what
     a dry room does not. */
  ReefAudio.prototype._impulse = function (seconds) {
    var rate = this.ctx.sampleRate;
    var len  = Math.floor(rate * seconds);
    var buf  = this.ctx.createBuffer(2, len, rate);

    for (var ch = 0; ch < 2; ch++) {
      var d = buf.getChannelData(ch);
      var last = 0;
      for (var i = 0; i < len; i++) {
        var t = i / len;
        var k = 0.4 - 0.35 * t;
        last += k * ((Math.random() * 2 - 1) - last);
        d[i] = last * Math.pow(1 - t, 2.4);
      }
    }
    return buf;
  };

  /* Built once and left running for the life of the page. Muting
     ramps the bus, it does not tear the graph down: rebuilding
     these nodes on every toggle is audible as a click, and on iOS
     it risks a context that never resumes. */
  ReefAudio.prototype._buildBed = function () {
    var ctx = this.ctx;

    var noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuf;
    noise.loop = true;
    noise.start();

    /* the body of water: low, wide, always there */
    var body = ctx.createBiquadFilter();
    body.type = 'lowpass';
    body.frequency.value = 340;
    body.Q.value = 0.5;

    var bodyGain = ctx.createGain();
    bodyGain.gain.value = 0.9;

    noise.connect(body);
    body.connect(bodyGain);
    bodyGain.connect(this.bed);
    this.body = body;

    /* A slow sweep of the cutoff. One swell every twenty seconds
       or so — slower than it seems it should be, because a swell
       you can consciously count is a swell you notice, and an
       ambience you notice is an ambience that grates. */
    var drift = ctx.createOscillator();
    drift.frequency.value = 0.048;
    var driftDepth = ctx.createGain();
    driftDepth.gain.value = 110;
    drift.connect(driftDepth);
    driftDepth.connect(body.frequency);
    drift.start();

    /* surge: a narrower voice that breathes over the top */
    var surge = ctx.createBiquadFilter();
    surge.type = 'bandpass';
    surge.frequency.value = 200;
    surge.Q.value = 1.3;

    var surgeGain = ctx.createGain();
    surgeGain.gain.value = 0.5;          // centre of the swing

    noise.connect(surge);
    surge.connect(surgeGain);
    surgeGain.connect(this.bed);

    var swell = ctx.createOscillator();
    swell.frequency.value = 0.031;       // deliberately not a factor of
    var swellDepth = ctx.createGain();   // the cutoff sweep, so the two
    swellDepth.gain.value = 0.45;        // never line up the same way twice
    swell.connect(swellDepth);
    swellDepth.connect(surgeGain.gain);
    swell.start();

    /* the weight of deep water */
    var droneGain = ctx.createGain();
    droneGain.gain.value = 0.045;
    droneGain.connect(this.bed);
    this.droneGain = droneGain;

    [98, 147].forEach(function (hz, n) {       // a fifth apart
      var osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = hz;

      /* A pair of perfectly steady sines reads as a mains hum. A
         slow, tiny wander in the pitch reads as water moving. */
      var vib = ctx.createOscillator();
      vib.frequency.value = 0.07 + n * 0.03;
      var vibDepth = ctx.createGain();
      vibDepth.gain.value = 0.6;
      vib.connect(vibDepth);
      vibDepth.connect(osc.frequency);
      vib.start();

      osc.connect(droneGain);
      osc.start();
    });

    /* snapping shrimp */
    this.crackle = ctx.createGain();
    this.crackle.gain.value = 1;
    this.crackle.connect(this.bed);

    /* bubbles */
    this.bubbles = ctx.createGain();
    this.bubbles.gain.value = 1;
    this.bubbles.connect(this.bed);
  };

  /* Snapping shrimp are the loudest thing on a healthy reef and
     among the first to vanish when one dies, so scheduling them at
     a rate tied to reef health makes the bleaching audible as well
     as visible.

     Filtered noise, not the square wave this used to use. A square
     wave through a bandpass is a pitched blip; real snaps are
     broadband and have no pitch at all, and hearing twenty pitched
     ones a second is what made the old bed sound like interference. */
  ReefAudio.prototype._scheduleCrackle = function () {
    var self = this;
    var gap = 0.05 + Math.random() * (0.45 + (1 - this.health) * 2.5);

    this._crackleTimer = setTimeout(function () {
      if (!self.running) return;
      if (Math.random() < self.health) self._snap();
      self._scheduleCrackle();
    }, gap * 1000);
  };

  ReefAudio.prototype._snap = function () {
    var ctx = this.ctx, t = ctx.currentTime;

    var src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;

    var band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 2200 + Math.random() * 3400;
    band.Q.value = 1.8;

    var env = ctx.createGain();
    var peak = 0.05 + Math.random() * 0.07;
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(peak, t + 0.0015);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.02 + Math.random() * 0.03);

    src.connect(band);
    band.connect(env);
    env.connect(this.crackle);

    // Read from a random point so successive snaps are not identical.
    src.start(t, Math.random() * (this.noiseBuf.duration - 0.2), 0.09);
  };

  /* A bubble is a rising sine. The pitch climbs because the bubble
     grows as it rises and the pressure around it drops — the sound
     everyone recognises as underwater without being able to say
     why, and the thing the old bed was missing entirely. */
  ReefAudio.prototype._scheduleBubbles = function () {
    var self = this;
    var gap = 2.2 + Math.random() * 6.5 + (1 - this.health) * 5;

    this._bubbleTimer = setTimeout(function () {
      if (!self.running) return;

      // Bubbles come in streams more often than singly.
      var n = 1 + Math.floor(Math.random() * 4);
      for (var i = 0; i < n; i++) {
        self._bubble(i * (0.05 + Math.random() * 0.11));
      }
      self._scheduleBubbles();
    }, gap * 1000);
  };

  ReefAudio.prototype._bubble = function (delay) {
    var ctx = this.ctx, t = ctx.currentTime + (delay || 0);
    var f0  = 230 + Math.random() * 420;
    var dur = 0.05 + Math.random() * 0.09;

    var osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(f0 * (2.1 + Math.random() * 1.4), t + dur);

    var env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(0.045 + Math.random() * 0.05, t + 0.006);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur * 1.7);

    osc.connect(env);
    env.connect(this.bubbles);
    osc.start(t);
    osc.stop(t + dur * 2 + 0.05);
  };

  /* The same droplet at six pitches rather than six unrelated sounds.
     An interface that chimes in a different timbre on every press
     stops belonging to the reef very quickly. */
  var SFX = {
    tap:  { from: 520, to: 1180, dur: 0.09, gain: 0.10 },
    open: { from: 400, to: 1000, dur: 0.13, gain: 0.11 },
    back: { from: 760, to:  380, dur: 0.12, gain: 0.09 },
    on:   { from: 460, to: 1320, dur: 0.15, gain: 0.11 },
    off:  { from: 900, to:  330, dur: 0.15, gain: 0.09 },
    // Landing a reef on the floor is the one moment that earns a
    // heavier sound than a button press.
    place:{ from: 280, to:  820, dur: 0.24, gain: 0.14 }
  };

  ReefAudio.prototype.sfx = function (name) {
    if (!this._ensure()) return;

    var spec = SFX[name] || SFX.tap;
    var ctx  = this.ctx;
    var now  = ctx.currentTime;

    // A drag across several controls must not machine-gun.
    if (now - this.lastSfx < 0.05) return;
    this.lastSfx = now;

    if (ctx.state === 'suspended') ctx.resume().catch(function () {});

    var osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(spec.from, now);
    osc.frequency.exponentialRampToValueAtTime(spec.to, now + spec.dur);

    var env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, now);
    env.gain.exponentialRampToValueAtTime(spec.gain, now + 0.005);
    env.gain.exponentialRampToValueAtTime(0.0001, now + spec.dur * 1.5);

    osc.connect(env);
    env.connect(this.ui);
    osc.start(now);
    osc.stop(now + spec.dur * 2);

    /* A breath of noise under the attack. The sine alone is clean
       to the point of sounding synthetic; this gives the onset the
       edge a real droplet has. */
    var tick = ctx.createBufferSource();
    tick.buffer = this.noiseBuf;

    var hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1400;

    var tickEnv = ctx.createGain();
    tickEnv.gain.setValueAtTime(0.0001, now);
    tickEnv.gain.exponentialRampToValueAtTime(spec.gain * 0.35, now + 0.002);
    tickEnv.gain.exponentialRampToValueAtTime(0.0001, now + 0.03);

    tick.connect(hp);
    hp.connect(tickEnv);
    tickEnv.connect(this.ui);
    tick.start(now, Math.random() * (this.noiseBuf.duration - 0.2), 0.05);
  };

  /* The button has to show whether the bed is *audible*, not just
     whether it is wanted, and the bed can become audible without
     the button being touched — the first tap anywhere on the page
     starts it. Broadcast the change so the button can repaint. */
  ReefAudio.prototype._announce = function () {
    try {
      global.dispatchEvent(new CustomEvent('reef-audio-state', {
        detail: { wanted: this.wanted, running: this.running }
      }));
    } catch (err) { /* the button still repaints on its own taps */ }
  };

  ReefAudio.prototype.start = function () {
    if (!this._ensure()) return Promise.reject(new Error('Web Audio not supported'));

    var ctx = this.ctx;

    /* iOS keeps a context suspended until a zero-length buffer has
       been played from inside a user gesture. Harmless elsewhere. */
    if (!this._unlocked) {
      this._unlocked = true;
      var u = ctx.createBufferSource();
      u.buffer = ctx.createBuffer(1, 1, 22050);
      u.connect(ctx.destination);
      u.start(0);
    }

    if (!this.running) {
      this.running = true;
      this._scheduleCrackle();
      this._scheduleBubbles();
    }

    // Fade in over a couple of seconds rather than snapping on.
    this.bed.gain.cancelScheduledValues(ctx.currentTime);
    this.bed.gain.setValueAtTime(this.bed.gain.value, ctx.currentTime);
    this.bed.gain.linearRampToValueAtTime(0.55, ctx.currentTime + 2.0);

    this.setHealth(this.health);

    this._announce();

    // Resuming a running context is a no-op; iOS can suspend one
    // immediately after creation even inside a gesture.
    return ctx.resume().catch(function () {});
  };

  ReefAudio.prototype.stop = function () {
    if (!this.running) return;
    this.running = false;
    clearTimeout(this._crackleTimer);
    clearTimeout(this._bubbleTimer);

    var t = this.ctx.currentTime;
    this.bed.gain.cancelScheduledValues(t);
    this.bed.gain.setValueAtTime(this.bed.gain.value, t);
    this.bed.gain.linearRampToValueAtTime(0, t + 0.5);
    this._announce();
    // The context stays open: the interface still has to make a sound.
  };

  ReefAudio.prototype.toggle = function () {
    this.wanted = !this.wanted;
    writePref(this.wanted);

    if (this.wanted) return this.start().then(function () { return true; });
    this.stop();
    return Promise.resolve(false);
  };

  /* Called as the reef bleaches: 1 = healthy, 0 = fully bleached. */
  ReefAudio.prototype.setHealth = function (health) {
    this.health = Math.min(1, Math.max(0, health));
    if (!this.built) return;

    var t = this.ctx.currentTime;
    var h = this.health;

    // A dying reef is duller, emptier, and has less going on in it.
    if (this.crackle)   this.crackle.gain.setTargetAtTime(h, t, 1.2);
    if (this.bubbles)   this.bubbles.gain.setTargetAtTime(0.35 + 0.65 * h, t, 1.5);
    if (this.droneGain) this.droneGain.gain.setTargetAtTime(0.02 + 0.025 * h, t, 2.0);
    if (this.body)      this.body.frequency.setTargetAtTime(250 + 130 * h, t, 1.5);
  };

  var audio = new ReefAudio();
  global.ReefAudio = audio;
  global.ReefAmbience = audio;      // the name the scenes already use

  /* The bed is on by default. Where the browser will allow sound
     on load it starts there; where autoplay is blocked it arms
     instead, and the first touch anywhere on the page starts it.
     Either way the preference is remembered, so it carries from
     the landing page into a scene without ever asking again. */
  function arm () {
    var events = ['pointerdown', 'touchstart', 'keydown'];

    var go = function (ev) {
      /* A gesture that lands on the audio button belongs to that
         button. Starting here would turn the very tap meant to
         unmute the page into a mute, which is how a session ends up
         silent and — the preference being remembered — stays that
         way. Leave the arming in place: the button's own handler
         takes this one. */
      if (ev && ev.target && ev.target.closest && ev.target.closest('#audio')) {
        audio._ensure();
        return;
      }

      events.forEach(function (n) { document.removeEventListener(n, go, true); });
      audio._ensure();
      if (audio.wanted && !audio.running) audio.start().catch(function () {});
    };

    events.forEach(function (n) { document.addEventListener(n, go, true); });

    if (!audio.wanted) return;

    /* A page that has already been touched — a reload, or a browser
       that grants this site autoplay from past engagement — can
       start straight away. */
    var activation = global.navigator.userActivation;
    if (activation && activation.hasBeenActive) {
      audio.start().catch(function () {});
      return;
    }

    /* Otherwise ask the browser directly whether it would allow
       sound: a context handed back already `running` needs no
       gesture, and the bed can fade in on load the way it should.
       One that comes back `suspended` is autoplay-blocked, so the
       graph is thrown no further work and the tap handler above
       takes over. Deferred past load so it never competes with
       A-Frame's boot for the main thread. */
    var probe = function () {
      if (audio.running || !audio.wanted) return;
      if (!audio._ensure()) return;
      if (audio.ctx.state === 'running') audio.start().catch(function () {});
    };

    if (document.readyState === 'complete') setTimeout(probe, 0);
    else global.addEventListener('load', function () { setTimeout(probe, 0); });
  }

  /* Delegated rather than bound per button, so a control a scene
     adds at runtime — the ARKit button, the credits sheet — makes
     a sound without having to remember to wire it. */
  var SELECTOR = 'button, a[href], [data-sfx]';

  function soundFor (el) {
    if (el.dataset && el.dataset.sfx) return el.dataset.sfx;

    // Anything that goes back, closes, or leaves falls in pitch.
    if (el.matches('.ar-back, .ar-gate-alt, .credits-close, [data-back]')) return 'back';
    if (el.matches('.mode, .ar-btn, .ar-btn-alt')) return 'open';
    return 'tap';
  }

  function onPress (ev) {
    var el = ev.target.closest && ev.target.closest(SELECTOR);
    if (!el || el.disabled) return;

    // The audio button announces on or off for itself, below.
    if (el.id === 'audio') return;
    audio.sfx(soundFor(el));
  }

  function wireToggle () {
    var btn = document.getElementById('audio');
    if (!btn) return;

    /* Wanted but not yet running is the autoplay-blocked state: the
       page is silent, so the button says silent. */
    var paint = function () {
      var on = audio.wanted && audio.running;
      btn.classList.toggle('is-on', on);
      btn.setAttribute('aria-label', on ? 'Mute ambience' : 'Play ambience');
      btn.setAttribute('aria-pressed', String(on));
    };
    paint();
    global.addEventListener('reef-audio-state', paint);

    btn.addEventListener('click', function (ev) {
      ev.stopPropagation();       // must not also place the reef

      /* Silent because the browser has not allowed sound yet, not
         because the reader asked for silence: this tap is the
         permission, so start rather than toggle. */
      var act = (audio.wanted && !audio.running)
        ? audio.start().then(function () { return true; })
        : audio.toggle();

      act.then(function (on) {
        audio.sfx(on ? 'on' : 'off');
        paint();
      }).catch(function () {
        btn.disabled = true;
        btn.title = 'Audio is unavailable on this device';
      });
    });
  }

  function ready () {
    wireToggle();
    document.addEventListener('pointerdown', onPress, true);
    arm();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ready);
  } else {
    ready();
  }

  /* iOS suspends the context when the page is backgrounded, and
     when the camera stream starts. Resume it when we come back. */
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible') return;
    if (audio.ctx && audio.ctx.state === 'suspended') {
      audio.ctx.resume().catch(function () {});
    }
  });

})(window);
