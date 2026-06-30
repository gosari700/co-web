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
