function createWavHeaderBase64(dataLength) {
  const buffer = new ArrayBuffer(54);
  const view = new DataView(buffer);

  const writeString = (offset, value) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 46 + dataLength, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 24000, true);
  view.setUint32(28, 48000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'JUNK');
  view.setUint32(40, 2, true);
  view.setUint16(44, 0, true);
  writeString(46, 'data');
  view.setUint32(50, dataLength, true);

  let binary = '';
  for (const byte of new Uint8Array(buffer)) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

export class GeminiTtsClient {
  constructor(config) {
    this.config = config;
  }

  async generateAudio(text) {
    const trimmed = text.trim();
    if (!trimmed) {
      return '';
    }

    const models = [
      this.config.model,
      this.config.fallbackModel,
    ].filter((model, index, all) => model && all.indexOf(model) === index);
    let lastError = null;

    for (const model of models) {
      try {
        return await this.generateAudioWithModel(trimmed, model);
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError ?? new Error('Gemini TTS failed.');
  }

  async generateAudioWithModel(trimmed, model) {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(this.config.apiKey)}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: `${this.config.promptPrefix} ${trimmed}` }],
            },
          ],
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: {
                  voiceName: this.config.voiceName,
                },
              },
            },
          },
        }),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini TTS error ${response.status}: ${errorText.slice(0, 120)}`);
    }

    const data = await response.json();
    const rawBase64 = data.candidates?.[0]?.content?.parts?.find(
      (part) => typeof part.inlineData?.data === 'string',
    )?.inlineData?.data;

    if (!rawBase64) {
      return '';
    }

    const paddingCount = rawBase64.endsWith('==')
      ? 2
      : rawBase64.endsWith('=')
        ? 1
        : 0;
    const dataLength = (rawBase64.length / 4) * 3 - paddingCount;
    return `data:audio/wav;base64,${createWavHeaderBase64(dataLength)}${rawBase64}`;
  }
}
