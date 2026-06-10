class SoundEngine {
  private ctx: AudioContext | null = null;
  private _muted: boolean = localStorage.getItem("kiroku_sound_muted") === "1";

  get muted() { return this._muted; }

  setMuted(v: boolean) {
    this._muted = v;
    localStorage.setItem("kiroku_sound_muted", v ? "1" : "0");
  }

  private init() {
    if (!this.ctx) {
      try {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioContextClass) {
          this.ctx = new AudioContextClass();
        }
      } catch (err) {
        console.warn("Web Audio API not supported", err);
      }
    }
    // Resume if suspended (browser security policies)
    if (this.ctx && this.ctx.state === "suspended") {
      this.ctx.resume().catch((e) => console.log("Failed to resume context", e));
    }
  }

  playCorrect() {
    if (this._muted) return;
    this.init();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    // A beautiful double high-pitch coin hit sound
    const osc1 = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc1.type = "sine";
    osc2.type = "sine";

    osc1.frequency.setValueAtTime(523.25, now); // C5
    osc1.frequency.setValueAtTime(783.99, now + 0.08); // G5

    osc2.type = "triangle";
    osc2.frequency.setValueAtTime(1046.50, now + 0.08); // C6

    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(this.ctx.destination);

    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + 0.3);
    osc2.stop(now + 0.3);
  }

  playIncorrect() {
    if (this._muted) return;
    this.init();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();

    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(160, now);
    osc.frequency.linearRampToValueAtTime(100, now + 0.22);

    filter.type = "lowpass";
    filter.frequency.setValueAtTime(320, now);

    gain.gain.setValueAtTime(0.1, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(now);
    osc.stop(now + 0.25);
  }

  playTick() {
    if (this._muted) return;
    this.init();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(650, now);

    gain.gain.setValueAtTime(0.04, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(now);
    osc.stop(now + 0.05);
  }

  playCharacter(char: string) {
    if (this._muted) return;
    if (typeof window !== "undefined" && window.speechSynthesis) {
      try {
        // Cancel any ongoing speaking
        window.speechSynthesis.cancel();
        
        const utterance = new SpeechSynthesisUtterance(char);
        utterance.lang = "ja-JP";
        utterance.rate = 0.8; // Friendly, paced learning rate
        utterance.volume = 0.95;
        
        // Find Japanese voice if available to improve accuracy, otherwise fallback to default
        const voices = window.speechSynthesis.getVoices();
        const jaVoice = voices.find((v) => v.lang.startsWith("ja") || v.lang === "ja-JP");
        if (jaVoice) {
          utterance.voice = jaVoice;
        }
        
        window.speechSynthesis.speak(utterance);
      } catch (err) {
        console.warn("Could not execute speech synthesis", err);
      }
    }
  }

  playFanfare() {
    if (this._muted) return;
    this.init();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    const notes = [261.63, 329.63, 392.00, 523.25, 659.25]; // C4, E4, G4, C5, E5
    notes.forEach((freq, idx) => {
      const osc = this.ctx!.createOscillator();
      const gain = this.ctx!.createGain();

      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, now + idx * 0.08);

      gain.gain.setValueAtTime(0.1, now + idx * 0.08);
      gain.gain.setValueAtTime(0.1, now + idx * 0.08 + 0.12);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.08 + 0.3);

      osc.connect(gain);
      gain.connect(this.ctx!.destination);

      osc.start(now + idx * 0.08);
      osc.stop(now + idx * 0.08 + 0.35);
    });
  }
}

export const sound = new SoundEngine();
export default sound;
