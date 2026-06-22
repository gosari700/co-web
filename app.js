const STORAGE_KEY = 'co-web.geminiApiKey';
const SNAPSHOT_KEY = 'co-web.chatSnapshots';
const THEME_KEY = 'co-web.chatTheme';
const LIVE_MODEL = 'gemini-3.1-flash-live-preview';
const TEXT_MODEL = 'gemini-3.5-flash';
const FALLBACK_TEXT_MODEL = 'gemini-3.1-flash-lite';
const TTS_MODEL = 'gemini-3.1-flash-tts-preview';
const LIVE_WS_BASE = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';
const GEMINI_REST_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const AUTO_TRANSLATE_DELAY_MS = 250;
const TTS_REPEAT_DELAY_MS = 200;
const TARGET_SAMPLE_RATE = 16000;
const VIDEO_FRAME_INTERVAL_MS = 1500;

const LANGUAGES = [
  { code: 'ko', label: '한국어', speech: 'ko-KR' },
  { code: 'en', label: '영어', speech: 'en-US' },
  { code: 'ja', label: '일본어', speech: 'ja-JP' },
  { code: 'zh-CN', label: '중국어', speech: 'zh-CN' },
  { code: 'es', label: '스페인어', speech: 'es-ES' },
  { code: 'fr', label: '프랑스어', speech: 'fr-FR' },
  { code: 'de', label: '독일어', speech: 'de-DE' },
];

const DRAW_COLORS = [
  '#FF4444', '#FF9800', '#FFEB3B', '#4CAF50',
  '#00BCD4', '#2196F3', '#9C27B0', '#E91E63',
  '#795548', '#9E9E9E', '#FFFFFF', '#000000',
];

const ASPECT_RATIOS = ['4:3', '16:9', '1:1', '9:16', '3:4', '4:5'];

const SELECT_SYSTEM_PROMPT =
  '당신은 사물 인식 및 제품 분석 전문가입니다. 반드시 한국어로 답변하세요. ' +
  '이미지는 사용자가 선택한 영역만 잘라낸 것입니다. 선택 영역 안의 사물, 텍스트, 브랜드, 용도, 특징, 외형, 상태를 4~6문장으로 자세히 설명하세요.';

const SELECT_PROMPT =
  '선택된 영역 안의 사물이 무엇인지 파악하고 자세히 분석해주세요. 가능하면 4~6문장으로 답하고, 무엇인지와 브랜드/텍스트, 용도와 특징, 외형, 상태 순서로 설명해주세요.';

const MATH_OCR_SYSTEM_PROMPT =
  'You are an OCR extractor for handwritten arithmetic expressions visible on a camera screen. ' +
  'Read ONLY the bright handwritten number or arithmetic expression in the focused area. ' +
  'If the handwriting is natural-language text, return exactly {"notMath":true}. ' +
  'For math, return strict JSON with visibleLines, visibleText, and normalizedExpression. ' +
  'Preserve visible commas and periods in visibleText. normalizedExpression must use ASCII digits and operators only. Do not solve it.';

const MATH_OCR_PROMPT =
  'Read the visible arithmetic expression or handwritten number exactly. It may span multiple stacked lines. Return ONLY JSON with visibleLines, visibleText, normalizedExpression. If it is natural-language text, return {"notMath":true}.';

const LANGUAGE_EXPLAIN_SYSTEM_PROMPT =
  'You read handwritten natural-language text captured from a camera: bright colored strokes on a darkened background. ' +
  'Transcribe exactly, ignore any trailing "=" trigger, and explain in Korean. Return strict JSON only: {"original":"...","explanation":"..."}.';

const LANGUAGE_EXPLAIN_PROMPT =
  'First transcribe the handwriting EXACTLY, ignore any trailing "=" trigger, then explain in Korean only that exact text. Return ONLY JSON {"original","explanation"}.';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

const dom = {
  app: $('#app'),
  stage: $('#stage'),
  liveStatus: $('#live-status'),
  cameraVideo: $('#camera-video'),
  cameraEmpty: $('#camera-empty'),
  drawCanvas: $('#draw-canvas'),
  drawCtx: $('#draw-canvas').getContext('2d'),
  workCanvas: $('#work-canvas'),
  workCtx: $('#work-canvas').getContext('2d'),
  selectionLayer: $('#selection-layer'),
  selectionRect: $('#selection-rect'),
  topBox: $('#top-box'),
  chatPanel: $('#chat-panel'),
  messageList: $('#message-list'),
  pinnedMessage: $('#pinned-message'),
  appearanceEditor: $('#appearance-editor'),
  inputOverlay: $('#input-overlay'),
  inputText: $('#input-text'),
  translatedText: $('#translated-text'),
  sourceLabel: $('#source-label'),
  targetLabel: $('#target-label'),
  languagePanel: $('#language-panel'),
  drawingToolbar: $('#drawing-toolbar'),
  colorChip: $('#color-chip'),
  thicknessRange: $('#thickness-range'),
  thicknessLabel: $('#thickness-label'),
  palette: $('#palette'),
  mapScreen: $('#map-screen'),
  mapTitle: $('#map-title'),
  mapFrame: $('#map-frame'),
  mapSearchForm: $('#map-search-form'),
  mapSearchInput: $('#map-search-input'),
  mediaScreen: $('#media-screen'),
  mediaFileInput: $('#media-file-input'),
  mediaLibrary: $('#media-library'),
  mediaViewport: $('#media-viewport'),
  browserScreen: $('#browser-screen'),
  browserForm: $('#browser-form'),
  browserUrlInput: $('#browser-url-input'),
  browserFrame: $('#browser-frame'),
  youtubeScreen: $('#youtube-screen'),
  youtubeForm: $('#youtube-form'),
  youtubeUrlInput: $('#youtube-url-input'),
  youtubeFrame: $('#youtube-frame'),
  dictionaryPopup: $('#dictionary-popup'),
  dictionaryWord: $('#dictionary-word'),
  dictionaryLink: $('#dictionary-link'),
  keyDialog: $('#key-dialog'),
  apiKeyInput: $('#api-key-input'),
  snapshotDialog: $('#snapshot-dialog'),
  snapshotList: $('#snapshot-list'),
  colorPanel: $('#color-panel'),
  colorAiText: $('#color-ai-text'),
  colorUserText: $('#color-user-text'),
};

const state = {
  apiKey: localStorage.getItem(STORAGE_KEY) || '',
  mode: 'camera',
  mediaStream: null,
  cameraReady: false,
  mainMicEnabled: true,
  live: {
    ws: null,
    connected: false,
    connecting: false,
    setupComplete: false,
    reconnectTimer: null,
    initialGreetingTimer: null,
    captureActive: false,
    videoTimer: null,
    audioContext: null,
    audioSource: null,
    audioProcessor: null,
    playbackContext: null,
    nextPlaybackTime: 0,
    activePlayback: 0,
    aiSpeaking: false,
    currentAiText: '',
    currentUserText: '',
    suppressedUntil: 0,
  },
  chat: {
    open: false,
    expanded: false,
    minimized: false,
    transparent: false,
    sideColumn: false,
    messages: [],
    translations: {},
    literalTranslations: {},
    pinnedId: null,
    speakingId: null,
    theme: loadTheme(),
  },
  input: {
    visible: false,
    micActive: false,
    value: '',
    translated: '',
    source: 'ko',
    target: 'en',
    timer: null,
    lastTranslatedKey: '',
    speaking: false,
    recognition: null,
  },
  drawing: {
    enabled: false,
    tool: 'pen',
    color: '#FFEB3B',
    thickness: 5,
    strokes: [],
    redo: [],
    activeStroke: null,
    pointerDown: false,
    start: null,
  },
  selection: {
    enabled: false,
    dragging: false,
    rect: null,
    start: null,
  },
  map: {
    provider: 'google',
    half: false,
    query: 'Seoul',
    lat: null,
    lng: null,
  },
  media: {
    items: [],
    selectedId: null,
    fitCover: false,
    aspectIndex: 0,
    volume: 1,
    speedIndex: 0,
  },
  youtube: {
    videoId: '',
    title: '',
  },
};

function loadTheme() {
  try {
    const saved = JSON.parse(localStorage.getItem(THEME_KEY) || '{}');
    return {
      panelBackground: saved.panelBackground || 'rgba(20, 20, 20, 0.86)',
      aiText: saved.aiText || '#ffffff',
      userText: saved.userText || '#ffffff',
    };
  } catch {
    return {
      panelBackground: 'rgba(20, 20, 20, 0.86)',
      aiText: '#ffffff',
      userText: '#ffffff',
    };
  }
}

function saveTheme() {
  localStorage.setItem(THEME_KEY, JSON.stringify(state.chat.theme));
}

function getTodayString() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function buildLiveSystemPrompt() {
  const today = getTodayString();
  const year = new Date().getFullYear();
  return [
    'ABSOLUTE RULE: reply in the same language the user just spoke.',
    `TODAY: ${today} (year: ${year}).`,
    'You are a cute, sweet American woman in her early 20s and the user’s warm best friend and English coach.',
    'Keep casual answers short and quick. When teaching English, explain simply with one easy example.',
    'When the user asks about what the camera is seeing, use the latest live image as visual context.',
    'HANDWRITING AND DRAWINGS: pay attention to user annotations, boxes, underlines, circles, arrows, Korean handwriting, numbers, and math formulas.',
    'If the user marks only part of the text, read, translate, or explain only the marked part.',
    'NUMBER READING RULE: read visible digits and punctuation exactly. Preserve commas and periods exactly.',
    'MATH EXPRESSION RULE: read visible expressions exactly. Calculate only when the user asks for the answer.',
    'When the user asks to read visible digits, prefer the exact digit string unless they explicitly ask for number words.',
  ].join('\n');
}

function setStatus(label, kind = '') {
  dom.liveStatus.textContent = label;
  dom.liveStatus.className = `status-pill ${kind}`.trim();
}

function requireApiKey() {
  if (state.apiKey.trim()) {
    return true;
  }
  setStatus('키 필요', 'error');
  dom.apiKeyInput.value = '';
  dom.keyDialog.showModal();
  return false;
}

function base64FromBytes(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function bytesFromBase64(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function stripDataUrl(dataUrl) {
  return dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeKoreanSpacing(text) {
  return text
    .replace(/하고(?=[가-힣])/g, '하고 ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function normalizeEnglishSpacing(text) {
  return text
    .replace(/\s+([,.!?])/g, '$1')
    .replace(/([,.!?])([A-Za-z])/g, '$1 $2')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function getLanguage(code) {
  return LANGUAGES.find((item) => item.code === code) || LANGUAGES[0];
}

function getNextLanguage(current, blocked) {
  const currentIndex = Math.max(0, LANGUAGES.findIndex((item) => item.code === current));
  for (let offset = 1; offset <= LANGUAGES.length; offset += 1) {
    const next = LANGUAGES[(currentIndex + offset) % LANGUAGES.length];
    if (next.code !== blocked) {
      return next.code;
    }
  }
  return current;
}

async function fetchJson(url, init) {
  const response = await fetch(url, init);
  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    const error = new Error(`HTTP ${response.status}: ${errorText.slice(0, 200)}`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

async function callGemini({ model = TEXT_MODEL, system, parts, maxOutputTokens = 1024, fallbackModel }) {
  if (!requireApiKey()) {
    throw new Error('API key required.');
  }

  const models = [...new Set([model, fallbackModel].filter(Boolean))];
  let lastError = null;
  for (const candidateModel of models) {
    try {
      const body = {
        contents: [{ role: 'user', parts }],
        generationConfig: { maxOutputTokens },
      };
      if (system) {
        body.systemInstruction = { parts: [{ text: system }] };
      }
      const data = await fetchJson(`${GEMINI_REST_BASE}/${candidateModel}:generateContent?key=${encodeURIComponent(state.apiKey)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const text = (data.candidates?.[0]?.content?.parts || [])
        .map((part) => part.text || '')
        .join('')
        .trim();
      if (!text) {
        throw new Error('Gemini 응답이 비어 있습니다.');
      }
      return text;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('Gemini request failed.');
}

async function translateText(text, fromLang, toLang) {
  const trimmed = text.trim();
  if (!trimmed || fromLang === toLang) {
    return '';
  }
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${encodeURIComponent(fromLang)}&tl=${encodeURIComponent(toLang)}&dt=t&q=${encodeURIComponent(trimmed)}`;
    const data = await fetchJson(url);
    return data[0]?.map((segment) => segment[0]).join('')?.trim() || '';
  } catch {
    const prompt = `Translate from ${fromLang} to ${toLang}. Output only the translation.\n\n${trimmed}`;
    return callGemini({
      model: TEXT_MODEL,
      fallbackModel: FALLBACK_TEXT_MODEL,
      parts: [{ text: prompt }],
      maxOutputTokens: 512,
    });
  }
}

async function refineKoreanText(text) {
  const trimmed = text.trim();
  if (!trimmed || !state.apiKey.trim()) {
    return trimmed;
  }
  try {
    return await callGemini({
      model: TEXT_MODEL,
      parts: [{
        text: `한국어 음성 인식 문장을 자연스럽게 띄어쓰기와 오타만 다듬어 주세요. 의미를 바꾸지 말고, 결과 문장만 출력하세요.\n\n${trimmed}`,
      }],
      maxOutputTokens: 256,
    });
  } catch {
    return trimmed;
  }
}

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

  return base64FromBytes(new Uint8Array(buffer));
}

async function generateGeminiTTS(text) {
  if (!state.apiKey.trim()) {
    throw new Error('API key required.');
  }

  const data = await fetchJson(`${GEMINI_REST_BASE}/${TTS_MODEL}:generateContent?key=${encodeURIComponent(state.apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: `Say cheerfully: ${text.trim()}` }] }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: 'Aoede',
            },
          },
        },
      },
    }),
  });

  const rawBase64 = data.candidates?.[0]?.content?.parts
    ?.find((part) => typeof part.inlineData?.data === 'string')
    ?.inlineData?.data;
  if (!rawBase64) {
    throw new Error('음성 데이터를 받지 못했습니다.');
  }

  const padding = rawBase64.endsWith('==') ? 2 : rawBase64.endsWith('=') ? 1 : 0;
  const dataLength = (rawBase64.length / 4) * 3 - padding;
  return `data:audio/wav;base64,${createWavHeaderBase64(dataLength)}${rawBase64}`;
}

function playAudioUrl(url) {
  return new Promise((resolve, reject) => {
    const audio = new Audio(url);
    audio.onended = () => resolve();
    audio.onerror = () => reject(new Error('Audio playback failed.'));
    audio.play().catch(reject);
  });
}

function speakBrowser(text, langCode) {
  return new Promise((resolve) => {
    if (!('speechSynthesis' in window)) {
      resolve();
      return;
    }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = getLanguage(langCode).speech;
    utterance.rate = 0.95;
    utterance.onend = () => resolve();
    utterance.onerror = () => resolve();
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  });
}

async function speakText(text, langCode, repeatCount = 1, useGemini = true) {
  const trimmed = text.trim();
  if (!trimmed || state.input.speaking) {
    return;
  }

  state.input.speaking = true;
  renderInput();
  try {
    if (useGemini) {
      try {
        const url = await generateGeminiTTS(trimmed);
        for (let index = 0; index < repeatCount; index += 1) {
          await playAudioUrl(url);
          if (index < repeatCount - 1) {
            await sleep(TTS_REPEAT_DELAY_MS);
          }
        }
        return;
      } catch (error) {
        console.warn('[co-web] Gemini TTS failed, falling back to browser speech:', error);
      }
    }

    for (let index = 0; index < repeatCount; index += 1) {
      await speakBrowser(trimmed, langCode);
      if (index < repeatCount - 1) {
        await sleep(TTS_REPEAT_DELAY_MS);
      }
    }
  } finally {
    state.input.speaking = false;
    renderInput();
  }
}

function downsample(buffer, fromRate, toRate) {
  if (fromRate === toRate) {
    return new Float32Array(buffer);
  }
  const ratio = fromRate / toRate;
  const newLength = Math.max(1, Math.round(buffer.length / ratio));
  const result = new Float32Array(newLength);
  for (let index = 0; index < newLength; index += 1) {
    const start = Math.floor(index * ratio);
    let end = Math.min(buffer.length, Math.floor((index + 1) * ratio));
    if (end <= start) {
      end = Math.min(buffer.length, start + 1);
    }
    let sum = 0;
    for (let sample = start; sample < end; sample += 1) {
      sum += buffer[sample];
    }
    result[index] = sum / Math.max(1, end - start);
  }
  return result;
}

function floatToPcmBase64(float32) {
  const int16 = new Int16Array(float32.length);
  for (let index = 0; index < float32.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, float32[index]));
    int16[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return base64FromBytes(new Uint8Array(int16.buffer));
}

function analyzeAudioMetrics(float32) {
  let peak = 0;
  let sum = 0;
  for (const value of float32) {
    const abs = Math.abs(value);
    peak = Math.max(peak, abs);
    sum += abs * abs;
  }
  return {
    rms: Math.sqrt(sum / Math.max(1, float32.length)),
    peak,
  };
}

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    dom.cameraEmpty.querySelector('span').textContent = '이 브라우저는 카메라/마이크를 지원하지 않습니다.';
    return;
  }

  try {
    stopCamera();
    state.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate: TARGET_SAMPLE_RATE,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: [
        { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        { facingMode: { ideal: 'environment' } },
        true,
      ][0],
    }).catch(() => navigator.mediaDevices.getUserMedia({
      audio: true,
      video: { facingMode: { ideal: 'environment' } },
    })).catch(() => navigator.mediaDevices.getUserMedia({
      audio: true,
      video: true,
    }));

    dom.cameraVideo.srcObject = state.mediaStream;
    await dom.cameraVideo.play().catch(() => {});
    state.cameraReady = true;
    dom.cameraEmpty.classList.add('hidden');
    resizeCanvases();
    await connectLive();
  } catch (error) {
    state.cameraReady = false;
    dom.cameraEmpty.classList.remove('hidden');
    dom.cameraEmpty.querySelector('strong').textContent = '카메라 권한 필요';
    dom.cameraEmpty.querySelector('span').textContent = error.message || '카메라/마이크를 시작할 수 없습니다.';
    setStatus('카메라 오류', 'error');
  }
}

function stopCamera() {
  stopCapture();
  if (state.mediaStream) {
    state.mediaStream.getTracks().forEach((track) => track.stop());
    state.mediaStream = null;
  }
  state.cameraReady = false;
}

async function connectLive() {
  if (!state.cameraReady || !state.apiKey.trim()) {
    if (!state.apiKey.trim()) {
      setStatus('키 필요');
    }
    return;
  }

  disconnectLive(false);
  state.live.connecting = true;
  state.live.connected = false;
  state.live.setupComplete = false;
  setStatus('연결 중', 'connecting');

  const ws = new WebSocket(`${LIVE_WS_BASE}?key=${encodeURIComponent(state.apiKey)}`);
  state.live.ws = ws;

  ws.onopen = () => {
    if (state.live.ws !== ws) {
      return;
    }
    ws.send(JSON.stringify({
      setup: {
        model: `models/${LIVE_MODEL}`,
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: 'Aoede',
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
        contextWindowCompression: { slidingWindow: {} },
        systemInstruction: { parts: [{ text: buildLiveSystemPrompt() }] },
        inputAudioTranscription: {},
        outputAudioTranscription: {},
      },
    }));
  };

  ws.onmessage = (event) => {
    void handleLiveRawMessage(event.data, ws);
  };

  ws.onerror = () => {
    if (state.live.ws !== ws) {
      return;
    }
    state.live.connecting = false;
    state.live.connected = false;
    setStatus('Live 오류', 'error');
  };

  ws.onclose = () => {
    if (state.live.ws !== ws) {
      return;
    }
    state.live.connecting = false;
    state.live.connected = false;
    state.live.setupComplete = false;
    stopCapture();
    setStatus(state.apiKey.trim() ? '끊김' : '키 필요', state.apiKey.trim() ? 'error' : '');
    scheduleReconnect();
  };
}

function scheduleReconnect() {
  if (!state.apiKey.trim() || !state.cameraReady) {
    return;
  }
  clearTimeout(state.live.reconnectTimer);
  state.live.reconnectTimer = setTimeout(() => {
    void connectLive();
  }, 1500);
}

function disconnectLive(allowReconnect = false) {
  clearTimeout(state.live.reconnectTimer);
  clearTimeout(state.live.initialGreetingTimer);
  stopCapture();
  stopPlayback();
  const ws = state.live.ws;
  state.live.ws = null;
  state.live.connected = false;
  state.live.connecting = false;
  state.live.setupComplete = false;
  if (ws) {
    try {
      ws.close();
    } catch {
      // ignore
    }
  }
  if (!allowReconnect) {
    setStatus(state.apiKey.trim() ? '대기' : '키 필요');
  }
}

async function handleLiveRawMessage(data, ws) {
  if (state.live.ws !== ws) {
    return;
  }
  let text = '';
  if (typeof data === 'string') {
    text = data;
  } else if (data instanceof Blob) {
    text = await data.text();
  } else if (data instanceof ArrayBuffer) {
    text = new TextDecoder().decode(new Uint8Array(data));
  }
  if (!text) {
    return;
  }

  let message;
  try {
    message = JSON.parse(text);
  } catch {
    setStatus('응답 파싱 오류', 'error');
    return;
  }

  if (message.setupComplete !== undefined) {
    state.live.setupComplete = true;
    state.live.connected = true;
    state.live.connecting = false;
    setStatus('Live 연결', 'connected');
    startCapture();
    scheduleInitialGreeting();
    return;
  }

  const serverContent = message.serverContent;
  if (!serverContent) {
    return;
  }

  const inputTranscript = (serverContent.inputTranscription?.text || serverContent.input_audio_transcription?.text || '').replace(/<noise>/g, '');
  if (inputTranscript) {
    handleInputTranscript(inputTranscript);
  }

  const outputTranscript = serverContent.outputTranscription?.text || serverContent.output_audio_transcription?.text || '';
  if (outputTranscript && !isResponseSuppressed() && !state.input.visible) {
    appendAiChunk(outputTranscript);
  }

  if (serverContent.interrupted) {
    stopPlayback();
    finalizeAiMessage();
    return;
  }

  const parts = serverContent.modelTurn?.parts || [];
  let modelTurnText = '';
  for (const part of parts) {
    if (part.text) {
      modelTurnText += part.text;
    }
    if (part.inlineData?.data && !state.input.visible && !isResponseSuppressed()) {
      const rateMatch = String(part.inlineData.mimeType || '').match(/rate=(\d+)/);
      const sampleRate = rateMatch ? Number.parseInt(rateMatch[1], 10) : 24000;
      playLiveAudioChunk(part.inlineData.data, sampleRate, part.inlineData.mimeType || '');
    }
  }
  if (!outputTranscript && modelTurnText && !state.input.visible && !isResponseSuppressed()) {
    appendAiChunk(modelTurnText);
  }
  if (serverContent.turnComplete) {
    if (isResponseSuppressed()) {
      state.live.currentAiText = '';
      return;
    }
    finalizeAiMessage();
  }
}

function isResponseSuppressed() {
  return Date.now() < state.live.suppressedUntil;
}

function scheduleInitialGreeting() {
  clearTimeout(state.live.initialGreetingTimer);
  state.live.initialGreetingTimer = setTimeout(() => {
    sendLiveText('Hey! I just opened the app. Please greet me warmly with a unique, cute, and cheerful greeting in English. Use 2 or 3 short lines.');
  }, 500);
}

function sendLiveText(text) {
  const ws = state.live.ws;
  const trimmed = text.trim();
  if (!ws || ws.readyState !== WebSocket.OPEN || !state.live.setupComplete || !trimmed) {
    return false;
  }
  ws.send(JSON.stringify({ realtimeInput: { text: trimmed } }));
  return true;
}

function sendLiveContext(text, suppressForMs = 3000) {
  const sent = sendLiveText(text);
  if (sent) {
    state.live.suppressedUntil = Date.now() + suppressForMs;
  }
  return sent;
}

function sendLiveImage(base64) {
  const ws = state.live.ws;
  if (!ws || ws.readyState !== WebSocket.OPEN || !state.live.setupComplete || !base64) {
    return;
  }
  ws.send(JSON.stringify({
    realtimeInput: {
      video: {
        mimeType: 'image/jpeg',
        data: base64,
      },
    },
  }));
}

function sendLiveAudio(base64) {
  const ws = state.live.ws;
  if (!ws || ws.readyState !== WebSocket.OPEN || !state.live.setupComplete || !base64) {
    return;
  }
  ws.send(JSON.stringify({
    realtimeInput: {
      audio: {
        mimeType: `audio/pcm;rate=${TARGET_SAMPLE_RATE}`,
        data: base64,
      },
    },
  }));
}

function startCapture() {
  if (!state.mediaStream || state.live.captureActive) {
    return;
  }
  state.live.captureActive = true;
  startAudioCapture();
  startVideoCapture();
}

function stopCapture() {
  state.live.captureActive = false;
  clearInterval(state.live.videoTimer);
  state.live.videoTimer = null;
  if (state.live.audioProcessor) {
    try {
      state.live.audioProcessor.disconnect();
    } catch {
      // ignore
    }
    state.live.audioProcessor = null;
  }
  if (state.live.audioSource) {
    try {
      state.live.audioSource.disconnect();
    } catch {
      // ignore
    }
    state.live.audioSource = null;
  }
}

function startAudioCapture() {
  const stream = state.mediaStream;
  if (!stream?.getAudioTracks().length) {
    return;
  }
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) {
    return;
  }
  const context = state.live.audioContext || new AudioCtx();
  state.live.audioContext = context;
  const source = context.createMediaStreamSource(stream);
  const processor = context.createScriptProcessor(4096, 1, 1);
  processor.onaudioprocess = (event) => {
    if (!state.live.captureActive || !state.live.connected) {
      return;
    }
    if (!state.mainMicEnabled && !state.input.micActive) {
      return;
    }
    if (state.live.aiSpeaking && !state.input.micActive) {
      const metrics = analyzeAudioMetrics(event.inputBuffer.getChannelData(0));
      if (metrics.rms < 0.018 && metrics.peak < 0.07) {
        return;
      }
    }
    const input = event.inputBuffer.getChannelData(0);
    const downsampled = downsample(input, context.sampleRate, TARGET_SAMPLE_RATE);
    sendLiveAudio(floatToPcmBase64(downsampled));
  };
  source.connect(processor);
  processor.connect(context.destination);
  state.live.audioSource = source;
  state.live.audioProcessor = processor;
}

function startVideoCapture() {
  clearInterval(state.live.videoTimer);
  state.live.videoTimer = setInterval(() => {
    if (!state.live.connected || state.live.aiSpeaking || state.input.visible) {
      return;
    }
    const frame = captureCompositeBase64({ maxWidth: 480, quality: 0.42 });
    if (frame) {
      sendLiveImage(frame);
    }
  }, VIDEO_FRAME_INTERVAL_MS);
}

function playLiveAudioChunk(base64, sampleRate, mimeType) {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) {
    return;
  }
  const context = state.live.playbackContext || new AudioCtx();
  state.live.playbackContext = context;
  state.live.aiSpeaking = true;

  if (mimeType.includes('wav') || mimeType.includes('mpeg')) {
    const bytes = bytesFromBase64(base64);
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    context.decodeAudioData(buffer.slice(0)).then((audioBuffer) => {
      queueAudioBuffer(context, audioBuffer);
    }).catch(() => {});
    return;
  }

  const bytes = bytesFromBase64(base64);
  const int16 = new Int16Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const audioBuffer = context.createBuffer(1, int16.length, sampleRate);
  const channel = audioBuffer.getChannelData(0);
  for (let index = 0; index < int16.length; index += 1) {
    channel[index] = int16[index] / 32768;
  }
  queueAudioBuffer(context, audioBuffer);
}

function queueAudioBuffer(context, audioBuffer) {
  const source = context.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(context.destination);
  const startAt = Math.max(context.currentTime + 0.02, state.live.nextPlaybackTime || 0);
  state.live.nextPlaybackTime = startAt + audioBuffer.duration;
  state.live.activePlayback += 1;
  source.onended = () => {
    state.live.activePlayback = Math.max(0, state.live.activePlayback - 1);
    if (state.live.activePlayback === 0) {
      state.live.aiSpeaking = false;
      state.live.nextPlaybackTime = 0;
      setStatus(state.live.connected ? 'Live 연결' : '대기', state.live.connected ? 'connected' : '');
    }
  };
  source.start(startAt);
  setStatus('AI 말하는 중', 'connected');
}

function stopPlayback() {
  state.live.aiSpeaking = false;
  state.live.activePlayback = 0;
  state.live.nextPlaybackTime = 0;
  try {
    state.live.playbackContext?.close();
  } catch {
    // ignore
  }
  state.live.playbackContext = null;
}

function handleInputTranscript(text) {
  if (state.input.visible && state.input.micActive) {
    state.input.value += text;
    dom.inputText.value = state.input.value;
    scheduleAutoTranslate();
    return;
  }

  if (isResponseSuppressed()) {
    return;
  }

  state.live.currentUserText += text;
  appendMessage('user', text);

  if (/speaking|스피킹|쓰피킹|스삐킹|쓰삐킹/i.test(text)) {
    openInput();
  }

  handleMapNaturalLanguageSearch(text);
}

function appendMessage(role, text, source = 'live') {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }
  const message = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    role,
    text: trimmed,
    source,
    createdAt: Date.now(),
  };
  state.chat.messages.push(message);
  renderMessages();
  return message;
}

function appendAiChunk(text) {
  const chunk = text.trimStart();
  if (!chunk) {
    return;
  }
  state.live.currentAiText += chunk;
  const last = state.chat.messages[state.chat.messages.length - 1];
  if (last?.role === 'ai' && last.streaming) {
    last.text += chunk;
  } else {
    state.chat.messages.push({
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      role: 'ai',
      text: chunk,
      source: 'live',
      streaming: true,
      createdAt: Date.now(),
    });
  }
  renderMessages();
}

function finalizeAiMessage() {
  const last = state.chat.messages[state.chat.messages.length - 1];
  if (last?.role === 'ai') {
    last.streaming = false;
  }
  state.live.currentAiText = '';
  renderMessages();
}

function renderMessages() {
  dom.messageList.innerHTML = '';
  for (const message of state.chat.messages) {
    const wrapper = document.createElement('div');
    wrapper.className = `message ${message.role}`;
    wrapper.dataset.id = message.id;

    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.style.color = message.role === 'ai' ? state.chat.theme.aiText : state.chat.theme.userText;
    bubble.append(...renderTextWithWords(message.text));
    wrapper.appendChild(bubble);

    const translation = state.chat.translations[message.id];
    const literal = state.chat.literalTranslations[message.id];
    if (translation) {
      const el = document.createElement('div');
      el.className = 'translation';
      el.textContent = translation;
      wrapper.appendChild(el);
    }
    if (literal) {
      const el = document.createElement('div');
      el.className = 'translation';
      el.textContent = `직역: ${literal}`;
      wrapper.appendChild(el);
    }

    const tools = document.createElement('div');
    tools.className = 'message-tools';
    if (message.role === 'ai') {
      tools.append(
        messageTool('번역', () => toggleMessageTranslation(message)),
        messageTool('직역', () => toggleLiteralTranslation(message)),
        messageTool('읽기', () => speakAiMessage(message)),
        messageTool(state.chat.pinnedId === message.id ? '해제' : '고정', () => togglePinned(message)),
      );
    } else {
      tools.append(messageTool('다시 질문', () => sendVisibleTextTurn(message.text)));
    }
    wrapper.appendChild(tools);
    dom.messageList.appendChild(wrapper);
  }
  dom.messageList.scrollTop = dom.messageList.scrollHeight;
  renderPinnedMessage();
}

function renderTextWithWords(text) {
  const fragment = [];
  const parts = text.split(/(\s+)/);
  for (const part of parts) {
    if (!part.trim()) {
      fragment.push(document.createTextNode(part));
      continue;
    }
    const clean = part.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
    if (clean.length > 1 && /[A-Za-z가-힣]/.test(clean)) {
      const span = document.createElement('span');
      span.className = 'word';
      span.textContent = part;
      span.addEventListener('click', () => openDictionary(clean));
      fragment.push(span);
    } else {
      fragment.push(document.createTextNode(part));
    }
  }
  return fragment;
}

function messageTool(label, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
}

async function toggleMessageTranslation(message) {
  if (state.chat.translations[message.id]) {
    delete state.chat.translations[message.id];
    renderMessages();
    return;
  }
  try {
    const hasHangul = /[가-힣]/.test(message.text);
    state.chat.translations[message.id] = await translateText(message.text, hasHangul ? 'ko' : 'en', hasHangul ? 'en' : 'ko');
  } catch (error) {
    state.chat.translations[message.id] = `번역 실패: ${error.message}`;
  }
  renderMessages();
}

async function toggleLiteralTranslation(message) {
  if (state.chat.literalTranslations[message.id]) {
    delete state.chat.literalTranslations[message.id];
    renderMessages();
    return;
  }
  try {
    state.chat.literalTranslations[message.id] = await callGemini({
      model: TEXT_MODEL,
      fallbackModel: FALLBACK_TEXT_MODEL,
      parts: [{ text: `Translate this English sentence into literal Korean. Output only Korean.\n\n${message.text}` }],
      maxOutputTokens: 512,
    });
  } catch (error) {
    state.chat.literalTranslations[message.id] = `직역 실패: ${error.message}`;
  }
  renderMessages();
}

async function speakAiMessage(message) {
  state.chat.speakingId = message.id;
  try {
    await speakText(message.text, /[가-힣]/.test(message.text) ? 'ko' : 'en', 3, true);
  } finally {
    state.chat.speakingId = null;
  }
}

function togglePinned(message) {
  state.chat.pinnedId = state.chat.pinnedId === message.id ? null : message.id;
  const pinned = state.chat.messages.find((item) => item.id === state.chat.pinnedId);
  if (pinned) {
    sendLiveContext(`[System] Keep this pinned AI message as active context: ${pinned.text}`, 3000);
  } else {
    sendLiveContext('[System] The user cleared the pinned AI message. Disregard old pinned context.', 3000);
  }
  renderMessages();
}

function renderPinnedMessage() {
  const pinned = state.chat.messages.find((item) => item.id === state.chat.pinnedId);
  if (!pinned) {
    dom.pinnedMessage.classList.add('hidden');
    dom.pinnedMessage.textContent = '';
    return;
  }
  dom.pinnedMessage.classList.remove('hidden');
  dom.pinnedMessage.textContent = pinned.text;
}

function renderChatPanel() {
  dom.chatPanel.classList.toggle('hidden', !state.chat.open);
  dom.chatPanel.classList.toggle('expanded', state.chat.expanded);
  dom.chatPanel.classList.toggle('minimized', state.chat.minimized);
  dom.chatPanel.classList.toggle('transparent', state.chat.transparent);
  dom.chatPanel.classList.toggle('side-column', state.chat.sideColumn);
  dom.chatPanel.style.setProperty('--panel-bg', state.chat.theme.panelBackground);
  dom.colorPanel.value = toHexColor(state.chat.theme.panelBackground, '#222222');
  dom.colorAiText.value = state.chat.theme.aiText;
  dom.colorUserText.value = state.chat.theme.userText;
}

function toHexColor(value, fallback) {
  const match = /^#([0-9a-f]{6})/i.exec(value);
  return match ? `#${match[1]}` : fallback;
}

function openInput() {
  state.input.visible = true;
  state.input.micActive = true;
  state.input.value = '';
  state.input.translated = '';
  state.input.lastTranslatedKey = '';
  dom.inputText.value = '';
  startInputRecognitionFallback();
  renderInput();
}

function closeInput() {
  state.input.visible = false;
  state.input.micActive = false;
  state.input.value = '';
  state.input.translated = '';
  state.input.lastTranslatedKey = '';
  clearTimeout(state.input.timer);
  stopInputRecognitionFallback();
  renderInput();
}

function renderInput() {
  dom.inputOverlay.classList.toggle('hidden', !state.input.visible);
  dom.inputText.value = state.input.value;
  dom.translatedText.textContent = state.input.translated;
  dom.sourceLabel.textContent = getLanguage(state.input.source).label;
  dom.targetLabel.textContent = getLanguage(state.input.target).label;
  $('[data-action="toggle-input-mic"]')?.classList.toggle('active', state.input.micActive);
  $('[data-action="speak-input"]')?.classList.toggle('active', state.input.speaking);
}

function scheduleAutoTranslate() {
  clearTimeout(state.input.timer);
  if (!state.input.micActive || state.input.speaking) {
    return;
  }
  const snapshot = state.input.value.trim();
  if (!snapshot || state.input.source === state.input.target) {
    return;
  }
  state.input.timer = setTimeout(() => {
    void autoTranslateInput(snapshot);
  }, AUTO_TRANSLATE_DELAY_MS);
}

async function autoTranslateInput(snapshot) {
  if (state.input.value.trim() !== snapshot || state.input.speaking) {
    return;
  }
  let sourceText = snapshot;
  if (state.input.source === 'ko') {
    sourceText = normalizeKoreanSpacing(await refineKoreanText(snapshot));
  } else if (state.input.source === 'en') {
    sourceText = normalizeEnglishSpacing(snapshot);
  }
  const key = `${state.input.source}:${state.input.target}:${sourceText}`;
  if (key === state.input.lastTranslatedKey) {
    return;
  }
  try {
    const translated = await translateText(sourceText, state.input.source, state.input.target);
    if (!translated || state.input.value.trim() !== snapshot) {
      return;
    }
    state.input.translated = translated;
    state.input.lastTranslatedKey = key;
    renderInput();
    await speakText(translated, state.input.target, 2, true);
    state.input.micActive = false;
    renderInput();
  } catch (error) {
    console.warn('[co-web] auto translate failed:', error);
  }
}

async function manualTranslateInput() {
  const trimmed = state.input.value.trim();
  if (!trimmed) {
    return;
  }
  let sourceText = trimmed;
  if (state.input.source === 'ko') {
    sourceText = normalizeKoreanSpacing(await refineKoreanText(trimmed));
    state.input.value = sourceText;
  } else if (state.input.source === 'en') {
    sourceText = normalizeEnglishSpacing(trimmed);
    state.input.value = sourceText;
  }
  state.input.translated = await translateText(sourceText, state.input.source, state.input.target);
  state.input.lastTranslatedKey = `${state.input.source}:${state.input.target}:${sourceText}`;
  renderInput();
  await speakText(state.input.translated, state.input.target, 2, true);
}

async function refineInput() {
  if (state.input.source !== 'ko') {
    return;
  }
  state.input.value = normalizeKoreanSpacing(await refineKoreanText(state.input.value));
  renderInput();
}

function startInputRecognitionFallback() {
  if (state.live.connected) {
    return;
  }
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) {
    return;
  }
  stopInputRecognitionFallback();
  const recognition = new Recognition();
  recognition.lang = getLanguage(state.input.source).speech;
  recognition.continuous = true;
  recognition.interimResults = false;
  recognition.onresult = (event) => {
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      if (event.results[index].isFinal) {
        state.input.value += event.results[index][0].transcript;
        renderInput();
        scheduleAutoTranslate();
      }
    }
  };
  recognition.onend = () => {
    if (state.input.visible && state.input.micActive && state.input.recognition === recognition) {
      recognition.start();
    }
  };
  state.input.recognition = recognition;
  try {
    recognition.start();
  } catch {
    // ignore
  }
}

function stopInputRecognitionFallback() {
  if (!state.input.recognition) {
    return;
  }
  const recognition = state.input.recognition;
  state.input.recognition = null;
  try {
    recognition.stop();
  } catch {
    // ignore
  }
}

function sendVisibleTextTurn(text) {
  const trimmed = text.trim();
  if (!trimmed) {
    return;
  }
  appendMessage('user', trimmed, 'typed');
  state.live.currentUserText = trimmed;
  const image = captureCompositeBase64({ maxWidth: 640, quality: 0.5 });
  if (image && state.live.connected) {
    sendLiveImage(image);
  }
  if (!sendLiveText(trimmed)) {
    appendMessage('ai', 'Live 세션이 연결되어 있지 않습니다. API 키와 카메라 권한을 확인해주세요.', 'system');
  }
}

function resizeCanvases() {
  const rect = dom.stage.getBoundingClientRect();
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  dom.drawCanvas.width = Math.max(1, Math.round(rect.width * dpr));
  dom.drawCanvas.height = Math.max(1, Math.round(rect.height * dpr));
  dom.drawCanvas.style.width = `${rect.width}px`;
  dom.drawCanvas.style.height = `${rect.height}px`;
  dom.drawCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  redrawCanvas();
}

function getPointer(event) {
  const rect = dom.drawCanvas.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
}

function onDrawPointerDown(event) {
  if (state.selection.enabled) {
    startSelection(event);
    return;
  }
  if (!state.drawing.enabled) {
    return;
  }
  event.preventDefault();
  const point = getPointer(event);
  state.drawing.pointerDown = true;
  state.drawing.start = point;
  state.drawing.activeStroke = {
    tool: state.drawing.tool,
    color: state.drawing.color,
    thickness: state.drawing.thickness,
    points: [point],
  };
}

function onDrawPointerMove(event) {
  if (state.selection.enabled && state.selection.dragging) {
    updateSelection(event);
    return;
  }
  if (!state.drawing.enabled || !state.drawing.pointerDown || !state.drawing.activeStroke) {
    return;
  }
  event.preventDefault();
  const point = getPointer(event);
  if (state.drawing.tool === 'pen' || state.drawing.tool === 'eraser') {
    state.drawing.activeStroke.points.push(point);
  } else {
    state.drawing.activeStroke.points = [state.drawing.start, point];
  }
  redrawCanvas();
}

function onDrawPointerUp(event) {
  if (state.selection.enabled && state.selection.dragging) {
    finishSelection(event);
    return;
  }
  if (!state.drawing.enabled || !state.drawing.pointerDown || !state.drawing.activeStroke) {
    return;
  }
  event.preventDefault();
  state.drawing.pointerDown = false;
  const stroke = state.drawing.activeStroke;
  state.drawing.activeStroke = null;
  if (stroke.points.length > 1) {
    state.drawing.strokes.push(stroke);
    state.drawing.redo = [];
    redrawCanvas();
    if (stroke.tool === 'equal') {
      void handleAutoEqualMathAnswer();
    } else {
      sendLiveContext('[System] The user updated drawings on the current visual context. Focus on the latest drawing and stay silent until asked.', 2200);
    }
  }
}

function redrawCanvas() {
  const ctx = dom.drawCtx;
  const rect = dom.drawCanvas.getBoundingClientRect();
  ctx.clearRect(0, 0, rect.width, rect.height);
  for (const stroke of [...state.drawing.strokes, state.drawing.activeStroke].filter(Boolean)) {
    drawStroke(ctx, stroke);
  }
}

function drawStroke(ctx, stroke) {
  const points = stroke.points;
  if (!points.length) {
    return;
  }
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = stroke.thickness;
  ctx.strokeStyle = stroke.color;
  ctx.fillStyle = stroke.color;
  if (stroke.tool === 'eraser') {
    ctx.globalCompositeOperation = 'destination-out';
  }

  if (stroke.tool === 'pen' || stroke.tool === 'eraser') {
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (const point of points.slice(1)) {
      ctx.lineTo(point.x, point.y);
    }
    ctx.stroke();
  } else {
    const start = points[0];
    const end = points[points.length - 1];
    if (stroke.tool === 'rect' || stroke.tool === 'equal') {
      ctx.strokeRect(start.x, start.y, end.x - start.x, end.y - start.y);
      if (stroke.tool === 'equal') {
        ctx.font = `${Math.max(18, stroke.thickness * 4)}px Arial`;
        ctx.fillText('=', end.x + 6, end.y);
      }
    } else if (stroke.tool === 'circle') {
      const cx = (start.x + end.x) / 2;
      const cy = (start.y + end.y) / 2;
      const rx = Math.abs(end.x - start.x) / 2;
      const ry = Math.abs(end.y - start.y) / 2;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else if (stroke.tool === 'line' || stroke.tool === 'arrow') {
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
      if (stroke.tool === 'arrow') {
        drawArrowHead(ctx, start, end, stroke.thickness);
      }
    }
  }
  ctx.restore();
}

function drawArrowHead(ctx, start, end, thickness) {
  const angle = Math.atan2(end.y - start.y, end.x - start.x);
  const size = Math.max(10, thickness * 3);
  ctx.beginPath();
  ctx.moveTo(end.x, end.y);
  ctx.lineTo(end.x - size * Math.cos(angle - Math.PI / 6), end.y - size * Math.sin(angle - Math.PI / 6));
  ctx.lineTo(end.x - size * Math.cos(angle + Math.PI / 6), end.y - size * Math.sin(angle + Math.PI / 6));
  ctx.closePath();
  ctx.fill();
}

function renderDrawing() {
  dom.drawCanvas.classList.toggle('enabled', state.drawing.enabled);
  dom.drawingToolbar.classList.toggle('hidden', !state.drawing.enabled);
  dom.colorChip.style.backgroundColor = state.drawing.color;
  dom.thicknessRange.value = String(state.drawing.thickness);
  dom.thicknessLabel.textContent = String(state.drawing.thickness);
  $$('[data-tool]').forEach((button) => {
    button.classList.toggle('active', button.dataset.tool === state.drawing.tool);
  });
}

function startSelection(event) {
  event.preventDefault();
  state.selection.dragging = true;
  const point = getPointer(event);
  state.selection.start = point;
  state.selection.rect = { x: point.x, y: point.y, width: 1, height: 1 };
  renderSelection();
}

function updateSelection(event) {
  event.preventDefault();
  const point = getPointer(event);
  const start = state.selection.start;
  state.selection.rect = {
    x: Math.min(start.x, point.x),
    y: Math.min(start.y, point.y),
    width: Math.abs(point.x - start.x),
    height: Math.abs(point.y - start.y),
  };
  renderSelection();
}

function finishSelection(event) {
  event.preventDefault();
  state.selection.dragging = false;
  updateSelection(event);
}

function renderSelection() {
  dom.selectionLayer.classList.toggle('hidden', !state.selection.enabled);
  dom.drawCanvas.classList.toggle('selecting', state.selection.enabled);
  const rect = state.selection.rect;
  if (!rect) {
    dom.selectionRect.style.display = 'none';
    return;
  }
  dom.selectionRect.style.display = 'block';
  dom.selectionRect.style.left = `${rect.x}px`;
  dom.selectionRect.style.top = `${rect.y}px`;
  dom.selectionRect.style.width = `${rect.width}px`;
  dom.selectionRect.style.height = `${rect.height}px`;
}

function captureCompositeBase64({ rect = null, maxWidth = 800, quality = 0.72 } = {}) {
  const stageRect = dom.stage.getBoundingClientRect();
  const sourceWidth = Math.max(1, Math.round(stageRect.width));
  const sourceHeight = Math.max(1, Math.round(stageRect.height));
  const work = dom.workCanvas;
  const ctx = dom.workCtx;

  let crop = rect || { x: 0, y: 0, width: sourceWidth, height: sourceHeight };
  crop = {
    x: Math.max(0, crop.x),
    y: Math.max(0, crop.y),
    width: Math.max(1, Math.min(sourceWidth - crop.x, crop.width)),
    height: Math.max(1, Math.min(sourceHeight - crop.y, crop.height)),
  };

  const scale = Math.min(1, maxWidth / crop.width);
  work.width = Math.max(1, Math.round(crop.width * scale));
  work.height = Math.max(1, Math.round(crop.height * scale));
  ctx.setTransform(scale, 0, 0, scale, -crop.x * scale, -crop.y * scale);
  ctx.clearRect(crop.x, crop.y, crop.width, crop.height);
  ctx.fillStyle = '#000';
  ctx.fillRect(crop.x, crop.y, crop.width, crop.height);

  try {
    if (state.mode === 'camera' && dom.cameraVideo.videoWidth > 0) {
      drawCover(ctx, dom.cameraVideo, 0, 0, sourceWidth, sourceHeight);
    } else if (state.mode === 'media') {
      const media = dom.mediaViewport.querySelector('img, video');
      if (media) {
        drawContain(ctx, media, 0, 0, sourceWidth, sourceHeight);
      } else {
        ctx.fillStyle = '#111';
        ctx.fillRect(0, 0, sourceWidth, sourceHeight);
      }
    } else {
      return null;
    }
    ctx.drawImage(dom.drawCanvas, 0, 0, sourceWidth, sourceHeight);
    return stripDataUrl(work.toDataURL('image/jpeg', quality));
  } catch (error) {
    console.warn('[co-web] capture failed:', error);
    return null;
  } finally {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
}

function drawCover(ctx, media, x, y, width, height) {
  const sw = media.videoWidth || media.naturalWidth || media.width;
  const sh = media.videoHeight || media.naturalHeight || media.height;
  if (!sw || !sh) {
    return;
  }
  const scale = Math.max(width / sw, height / sh);
  const dw = sw * scale;
  const dh = sh * scale;
  ctx.drawImage(media, x + (width - dw) / 2, y + (height - dh) / 2, dw, dh);
}

function drawContain(ctx, media, x, y, width, height) {
  const sw = media.videoWidth || media.naturalWidth || media.width;
  const sh = media.videoHeight || media.naturalHeight || media.height;
  if (!sw || !sh) {
    return;
  }
  const scale = Math.min(width / sw, height / sh);
  const dw = sw * scale;
  const dh = sh * scale;
  ctx.drawImage(media, x + (width - dw) / 2, y + (height - dh) / 2, dw, dh);
}

async function confirmSelection() {
  const rect = state.selection.rect;
  if (!rect || rect.width < 20 || rect.height < 20) {
    return;
  }
  const imageBase64 = captureCompositeBase64({ rect, maxWidth: 720, quality: 0.72 });
  state.selection.enabled = false;
  state.selection.rect = null;
  renderSelection();
  if (!imageBase64) {
    appendMessage('ai', '선택 영역 캡처에 실패했습니다.', 'analysis');
    return;
  }
  appendMessage('ai', '선택 영역을 분석 중입니다...', 'analysis');
  try {
    const result = await callGemini({
      model: TEXT_MODEL,
      fallbackModel: FALLBACK_TEXT_MODEL,
      system: SELECT_SYSTEM_PROMPT,
      parts: [
        { inlineData: { mimeType: 'image/jpeg', data: imageBase64 } },
        { text: SELECT_PROMPT },
      ],
      maxOutputTokens: 2048,
    });
    const last = state.chat.messages[state.chat.messages.length - 1];
    if (last?.text === '선택 영역을 분석 중입니다...') {
      last.text = result;
    } else {
      appendMessage('ai', result, 'analysis');
    }
    state.chat.open = true;
    renderChatPanel();
    renderMessages();
    sendLiveContext(`[System] The selected area analysis result is: ${result}. Use this as background context only.`, 2500);
  } catch (error) {
    appendMessage('ai', error.status === 429 ? 'Gemini 분석 한도 초과(API 429)입니다. 잠시 후 다시 시도해 주세요.' : `분석 실패: ${error.message}`, 'analysis');
  }
}

async function handleAutoEqualMathAnswer() {
  const imageBase64 = captureCompositeBase64({ maxWidth: 720, quality: 0.74 });
  if (!imageBase64) {
    showTopBox('캡처 실패', '다시 시도해주세요');
    return;
  }
  showTopBox('읽는 중...', '');
  try {
    const raw = await callGemini({
      model: TEXT_MODEL,
      system: MATH_OCR_SYSTEM_PROMPT,
      parts: [
        { inlineData: { mimeType: 'image/jpeg', data: imageBase64 } },
        { text: MATH_OCR_PROMPT },
      ],
      maxOutputTokens: 1536,
    });
    const parsed = parseJsonFromText(raw);
    if (parsed?.notMath) {
      await handleLanguageExplain(imageBase64);
      return;
    }
    const expression = parsed?.visibleText || parsed?.visibleLines?.join('') || parsed?.normalizedExpression || '';
    const normalized = parsed?.normalizedExpression || normalizeArithmeticExpression(expression);
    const answer = evaluateArithmetic(normalized);
    if (!expression || answer === null) {
      await handleLanguageExplain(imageBase64);
      return;
    }
    showTopBox(expression, `= ${answer}`);
    appendMessage('ai', `박스 안의 산수식은 '${expression}'이고, 정답은 ${answer}입니다.`, 'analysis');
    sendLiveContext(`[System] The current handwritten math expression is ${expression}, and the exact answer is ${answer}. Use this for future answers and stay silent now.`, 2500);
  } catch (error) {
    if (error.status === 429) {
      showTopBox('API 사용량 한도 초과 (429)', '잠시 후 다시 시도해 주세요');
    } else {
      showTopBox('인식 실패', '다시 또렷하게 써 주세요');
    }
  }
}

async function handleLanguageExplain(imageBase64) {
  try {
    const raw = await callGemini({
      model: TEXT_MODEL,
      system: LANGUAGE_EXPLAIN_SYSTEM_PROMPT,
      parts: [
        { inlineData: { mimeType: 'image/jpeg', data: imageBase64 } },
        { text: LANGUAGE_EXPLAIN_PROMPT },
      ],
      maxOutputTokens: 4096,
    });
    const parsed = parseJsonFromText(raw);
    if (!parsed?.original && !parsed?.explanation) {
      throw new Error('언어 설명 파싱 실패');
    }
    showTopBox(parsed.original || '필기 설명', parsed.explanation || '');
    sendLiveContext(`[System] The top language box recognized "${parsed.original || ''}" and explains: ${parsed.explanation || ''}. Use it as background context only.`, 2500);
  } catch (error) {
    if (error.status === 429) {
      showTopBox('API 사용량 한도 초과 (429)', '잠시 후 다시 시도해 주세요');
    } else {
      showTopBox('인식 실패', '다시 또렷하게 써 주세요');
    }
  }
}

function parseJsonFromText(text) {
  const cleaned = text
    .replace(/^```json/i, '')
    .replace(/^```/i, '')
    .replace(/```$/i, '')
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1));
    }
  }
  return null;
}

function normalizeArithmeticExpression(expression) {
  return expression
    .replace(/[×xX✕]/g, '*')
    .replace(/[÷]/g, '/')
    .replace(/,/g, '')
    .replace(/=/g, '')
    .replace(/\s+/g, '');
}

function evaluateArithmetic(expression) {
  const normalized = normalizeArithmeticExpression(expression);
  if (!normalized || !/^[0-9+\-*/().\s]+$/.test(normalized)) {
    return null;
  }
  try {
    const value = Function(`"use strict"; return (${normalized});`)();
    if (!Number.isFinite(value)) {
      return null;
    }
    return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
  } catch {
    return null;
  }
}

function showTopBox(title, answer) {
  dom.topBox.classList.remove('hidden');
  dom.topBox.innerHTML = '';
  const titleEl = document.createElement('div');
  titleEl.textContent = title;
  dom.topBox.appendChild(titleEl);
  if (answer) {
    const answerEl = document.createElement('div');
    answerEl.className = 'answer';
    answerEl.textContent = answer;
    dom.topBox.appendChild(answerEl);
  }
}

function openDictionary(word) {
  dom.dictionaryPopup.classList.remove('hidden');
  dom.dictionaryWord.textContent = word;
  const url = `https://dic.daum.net/search.do?q=${encodeURIComponent(word)}`;
  dom.dictionaryLink.href = url;
}

function setMode(mode) {
  state.mode = mode;
  dom.mapScreen.classList.toggle('hidden', mode !== 'map');
  dom.mediaScreen.classList.toggle('hidden', mode !== 'media');
  dom.browserScreen.classList.toggle('hidden', mode !== 'browser');
  dom.youtubeScreen.classList.toggle('hidden', mode !== 'youtube');
  if (mode === 'map') {
    updateMapFrame();
    sendLiveContext(`[System] The map screen is now active. Current search is ${state.map.query}. Use map context and stay silent for place lookup commands.`, 2600);
  } else if (mode === 'camera') {
    sendLiveContext('[System] The camera screen is active again. Ignore old map, media, and YouTube frames. Stay silent.', 2200);
  }
}

function updateMapFrame() {
  const query = state.map.lat && state.map.lng
    ? `${state.map.lat},${state.map.lng}`
    : state.map.query;
  dom.mapTitle.textContent = state.map.provider === 'google' ? 'Google 지도' : 'Kakao 지도';
  dom.mapSearchInput.value = state.map.query;
  if (state.map.provider === 'google') {
    dom.mapFrame.src = `https://maps.google.com/maps?q=${encodeURIComponent(query)}&z=15&output=embed`;
  } else {
    dom.mapFrame.src = `https://map.kakao.com/link/search/${encodeURIComponent(state.map.query || 'Seoul')}`;
  }
  dom.mapScreen.classList.toggle('half', state.map.half);
}

function handleMapNaturalLanguageSearch(text) {
  if (state.mode !== 'map') {
    return;
  }
  const match = text.match(/(?:find|search|show|찾아|검색|보여줘|근처|nearby)\s*(.+)/i);
  if (!match?.[1]) {
    return;
  }
  state.map.query = match[1].trim();
  updateMapFrame();
}

function handleMediaFiles(files) {
  for (const file of files) {
    const type = file.type.startsWith('image/')
      ? 'image'
      : file.type.startsWith('video/')
        ? 'video'
        : file.type === 'application/pdf'
          ? 'pdf'
          : 'file';
    const item = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      name: file.name,
      type,
      url: URL.createObjectURL(file),
      file,
    };
    state.media.items.push(item);
    state.media.selectedId = item.id;
  }
  renderMedia();
}

function renderMedia() {
  dom.mediaLibrary.innerHTML = '';
  for (const item of state.media.items) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'media-thumb';
    button.textContent = item.name;
    button.classList.toggle('active', item.id === state.media.selectedId);
    button.addEventListener('click', () => {
      state.media.selectedId = item.id;
      renderMedia();
    });
    dom.mediaLibrary.appendChild(button);
  }

  const item = state.media.items.find((entry) => entry.id === state.media.selectedId);
  dom.mediaViewport.classList.toggle('fit-cover', state.media.fitCover);
  dom.mediaViewport.innerHTML = '';
  if (!item) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = '이미지, 동영상, PDF를 선택하세요.';
    dom.mediaViewport.appendChild(empty);
    return;
  }
  let element;
  if (item.type === 'image') {
    element = document.createElement('img');
    element.src = item.url;
  } else if (item.type === 'video') {
    element = document.createElement('video');
    element.src = item.url;
    element.controls = false;
    element.playsInline = true;
    element.volume = state.media.volume;
    element.playbackRate = getMediaSpeed();
  } else if (item.type === 'pdf') {
    element = document.createElement('embed');
    element.src = item.url;
    element.type = 'application/pdf';
  } else {
    element = document.createElement('iframe');
    element.src = item.url;
  }
  dom.mediaViewport.appendChild(element);
  sendLiveContext(`[System] The media screen is active. The selected file is ${item.name} (${item.type}). Use media frames when available and stay silent now.`, 2200);
}

function getMediaSpeed() {
  return [0.5, 0.75, 1, 1.25, 1.5, 2][state.media.speedIndex] || 1;
}

function parseYouTubeId(value) {
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }
  const patterns = [
    /youtu\.be\/([A-Za-z0-9_-]{6,})/,
    /youtube\.com\/watch\?v=([A-Za-z0-9_-]{6,})/,
    /youtube\.com\/embed\/([A-Za-z0-9_-]{6,})/,
    /^([A-Za-z0-9_-]{6,})$/,
  ];
  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }
  return '';
}

function openYouTube(value) {
  const videoId = parseYouTubeId(value);
  if (!videoId) {
    return;
  }
  state.youtube.videoId = videoId;
  dom.youtubeFrame.src = `https://www.youtube.com/embed/${videoId}?autoplay=1&playsinline=1&enablejsapi=1`;
  sendLiveContext(`[System] YouTube mode is active. The current YouTube video ID is ${videoId}. Browser security may prevent direct pixel capture, so use this video context and any user drawing context. Stay silent now.`, 3200);
}

function saveSnapshot() {
  const snapshots = loadSnapshots();
  const title = new Date().toLocaleString('ko-KR');
  snapshots.unshift({
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    title,
    messages: state.chat.messages,
    translations: state.chat.translations,
    literalTranslations: state.chat.literalTranslations,
    pinnedId: state.chat.pinnedId,
    drawing: state.drawing.strokes,
    createdAt: Date.now(),
  });
  localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshots.slice(0, 30)));
}

function loadSnapshots() {
  try {
    return JSON.parse(localStorage.getItem(SNAPSHOT_KEY) || '[]');
  } catch {
    return [];
  }
}

function openSnapshotLibrary() {
  const snapshots = loadSnapshots();
  dom.snapshotList.innerHTML = '';
  if (!snapshots.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = '저장된 채팅이 없습니다.';
    dom.snapshotList.appendChild(empty);
  }
  for (const snapshot of snapshots) {
    const row = document.createElement('div');
    row.className = 'snapshot-row';
    const title = document.createElement('span');
    title.textContent = snapshot.title;
    const open = document.createElement('button');
    open.type = 'button';
    open.textContent = '열기';
    open.addEventListener('click', () => {
      state.chat.messages = snapshot.messages || [];
      state.chat.translations = snapshot.translations || {};
      state.chat.literalTranslations = snapshot.literalTranslations || {};
      state.chat.pinnedId = snapshot.pinnedId || null;
      state.drawing.strokes = snapshot.drawing || [];
      redrawCanvas();
      renderMessages();
      dom.snapshotDialog.close();
    });
    const del = document.createElement('button');
    del.type = 'button';
    del.textContent = '삭제';
    del.addEventListener('click', () => {
      const next = loadSnapshots().filter((item) => item.id !== snapshot.id);
      localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(next));
      openSnapshotLibrary();
    });
    row.append(title, open, del);
    dom.snapshotList.appendChild(row);
  }
  dom.snapshotDialog.showModal();
}

function renderPalette() {
  dom.palette.innerHTML = '';
  for (const color of DRAW_COLORS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.style.backgroundColor = color;
    button.addEventListener('click', () => {
      state.drawing.color = color;
      state.drawing.tool = 'pen';
      dom.palette.classList.add('hidden');
      renderDrawing();
    });
    dom.palette.appendChild(button);
  }
}

function bindEvents() {
  document.addEventListener('click', (event) => {
    const actionTarget = event.target.closest('[data-action]');
    if (!actionTarget) {
      return;
    }
    const action = actionTarget.dataset.action;
    if (!action) {
      return;
    }
    handleAction(action);
  });

  dom.inputText.addEventListener('input', () => {
    state.input.value = dom.inputText.value;
    scheduleAutoTranslate();
  });
  dom.drawCanvas.addEventListener('pointerdown', onDrawPointerDown);
  dom.drawCanvas.addEventListener('pointermove', onDrawPointerMove);
  window.addEventListener('pointerup', onDrawPointerUp);
  window.addEventListener('resize', resizeCanvases);

  dom.thicknessRange.addEventListener('input', () => {
    state.drawing.thickness = Number(dom.thicknessRange.value);
    renderDrawing();
  });
  $$('[data-tool]').forEach((button) => {
    button.addEventListener('click', () => {
      state.drawing.tool = button.dataset.tool;
      renderDrawing();
    });
  });

  dom.mapSearchForm.addEventListener('submit', (event) => {
    event.preventDefault();
    state.map.query = dom.mapSearchInput.value.trim() || 'Seoul';
    state.map.lat = null;
    state.map.lng = null;
    updateMapFrame();
  });

  dom.mediaFileInput.addEventListener('change', () => {
    handleMediaFiles(dom.mediaFileInput.files || []);
    dom.mediaFileInput.value = '';
  });

  dom.browserForm.addEventListener('submit', (event) => {
    event.preventDefault();
    let url = dom.browserUrlInput.value.trim();
    if (!/^https?:\/\//i.test(url)) {
      url = `https://${url}`;
    }
    dom.browserFrame.src = url;
  });

  dom.youtubeForm.addEventListener('submit', (event) => {
    event.preventDefault();
    openYouTube(dom.youtubeUrlInput.value);
  });

  dom.colorPanel.addEventListener('input', () => {
    state.chat.theme.panelBackground = `${dom.colorPanel.value}dd`;
    saveTheme();
    renderChatPanel();
  });
  dom.colorAiText.addEventListener('input', () => {
    state.chat.theme.aiText = dom.colorAiText.value;
    saveTheme();
    renderMessages();
  });
  dom.colorUserText.addEventListener('input', () => {
    state.chat.theme.userText = dom.colorUserText.value;
    saveTheme();
    renderMessages();
  });
}

function handleAction(action) {
  switch (action) {
    case 'start-camera':
      void startCamera();
      break;
    case 'open-key':
      dom.apiKeyInput.value = state.apiKey;
      dom.keyDialog.showModal();
      break;
    case 'save-key':
      state.apiKey = dom.apiKeyInput.value.trim();
      if (state.apiKey) {
        localStorage.setItem(STORAGE_KEY, state.apiKey);
      }
      dom.keyDialog.close();
      void connectLive();
      break;
    case 'clear-key':
      state.apiKey = '';
      localStorage.removeItem(STORAGE_KEY);
      dom.apiKeyInput.value = '';
      disconnectLive(false);
      setStatus('키 필요');
      break;
    case 'reconnect-live':
      void connectLive();
      break;
    case 'toggle-chat':
      state.chat.open = !state.chat.open;
      if (!state.chat.open) {
        closeInput();
      }
      renderChatPanel();
      break;
    case 'toggle-chat-side':
      state.chat.sideColumn = !state.chat.sideColumn;
      renderChatPanel();
      break;
    case 'chat-transparent':
      state.chat.transparent = !state.chat.transparent;
      renderChatPanel();
      break;
    case 'chat-appearance':
      dom.appearanceEditor.classList.toggle('hidden');
      break;
    case 'appearance-reset':
      state.chat.theme = {
        panelBackground: 'rgba(20, 20, 20, 0.86)',
        aiText: '#ffffff',
        userText: '#ffffff',
      };
      saveTheme();
      renderChatPanel();
      renderMessages();
      break;
    case 'chat-save':
      saveSnapshot();
      break;
    case 'chat-library':
      openSnapshotLibrary();
      break;
    case 'chat-min':
      state.chat.minimized = !state.chat.minimized;
      state.chat.expanded = false;
      renderChatPanel();
      break;
    case 'chat-expand':
      state.chat.expanded = !state.chat.expanded;
      state.chat.minimized = false;
      renderChatPanel();
      break;
    case 'chat-clear':
      state.chat.messages = [];
      state.chat.translations = {};
      state.chat.literalTranslations = {};
      state.chat.pinnedId = null;
      renderMessages();
      break;
    case 'toggle-map':
      setMode(state.mode === 'map' ? 'camera' : 'map');
      break;
    case 'close-map':
      setMode('camera');
      break;
    case 'map-provider':
      state.map.provider = state.map.provider === 'google' ? 'kakao' : 'google';
      updateMapFrame();
      break;
    case 'map-size':
      state.map.half = !state.map.half;
      updateMapFrame();
      break;
    case 'map-current':
      navigator.geolocation?.getCurrentPosition((position) => {
        state.map.lat = position.coords.latitude;
        state.map.lng = position.coords.longitude;
        state.map.query = `${state.map.lat.toFixed(6)},${state.map.lng.toFixed(6)}`;
        updateMapFrame();
        sendLiveContext(`[System] The user's current map location is latitude ${state.map.lat.toFixed(6)}, longitude ${state.map.lng.toFixed(6)}.`, 2200);
      });
      break;
    case 'map-measure':
    case 'map-walk':
    case 'map-car':
      appendMessage('ai', '웹 지도에서는 지도 제공자 iframe 제약 때문에 해당 도구는 지도 검색/컨텍스트로 대체됩니다.', 'system');
      break;
    case 'toggle-selection':
      state.selection.enabled = !state.selection.enabled;
      state.selection.rect = null;
      if (state.selection.enabled) {
        state.drawing.enabled = false;
      }
      renderSelection();
      renderDrawing();
      break;
    case 'confirm-selection':
      void confirmSelection();
      break;
    case 'cancel-selection':
      state.selection.enabled = false;
      state.selection.rect = null;
      renderSelection();
      break;
    case 'toggle-media':
      setMode(state.mode === 'media' ? 'camera' : 'media');
      break;
    case 'close-media':
      setMode('camera');
      break;
    case 'media-aspect':
      state.media.aspectIndex = (state.media.aspectIndex + 1) % ASPECT_RATIOS.length;
      dom.mediaViewport.style.aspectRatio = ASPECT_RATIOS[state.media.aspectIndex].replace(':', '/');
      break;
    case 'media-fit':
      state.media.fitCover = !state.media.fitCover;
      renderMedia();
      break;
    case 'media-play':
      toggleMediaPlay();
      break;
    case 'media-back':
      seekMedia(-5);
      break;
    case 'media-forward':
      seekMedia(5);
      break;
    case 'media-speed':
      state.media.speedIndex = (state.media.speedIndex + 1) % 6;
      applyMediaPlayback();
      break;
    case 'media-volume-down':
      state.media.volume = Math.max(0, state.media.volume - 0.2);
      applyMediaPlayback();
      break;
    case 'media-volume-up':
      state.media.volume = Math.min(1, state.media.volume + 0.2);
      applyMediaPlayback();
      break;
    case 'open-browser':
      setMode('browser');
      break;
    case 'close-browser':
      setMode('media');
      break;
    case 'toggle-youtube':
      setMode(state.mode === 'youtube' ? 'camera' : 'youtube');
      break;
    case 'close-youtube':
      dom.youtubeFrame.src = '';
      setMode('camera');
      break;
    case 'youtube-fullscreen':
      dom.youtubeScreen.requestFullscreen?.();
      break;
    case 'toggle-recording-mic':
      state.mainMicEnabled = !state.mainMicEnabled;
      document.querySelector('[data-action="toggle-recording-mic"]').classList.toggle('active', state.mainMicEnabled);
      break;
    case 'toggle-drawing':
      state.drawing.enabled = !state.drawing.enabled;
      if (state.drawing.enabled) {
        state.selection.enabled = false;
      }
      renderDrawing();
      renderSelection();
      break;
    case 'toggle-palette':
      dom.palette.classList.toggle('hidden');
      break;
    case 'draw-undo':
      if (state.drawing.strokes.length) {
        state.drawing.redo.push(state.drawing.strokes.pop());
        redrawCanvas();
      }
      break;
    case 'draw-redo':
      if (state.drawing.redo.length) {
        state.drawing.strokes.push(state.drawing.redo.pop());
        redrawCanvas();
      }
      break;
    case 'draw-clear':
      state.drawing.strokes = [];
      state.drawing.redo = [];
      dom.topBox.classList.add('hidden');
      redrawCanvas();
      break;
    case 'close-dictionary':
      dom.dictionaryPopup.classList.add('hidden');
      break;
    case 'toggle-input-mic':
      state.input.micActive = !state.input.micActive;
      if (state.input.micActive) {
        startInputRecognitionFallback();
        scheduleAutoTranslate();
      } else {
        stopInputRecognitionFallback();
      }
      renderInput();
      break;
    case 'refine-input':
      void refineInput();
      break;
    case 'translate-input':
      void manualTranslateInput();
      break;
    case 'toggle-language-panel':
      dom.languagePanel.classList.toggle('hidden');
      break;
    case 'speak-input':
      void speakText(state.input.translated, state.input.target, 1, true);
      break;
    case 'clear-input':
      state.input.value = '';
      state.input.translated = '';
      state.input.lastTranslatedKey = '';
      renderInput();
      break;
    case 'submit-input':
      if (state.input.value.trim()) {
        sendVisibleTextTurn(state.input.value);
        closeInput();
      }
      break;
    case 'close-input':
      closeInput();
      break;
    case 'cycle-source':
      state.input.source = getNextLanguage(state.input.source, state.input.target);
      startInputRecognitionFallback();
      renderInput();
      scheduleAutoTranslate();
      break;
    case 'cycle-target':
      state.input.target = getNextLanguage(state.input.target, state.input.source);
      renderInput();
      scheduleAutoTranslate();
      break;
    case 'swap-languages': {
      const oldSource = state.input.source;
      const oldValue = state.input.value;
      state.input.source = state.input.target;
      state.input.target = oldSource;
      state.input.value = state.input.translated;
      state.input.translated = oldValue;
      renderInput();
      break;
    }
    default:
      break;
  }
}

function toggleMediaPlay() {
  const video = dom.mediaViewport.querySelector('video');
  if (!video) {
    return;
  }
  if (video.paused) {
    void video.play();
  } else {
    video.pause();
  }
}

function seekMedia(seconds) {
  const video = dom.mediaViewport.querySelector('video');
  if (video) {
    video.currentTime = Math.max(0, video.currentTime + seconds);
  }
}

function applyMediaPlayback() {
  const video = dom.mediaViewport.querySelector('video');
  if (video) {
    video.volume = state.media.volume;
    video.playbackRate = getMediaSpeed();
  }
}

function init() {
  dom.apiKeyInput.value = state.apiKey;
  renderPalette();
  bindEvents();
  renderChatPanel();
  renderMessages();
  renderInput();
  renderDrawing();
  renderSelection();
  updateMapFrame();
  resizeCanvases();
  setStatus(state.apiKey ? '대기' : '키 필요');
  if (!state.apiKey) {
    setTimeout(() => dom.keyDialog.showModal(), 350);
  }
  void startCamera();
}

init();
