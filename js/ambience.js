/* ============================================================
   ReefWatch AR — underwater ambience

   Synthesised with the Web Audio API rather than streamed from
   an audio file. Three reasons: no extra download on a mobile
   connection, no third-party licence to track, and the sound can
   respond to the reef's state — a bleached reef genuinely does
   go quieter, because the fish and snapping shrimp leave.

   Signal chain:
     white noise  → lowpass  → the muffled body of water
     slow LFO     → filter Q → swell and surge
     random burst → bandpass → snapping shrimp and bubbles
   ============================================================ */

(function (global) {
  'use strict';

  function Ambience () {
    this.ctx = null;
    this.running = false;
    this.health = 1;      // 1 = living reef, 0 = bleached
  }

  /* A short buffer of white noise, looped. Cheaper than
     generating noise per-sample in a ScriptProcessor. */
  Ambience.prototype._noiseBuffer = function () {
    const seconds = 3;
    const rate = this.ctx.sampleRate;
    const buffer = this.ctx.createBuffer(1, rate * seconds, rate);
    const data = buffer.getChannelData(0);

    // Brown-ish noise: integrating white noise tilts the spectrum
    // downward, which is much closer to how water actually sounds.
    let last = 0;
    for (let i = 0; i < data.length; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.5;
    }
    return buffer;
  };

  Ambience.prototype.start = function () {
    if (this.running) return Promise.resolve();

    const AudioCtx = global.AudioContext || global.webkitAudioContext;
    if (!AudioCtx) return Promise.reject(new Error('Web Audio not supported'));

    this.ctx = new AudioCtx();

    const ctx = this.ctx;
    const master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);
    this.master = master;

    /* --- body of water --- */
    const noise = ctx.createBufferSource();
    noise.buffer = this._noiseBuffer();
    noise.loop = true;

    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = 520;
    lowpass.Q.value = 0.7;

    const bodyGain = ctx.createGain();
    bodyGain.gain.value = 0.55;

    noise.connect(lowpass);
    lowpass.connect(bodyGain);
    bodyGain.connect(master);
    noise.start();

    this.lowpass = lowpass;

    /* --- surge: a slow sweep of the cutoff --- */
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.07;          // one swell every ~14 seconds

    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 190;

    lfo.connect(lfoDepth);
    lfoDepth.connect(lowpass.frequency);
    lfo.start();

    /* --- reef crackle: sparse filtered clicks --- */
    this.crackleGain = ctx.createGain();
    this.crackleGain.gain.value = 0.5;
    this.crackleGain.connect(master);

    this._scheduleCrackle();

    // Fade in rather than snapping on.
    master.gain.linearRampToValueAtTime(0.0, ctx.currentTime);
    master.gain.linearRampToValueAtTime(0.5, ctx.currentTime + 1.6);

    this.running = true;

    // Autoplay policy: the context may start suspended even when
    // created inside a gesture handler on some browsers.
    if (ctx.state === 'suspended') return ctx.resume();
    return Promise.resolve();
  };

  /* Snapping shrimp are the loudest thing on a healthy reef and
     among the first sounds to vanish when one dies. Scheduling
     them at a rate tied to reef health makes the bleaching
     audible as well as visible. */
  Ambience.prototype._scheduleCrackle = function () {
    if (!this.ctx) return;

    const ctx = this.ctx;
    const gap = 0.04 + Math.random() * (0.5 + (1 - this.health) * 2.5);

    this._crackleTimer = setTimeout(() => {
      if (!this.running) return;

      if (Math.random() < this.health) {
        const osc = ctx.createOscillator();
        const env = ctx.createGain();
        const band = ctx.createBiquadFilter();

        band.type = 'bandpass';
        band.frequency.value = 1800 + Math.random() * 2600;
        band.Q.value = 6;

        osc.type = 'square';
        osc.frequency.value = 200 + Math.random() * 900;

        const t = ctx.currentTime;
        env.gain.setValueAtTime(0.0001, t);
        env.gain.exponentialRampToValueAtTime(0.05 + Math.random() * 0.06, t + 0.002);
        env.gain.exponentialRampToValueAtTime(0.0001, t + 0.03 + Math.random() * 0.04);

        osc.connect(band);
        band.connect(env);
        env.connect(this.crackleGain);

        osc.start(t);
        osc.stop(t + 0.1);
      }

      this._scheduleCrackle();
    }, gap * 1000);
  };

  /* Called as the reef bleaches: 1 = healthy, 0 = fully bleached. */
  Ambience.prototype.setHealth = function (health) {
    this.health = Math.min(1, Math.max(0, health));
    if (!this.running) return;

    const t = this.ctx.currentTime;

    // A dying reef sounds duller and emptier.
    if (this.crackleGain) {
      this.crackleGain.gain.setTargetAtTime(0.5 * this.health, t, 1.2);
    }
    if (this.lowpass) {
      this.lowpass.frequency.setTargetAtTime(300 + 220 * this.health, t, 1.5);
    }
  };

  Ambience.prototype.stop = function () {
    if (!this.running) return;
    this.running = false;
    clearTimeout(this._crackleTimer);

    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(0, t, 0.3);

    setTimeout(() => {
      if (this.ctx) this.ctx.close();
      this.ctx = null;
    }, 900);
  };

  Ambience.prototype.toggle = function () {
    return this.running ? (this.stop(), Promise.resolve(false))
                        : this.start().then(() => true);
  };

  global.ReefAmbience = new Ambience();

})(window);
