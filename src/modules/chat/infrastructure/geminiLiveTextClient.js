const GEMINI_WS_BASE =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';

function readServerText(serverContent) {
  const outputTranscript = serverContent?.outputTranscription?.text
    ?? serverContent?.output_audio_transcription?.text
    ?? '';
  if (outputTranscript) {
    return outputTranscript;
  }

  const parts = serverContent?.modelTurn?.parts ?? [];
  return parts
    .map((part) => part?.text ?? '')
    .join('');
}

function readServerInputText(serverContent) {
  return (
    serverContent?.inputTranscription?.text
    ?? serverContent?.input_audio_transcription?.text
    ?? ''
  ).replace(/<noise>/g, '');
}

export class GeminiLiveTextClient {
  constructor(config) {
    this.config = config;
    this.ws = null;
    this.setupComplete = false;
    this.connectPromise = null;
    this.onConnectionChange = null;
    this.onAudioChunk = null;
    this.onInputTranscript = null;
    this.onTextDelta = null;
    this.onTurnComplete = null;
    this.onInterrupted = null;
    this.onError = null;
  }

  connect() {
    if (this.isConnected()) {
      return Promise.resolve();
    }

    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.disconnect();

    this.connectPromise = new Promise((resolve, reject) => {
      const socket = new WebSocket(`${GEMINI_WS_BASE}?key=${encodeURIComponent(this.config.apiKey)}`);
      this.ws = socket;
      let didResolve = false;

      const fail = (error) => {
        if (didResolve) {
          this.onError?.(error.message);
          return;
        }
        didResolve = true;
        this.connectPromise = null;
        reject(error);
      };

      socket.onopen = () => {
        if (this.ws !== socket) {
          return;
        }
        this.sendSetup();
      };

      socket.onmessage = (event) => {
        if (this.ws !== socket) {
          return;
        }

        void this.handleRawMessage(event.data, () => {
          if (didResolve) {
            return;
          }
          didResolve = true;
          this.connectPromise = null;
          resolve();
        });
      };

      socket.onerror = () => {
        if (this.ws !== socket) {
          return;
        }
        this.setupComplete = false;
        this.onConnectionChange?.(false);
        fail(new Error('Gemini live connection failed.'));
      };

      socket.onclose = () => {
        if (this.ws !== socket) {
          return;
        }
        this.setupComplete = false;
        this.connectPromise = null;
        this.onConnectionChange?.(false);
        if (!didResolve) {
          didResolve = true;
          reject(new Error('Gemini live connection closed.'));
        }
      };
    });

    return this.connectPromise;
  }

  disconnect() {
    if (!this.ws) {
      return;
    }

    try {
      this.ws.close();
    } catch {
      // Ignore stale socket failures.
    }

    this.ws = null;
    this.setupComplete = false;
    this.connectPromise = null;
  }

  isConnected() {
    return this.setupComplete && this.ws?.readyState === WebSocket.OPEN;
  }

  sendInitialGreeting() {
    this.sendRealtimeText(this.config.initialGreetingPrompt);
  }

  sendTextTurn(text) {
    const trimmed = text.trim();
    if (!trimmed || !this.isConnected()) {
      return false;
    }

    this.ws?.send(JSON.stringify({
      clientContent: {
        turns: [
          {
            role: 'user',
            parts: [{ text: trimmed }],
          },
        ],
        turnComplete: true,
      },
    }));
    return true;
  }

  sendAudio(base64, mimeType = 'audio/pcm;rate=16000') {
    if (!base64 || !this.isConnected()) {
      return false;
    }

    if (this.usesTypedRealtimeMediaInput()) {
      this.ws?.send(JSON.stringify({
        realtimeInput: {
          audio: {
            mimeType,
            data: base64,
          },
        },
      }));
      return true;
    }

    this.ws?.send(JSON.stringify({
      realtimeInput: {
        mediaChunks: [
          {
            mimeType,
            data: base64,
          },
        ],
      },
    }));
    return true;
  }

  sendSilentContextWithoutTurn(text) {
    const trimmed = text.trim();
    if (!trimmed || !this.isConnected()) {
      return false;
    }

    this.ws?.send(JSON.stringify({
      clientContent: {
        turns: [
          {
            role: 'user',
            parts: [{ text: trimmed }],
          },
        ],
        turnComplete: false,
      },
    }));
    return true;
  }

  sendRealtimeText(text) {
    const trimmed = text.trim();
    if (!trimmed || !this.isConnected()) {
      return false;
    }

    this.ws?.send(JSON.stringify({
      realtimeInput: {
        text: trimmed,
      },
    }));
    return true;
  }

  usesTypedRealtimeMediaInput() {
    return this.config.model === 'gemini-3.1-flash-live-preview';
  }

  sendSetup() {
    this.ws?.send(JSON.stringify({
      setup: {
        model: `models/${this.config.model}`,
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: this.config.liveVoiceName,
              },
            },
          },
        },
        realtimeInputConfig: {
          automaticActivityDetection: {
            startOfSpeechSensitivity: 'START_SENSITIVITY_HIGH',
            prefixPaddingMs: 120,
            endOfSpeechSensitivity: 'END_SENSITIVITY_HIGH',
            silenceDurationMs: 450,
          },
          activityHandling: 'START_OF_ACTIVITY_INTERRUPTS',
          turnCoverage: 'TURN_INCLUDES_ONLY_ACTIVITY',
        },
        contextWindowCompression: {
          slidingWindow: {},
        },
        systemInstruction: {
          parts: [{ text: this.config.systemPrompt }],
        },
        inputAudioTranscription: {},
        outputAudioTranscription: {},
      },
    }));
  }

  async handleRawMessage(data, onSetupComplete) {
    try {
      let text = '';
      if (typeof data === 'string') {
        text = data;
      } else if (data instanceof ArrayBuffer) {
        text = new TextDecoder('utf-8').decode(new Uint8Array(data));
      } else if (data instanceof Blob) {
        const buffer = await data.arrayBuffer();
        text = new TextDecoder('utf-8').decode(new Uint8Array(buffer));
      }

      if (!text) {
        return;
      }

      this.handleMessage(JSON.parse(text), onSetupComplete);
    } catch {
      this.onError?.('Gemini live response parse failed.');
    }
  }

  handleMessage(message, onSetupComplete) {
    if (message.setupComplete !== undefined) {
      this.setupComplete = true;
      this.onConnectionChange?.(true);
      onSetupComplete();
      return;
    }

    const serverContent = message.serverContent;
    if (!serverContent) {
      return;
    }

    const inputTranscript = readServerInputText(serverContent);
    if (inputTranscript.trim()) {
      this.onInputTranscript?.(inputTranscript);
    }

    const text = readServerText(serverContent);
    if (text) {
      this.onTextDelta?.(text);
    }

    if (serverContent.interrupted) {
      this.onInterrupted?.();
      return;
    }

    const parts = serverContent.modelTurn?.parts ?? [];
    for (const part of parts) {
      if (part?.inlineData?.data) {
        this.onAudioChunk?.(
          part.inlineData.data,
          part.inlineData.mimeType ?? 'audio/pcm;rate=24000',
        );
      }
    }

    if (serverContent.turnComplete) {
      this.onTurnComplete?.();
    }
  }
}
