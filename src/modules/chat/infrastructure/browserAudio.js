function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export class BrowserAudioPlayer {
  constructor() {
    this.currentAudio = null;
  }

  stop() {
    if (!this.currentAudio) {
      return;
    }
    this.currentAudio.pause();
    this.currentAudio.currentTime = 0;
    this.currentAudio = null;
  }

  play(source) {
    this.stop();
    return new Promise((resolve, reject) => {
      const audio = new Audio(source);
      this.currentAudio = audio;
      audio.onended = () => {
        if (this.currentAudio === audio) {
          this.currentAudio = null;
        }
        resolve();
      };
      audio.onerror = () => {
        if (this.currentAudio === audio) {
          this.currentAudio = null;
        }
        reject(new Error('Audio playback failed.'));
      };
      void audio.play().catch(reject);
    });
  }
}

export class BrowserLiveAudioPlayer {
  constructor() {
    this.audioContext = null;
    this.gainNode = null;
    this.nextStartTime = 0;
    this.activeSources = new Set();
    this.playGeneration = 0;
    this.isTurnDone = false;
    this.onPlaybackDone = null;
  }

  ensureContext(sampleRate = 24000) {
    if (!this.audioContext || this.audioContext.state === 'closed') {
      const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextCtor) {
        return null;
      }
      try {
        this.audioContext = new AudioContextCtor({ sampleRate });
      } catch {
        this.audioContext = new AudioContextCtor();
      }
      this.gainNode = this.audioContext.createGain();
      this.gainNode.gain.value = 0.7;
      this.gainNode.connect(this.audioContext.destination);
      this.nextStartTime = 0;
      this.activeSources.clear();
      this.isTurnDone = false;
    }

    return this.audioContext;
  }

  unlock() {
    const context = this.ensureContext();
    if (context?.state === 'suspended') {
      void context.resume().catch(() => {});
    }
  }

  isPlaying() {
    return this.activeSources.size > 0;
  }

  removeSource(source, generation) {
    this.activeSources.delete(source);
    if (generation !== this.playGeneration) {
      return;
    }

    if (this.activeSources.size === 0 && this.isTurnDone) {
      this.isTurnDone = false;
      this.onPlaybackDone?.();
    }
  }

  playChunk(base64Data, sampleRate = 24000) {
    const context = this.ensureContext(sampleRate);
    if (!context || !this.gainNode || !base64Data) {
      return false;
    }

    if (context.state === 'suspended') {
      void context.resume().catch(() => {});
    }

    if (this.gainNode.gain.value === 0) {
      this.gainNode.gain.value = 0.7;
    }

    const binary = atob(base64Data);
    const byteLength = binary.length - (binary.length % 2);
    const bytes = new Uint8Array(byteLength);
    for (let index = 0; index < byteLength; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }

    const int16 = new Int16Array(bytes.buffer);
    const float32 = new Float32Array(int16.length);
    for (let index = 0; index < int16.length; index += 1) {
      float32[index] = int16[index] / 32768.0;
    }

    const audioBuffer = context.createBuffer(1, float32.length, sampleRate);
    audioBuffer.getChannelData(0).set(float32);

    const source = context.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.gainNode);

    const generation = this.playGeneration;
    const startAt = Math.max(context.currentTime, this.nextStartTime);
    source.start(startAt);
    this.nextStartTime = startAt + audioBuffer.duration;
    this.activeSources.add(source);
    source.onended = () => {
      this.removeSource(source, generation);
    };
    return true;
  }

  markTurnEnd() {
    this.isTurnDone = true;
    if (this.activeSources.size === 0) {
      this.isTurnDone = false;
      this.onPlaybackDone?.();
    }
  }

  stop() {
    this.playGeneration += 1;
    const sources = [...this.activeSources];
    this.activeSources.clear();
    this.nextStartTime = 0;
    this.isTurnDone = false;
    for (const source of sources) {
      try {
        source.onended = null;
        source.stop(0);
        source.disconnect();
      } catch {
        // Ignore stale scheduled source nodes.
      }
    }

    if (this.gainNode) {
      try {
        this.gainNode.gain.value = 0;
      } catch {
        // Ignore closed audio contexts.
      }
    }
  }
}

export class BrowserSpeechSynthesizer {
  stop() {
    window.speechSynthesis?.cancel();
  }

  speak(text, options = {}) {
    const trimmed = text.trim();
    if (!trimmed || !window.speechSynthesis) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      const utterance = new SpeechSynthesisUtterance(trimmed);
      if (options.language) {
        utterance.lang = options.language;
      }
      utterance.pitch = options.pitch ?? 1.08;
      utterance.rate = options.rate ?? 0.92;
      utterance.onend = resolve;
      utterance.onerror = resolve;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
    });
  }
}

export async function repeatSpeech(synthesizer, text, repeatCount, delayMs, options = {}) {
  for (let index = 0; index < repeatCount; index += 1) {
    await synthesizer.speak(text, options);
    if (index < repeatCount - 1 && delayMs > 0) {
      await wait(delayMs);
    }
  }
}

export function createSpeechRecognition({ language, onText, onEnd, onError }) {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) {
    return null;
  }

  const recognition = new Recognition();
  recognition.lang = language;
  recognition.interimResults = false;
  recognition.continuous = true;
  recognition.onresult = (event) => {
    let transcript = '';
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      transcript += event.results[index][0]?.transcript ?? '';
    }
    if (transcript.trim()) {
      onText(transcript);
    }
  };
  recognition.onerror = (event) => {
    onError?.(event.error || 'speech-recognition-error');
  };
  recognition.onend = () => {
    onEnd?.();
  };

  return recognition;
}
