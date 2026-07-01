function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function getNativeSpeechBridge() {
  const bridge = window.CoWebNativeSpeech;
  if (!bridge || typeof bridge.speak !== 'function') {
    return null;
  }
  return bridge;
}

function getNativeSpeechResolvers() {
  if (!window.__coWebNativeSpeechResolvers) {
    window.__coWebNativeSpeechResolvers = new Map();
  }

  if (typeof window.__coWebNativeSpeechDone !== 'function') {
    window.__coWebNativeSpeechDone = (utteranceId, didSpeak) => {
      const resolver = window.__coWebNativeSpeechResolvers?.get(utteranceId);
      resolver?.(Boolean(didSpeak));
    };
  }

  return window.__coWebNativeSpeechResolvers;
}

function getSpeechTimeoutMs(text) {
  return Math.max(3000, Math.min(90000, 3000 + text.length * 120));
}

function clampSample(value) {
  return Math.max(-1, Math.min(1, value));
}

function encodePcm16Base64(samples) {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < samples.length; index += 1) {
    const clamped = clampSample(samples[index]);
    const value = clamped < 0
      ? Math.round(clamped * 32768)
      : Math.round(clamped * 32767);
    view.setInt16(index * 2, value, true);
  }

  let binary = '';
  const chunkSize = 8192;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function measureSamples(samples) {
  if (!samples.length) {
    return { rms: 0, peak: 0 };
  }

  let sumSquares = 0;
  let peak = 0;
  for (const sample of samples) {
    const absolute = Math.abs(sample);
    sumSquares += sample * sample;
    if (absolute > peak) {
      peak = absolute;
    }
  }

  return {
    rms: Math.sqrt(sumSquares / samples.length),
    peak,
  };
}

function formatMicrophoneError(error) {
  const name = error?.name ?? '';
  if (/NotAllowed|Security/i.test(name)) {
    return '마이크 권한이 필요합니다.';
  }
  if (/NotFound|DevicesNotFound/i.test(name)) {
    return '사용 가능한 마이크를 찾을 수 없습니다.';
  }
  return '마이크 입력을 시작할 수 없습니다.';
}

export class BrowserAudioPlayer {
  constructor() {
    this.currentAudio = null;
    this.audioContext = null;
    this.activeSources = new Set();
  }

  ensureContext() {
    if (!this.audioContext || this.audioContext.state === 'closed') {
      const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextCtor) {
        return null;
      }
      this.audioContext = new AudioContextCtor();
    }
    return this.audioContext;
  }

  unlock() {
    const context = this.ensureContext();
    if (context?.state === 'suspended') {
      void context.resume().catch(() => {});
    }
  }

  stop() {
    for (const source of this.activeSources) {
      try {
        source.stop(0);
        source.disconnect();
      } catch {
        // Ignore stale audio nodes.
      }
    }
    this.activeSources.clear();

    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio.currentTime = 0;
    }
    this.currentAudio = null;
  }

  async play(source) {
    this.stop();
    if (source.startsWith('data:audio/')) {
      const didPlayWithWebAudio = await this.playWithWebAudio(source).catch(() => false);
      if (didPlayWithWebAudio) {
        return;
      }
    }

    await this.playWithElement(source);
  }

  async playWithWebAudio(source) {
    const context = this.ensureContext();
    if (!context) {
      return false;
    }

    if (context.state === 'suspended') {
      await context.resume();
    }

    const response = await fetch(source);
    const audioBuffer = await context.decodeAudioData(await response.arrayBuffer());

    await new Promise((resolve, reject) => {
      const node = context.createBufferSource();
      node.buffer = audioBuffer;
      node.connect(context.destination);
      this.activeSources.add(node);
      node.onended = () => {
        this.activeSources.delete(node);
        try {
          node.disconnect();
        } catch {
          // Ignore stale audio nodes.
        }
        resolve();
      };
      try {
        node.start(0);
      } catch (error) {
        this.activeSources.delete(node);
        reject(error);
      }
    });

    return true;
  }

  playWithElement(source) {
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

export class BrowserLiveMicrophone {
  constructor({
    sampleRate = 16000,
    chunkMs = 100,
    onChunk,
    onError,
  } = {}) {
    this.sampleRate = sampleRate;
    this.chunkSampleCount = Math.floor(sampleRate * (chunkMs / 1000));
    this.onChunk = onChunk;
    this.onError = onError;
    this.audioContext = null;
    this.stream = null;
    this.sourceNode = null;
    this.processorNode = null;
    this.silenceNode = null;
    this.pendingSamples = [];
  }

  isActive() {
    return Boolean(this.stream && this.processorNode);
  }

  unlock() {
    if (this.audioContext?.state === 'suspended') {
      void this.audioContext.resume().catch(() => {});
    }
  }

  async start() {
    if (this.isActive()) {
      this.unlock();
      return true;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      this.onError?.('이 브라우저는 마이크 입력을 지원하지 않습니다.');
      return false;
    }

    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) {
      this.onError?.('이 브라우저는 실시간 오디오 처리를 지원하지 않습니다.');
      return false;
    }

    this.stop();

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          autoGainControl: true,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
        video: false,
      });

      try {
        this.audioContext = new AudioContextCtor({ sampleRate: this.sampleRate });
      } catch {
        this.audioContext = new AudioContextCtor();
      }

      this.sourceNode = this.audioContext.createMediaStreamSource(this.stream);
      this.processorNode = this.audioContext.createScriptProcessor(4096, 1, 1);
      this.silenceNode = this.audioContext.createGain();
      this.silenceNode.gain.value = 0;
      this.processorNode.onaudioprocess = (event) => {
        this.handleAudioProcess(event.inputBuffer);
      };

      this.sourceNode.connect(this.processorNode);
      this.processorNode.connect(this.silenceNode);
      this.silenceNode.connect(this.audioContext.destination);
      this.unlock();
      return true;
    } catch (error) {
      this.stop();
      this.onError?.(formatMicrophoneError(error));
      return false;
    }
  }

  stop() {
    this.pendingSamples = [];

    if (this.processorNode) {
      this.processorNode.onaudioprocess = null;
      try {
        this.processorNode.disconnect();
      } catch {
        // Ignore stale node disconnect failures.
      }
      this.processorNode = null;
    }

    if (this.sourceNode) {
      try {
        this.sourceNode.disconnect();
      } catch {
        // Ignore stale node disconnect failures.
      }
      this.sourceNode = null;
    }

    if (this.silenceNode) {
      try {
        this.silenceNode.disconnect();
      } catch {
        // Ignore stale node disconnect failures.
      }
      this.silenceNode = null;
    }

    if (this.stream) {
      this.stream.getTracks().forEach((track) => {
        track.stop();
      });
      this.stream = null;
    }

    if (this.audioContext && this.audioContext.state !== 'closed') {
      void this.audioContext.close().catch(() => {});
    }
    this.audioContext = null;
  }

  handleAudioProcess(inputBuffer) {
    if (!this.onChunk || this.chunkSampleCount <= 0) {
      return;
    }

    const input = inputBuffer.getChannelData(0);
    const resampled = this.resample(input, inputBuffer.sampleRate);
    for (let index = 0; index < resampled.length; index += 1) {
      this.pendingSamples.push(resampled[index]);
    }

    while (this.pendingSamples.length >= this.chunkSampleCount) {
      const samples = this.pendingSamples.splice(0, this.chunkSampleCount);
      this.onChunk(encodePcm16Base64(samples), measureSamples(samples));
    }
  }

  resample(input, inputSampleRate) {
    if (inputSampleRate === this.sampleRate) {
      return input;
    }

    const ratio = inputSampleRate / this.sampleRate;
    const outputLength = Math.floor(input.length / ratio);
    const output = new Float32Array(outputLength);
    for (let outputIndex = 0; outputIndex < outputLength; outputIndex += 1) {
      const start = Math.floor(outputIndex * ratio);
      const end = Math.max(start + 1, Math.floor((outputIndex + 1) * ratio));
      let sum = 0;
      let count = 0;
      for (let inputIndex = start; inputIndex < end && inputIndex < input.length; inputIndex += 1) {
        sum += input[inputIndex];
        count += 1;
      }
      output[outputIndex] = count ? sum / count : input[start] ?? 0;
    }
    return output;
  }
}

export class BrowserSpeechSynthesizer {
  stop() {
    try {
      window.CoWebNativeSpeech?.stop?.();
    } catch {
      // Native bridge may be unavailable outside the Android wrapper.
    }
    window.speechSynthesis?.cancel();
  }

  speakWithNativeBridge(text, options = {}) {
    const bridge = getNativeSpeechBridge();
    if (!bridge) {
      return Promise.resolve(null);
    }

    const utteranceId = `co-web-tts-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const resolvers = getNativeSpeechResolvers();
    return new Promise((resolve) => {
      let settled = false;
      const finish = (didSpeak) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeoutId);
        resolvers.delete(utteranceId);
        resolve(Boolean(didSpeak));
      };
      const timeoutId = setTimeout(() => {
        finish(false);
      }, getSpeechTimeoutMs(text));

      resolvers.set(utteranceId, finish);
      try {
        bridge.speak(
          text,
          options.language ?? '',
          Number(options.pitch ?? 1.08),
          Number(options.rate ?? 0.92),
          utteranceId,
        );
      } catch {
        finish(false);
      }
    });
  }

  loadVoices(timeoutMs = 300) {
    const synthesis = window.speechSynthesis;
    if (!synthesis) {
      return Promise.resolve([]);
    }

    const voices = synthesis.getVoices();
    if (voices.length > 0) {
      return Promise.resolve(voices);
    }

    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) {
          return;
        }
        settled = true;
        synthesis.removeEventListener?.('voiceschanged', finish);
        resolve(synthesis.getVoices());
      };

      synthesis.addEventListener?.('voiceschanged', finish, { once: true });
      setTimeout(finish, timeoutMs);
    });
  }

  findVoice(voices, language) {
    if (!language) {
      return null;
    }

    const normalized = language.toLowerCase();
    const base = normalized.split('-')[0];
    return voices.find((voice) => voice.lang?.toLowerCase() === normalized)
      ?? voices.find((voice) => voice.lang?.toLowerCase().startsWith(`${base}-`))
      ?? null;
  }

  async speak(text, options = {}) {
    const trimmed = text.trim();
    if (!trimmed) {
      return false;
    }

    const nativeResult = await this.speakWithNativeBridge(trimmed, options);
    if (nativeResult !== null) {
      return nativeResult;
    }

    if (!window.speechSynthesis) {
      return false;
    }

    const voices = await this.loadVoices();
    return new Promise((resolve) => {
      const utterance = new SpeechSynthesisUtterance(trimmed);
      if (options.language) {
        utterance.lang = options.language;
      }
      const voice = this.findVoice(voices, options.language);
      if (voice) {
        utterance.voice = voice;
      }
      utterance.pitch = options.pitch ?? 1.08;
      utterance.rate = options.rate ?? 0.92;
      utterance.onend = () => resolve(true);
      utterance.onerror = () => resolve(false);
      try {
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(utterance);
      } catch {
        resolve(false);
      }
    });
  }
}

export async function repeatSpeech(synthesizer, text, repeatCount, delayMs, options = {}) {
  for (let index = 0; index < repeatCount; index += 1) {
    const didSpeak = await synthesizer.speak(text, options);
    if (!didSpeak) {
      return false;
    }
    if (index < repeatCount - 1 && delayMs > 0) {
      await wait(delayMs);
    }
  }
  return true;
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
