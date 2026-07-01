import { clearApiKey, loadApiKey, saveApiKey } from '../../settings/domain/apiKeyStore.js';
import {
  CHAT_APPEARANCE_ACTION_TARGETS,
  CHAT_APPEARANCE_TARGET_COLUMNS,
  DEFAULT_CHAT_APPEARANCE,
  createDefaultChatAppearance,
  getChatAppearanceColor,
} from '../domain/chatAppearance.js';
import { hexToHsv, hsvToHex } from '../domain/chatAppearanceColor.js';
import { CHAT_CONFIG, buildLiveSystemPrompt } from '../domain/chatConfig.js';
import { CO_SECOND_API_KEYS } from '../domain/coSecondApiKeys.js';
import {
  buildGroundedSearchHandoff,
  buildTypedUserTurn,
  containsKorean,
  createAiMessage,
  createErrorMessage,
  createUserMessage,
  getTranslationDirection,
  splitChatMessageLines,
  toGroundedSearchMessage,
} from '../domain/chatMessages.js';
import { resolveChatLanguageCode } from '../domain/chatLanguage.js';
import { createChatState } from '../domain/createChatState.js';
import { shouldUseGroundedSearch } from '../domain/groundedSearchIntent.js';
import {
  CHAT_TRANSLATION_LANGUAGES,
  getTranslationLanguageLabel,
  getTranslationLanguageSpeechLocale,
} from '../domain/translationLanguages.js';
import {
  BrowserAudioPlayer,
  BrowserLiveAudioPlayer,
  BrowserLiveMicrophone,
  BrowserSpeechSynthesizer,
  createSpeechRecognition,
  repeatSpeech,
} from '../infrastructure/browserAudio.js';
import { loadChatAppearance, loadChatSnapshots, saveChatAppearance, saveChatSnapshots } from '../infrastructure/chatLocalStorage.js';
import { GeminiGroundedSearchClient } from '../infrastructure/geminiGroundedSearchClient.js';
import { GeminiLiteralTranslator } from '../infrastructure/geminiLiteralTranslator.js';
import { GeminiLiveTextClient } from '../infrastructure/geminiLiveTextClient.js';
import { GeminiTextRefiner } from '../infrastructure/geminiTextRefiner.js';
import { GeminiTtsClient } from '../infrastructure/geminiTtsClient.js';
import { GoogleTranslator } from '../infrastructure/googleTranslator.js';

const AUTO_TRANSLATION_DEBOUNCE_MS = 80;
const GEMINI_TTS_START_WAIT_MS = 350;
const INPUT_TTS_REPEAT_COUNT = 2;
const INPUT_TTS_REPEAT_DELAY_MS = 200;
const SENTENCE_TTS_REPEAT_COUNT = 2;
const INPUT_TRANSCRIPT_MERGE_MS = 10000;
const APPEARANCE_PALETTE_WIDTH = 180;
const APPEARANCE_PALETTE_HEIGHT = 124;
const APPEARANCE_VALUE_BAR_HEIGHT = 124;
const APPEARANCE_HUE_STEPS = 18;
const APPEARANCE_SATURATION_STEPS = 12;
const APPEARANCE_VALUE_STEPS = 12;
const APPEARANCE_FALLBACK_COLORS = Object.freeze({
  ...DEFAULT_CHAT_APPEARANCE,
  iconFrameBackgroundColor: '#7C8798',
  aiBubbleBorderColor: '#7C8798',
  myBubbleBorderColor: '#7C8798',
});

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function createButton(label, action, className = '') {
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.action = action;
  button.className = className;
  button.textContent = label;
  return button;
}

function getMessageById(chatState, messageId) {
  return chatState.messages.find((message) => message.id === messageId) ?? null;
}

function getTranslationLines(map, message) {
  const snapshot = map[message.id];
  if (!snapshot || snapshot.sourceText !== message.text.trim()) {
    return [];
  }
  return snapshot.lines;
}

function buildSnapshotTitle(messages) {
  const lastMessage = [...messages].reverse().find((message) => message.text.trim());
  if (!lastMessage) {
    return new Date().toLocaleString('ko-KR');
  }
  return lastMessage.text.trim().slice(0, 28);
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

function normalizeSourceText(text, languageCode) {
  if (languageCode === 'ko') {
    return normalizeKoreanSpacing(text);
  }

  if (languageCode === 'en') {
    return normalizeEnglishSpacing(text);
  }

  return text.trim();
}

function clampUnit(value) {
  return Math.max(0, Math.min(1, value));
}

function clampMarker(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getAppearancePickerColor(appearance, target) {
  const currentColor = getChatAppearanceColor(appearance, target);
  return hexToHsv(currentColor)
    ?? hexToHsv(APPEARANCE_FALLBACK_COLORS[target] ?? DEFAULT_CHAT_APPEARANCE.panelBackgroundColor)
    ?? { h: 0, s: 0, v: 1 };
}

function getAudioSampleRate(mimeType) {
  const rateMatch = `${mimeType}`.match(/rate=(\d+)/);
  return rateMatch ? Number.parseInt(rateMatch[1], 10) : 24000;
}

function createActiveApiKeys(storedChatApiKey) {
  const storedKey = storedChatApiKey.trim();
  const chatApiKey = storedKey || CO_SECOND_API_KEYS.chatApiKey;
  return {
    chatApiKey,
    groundedSearchApiKey: CO_SECOND_API_KEYS.groundedSearchApiKey || chatApiKey,
    analysisApiKey: CO_SECOND_API_KEYS.analysisApiKey,
    isUsingStoredChatKey: Boolean(storedKey),
  };
}

export function createChatController({
  state,
  hostElement,
  onStateChange,
  onMessage,
}) {
  if (!state.chat) {
    state.chat = createChatState();
  }

  const chatState = state.chat;
  const audioPlayer = new BrowserAudioPlayer();
  const liveAudioPlayer = new BrowserLiveAudioPlayer();
  const liveMicrophone = new BrowserLiveMicrophone({
    onChunk: handleLiveMicrophoneChunk,
    onError: handleLiveMicrophoneError,
  });
  const speechSynthesizer = new BrowserSpeechSynthesizer();
  const googleTranslator = new GoogleTranslator();
  let liveClient = null;
  let groundedSearchClient = null;
  let literalTranslator = null;
  let textRefiner = null;
  let ttsClient = null;
  let storedApiKey = loadApiKey();
  let activeApiKeys = createActiveApiKeys(storedApiKey);
  let hasSentInitialGreeting = false;
  let currentAiText = '';
  let currentAiMessageId = null;
  let autoTranslationTimer = null;
  let speechRecognition = null;
  let speechRecognitionShouldRestart = false;
  let wantsLiveMicrophone = true;
  let hasTriedAutomaticLiveMicrophone = false;
  let didQueueLiveAudioInTurn = false;
  let isTextInputActive = false;
  let lastInputTranslationKey = '';
  let isInitialGreetingInProgress = false;
  let shouldStartMicrophoneAfterPlayback = false;
  let isHoldingLiveMicrophoneInputForAi = false;

  chatState.apiKeyDraft = storedApiKey;
  chatState.isApiKeyPanelVisible = !activeApiKeys.chatApiKey;
  chatState.isOpen = false;
  chatState.snapshots = loadChatSnapshots();
  chatState.appearance = {
    ...createDefaultChatAppearance(),
    ...(loadChatAppearance() ?? {}),
  };

  liveAudioPlayer.onPlaybackDone = () => {
    if (isInitialGreetingInProgress) {
      isInitialGreetingInProgress = false;
    }
    isHoldingLiveMicrophoneInputForAi = false;
    if (shouldStartMicrophoneAfterPlayback) {
      shouldStartMicrophoneAfterPlayback = false;
      resumeMainLiveMicrophoneIfWanted();
    }
    if (!hasActiveChatApiKey()) {
      return;
    }
    chatState.connectionState = 'listening';
    update();
  };

  const layer = document.createElement('section');
  layer.className = 'chat-panel-layer';
  layer.innerHTML = `
    <section class="chat-panel" aria-label="채팅 패널" hidden>
      <div class="chat-error-strip" hidden></div>
      <div class="chat-surface">
        <div class="chat-api-panel" hidden>
          <div class="chat-api-box">
            <strong>Gemini API key</strong>
            <input class="chat-api-input" type="password" autocomplete="off" spellcheck="false" />
            <div class="chat-api-actions">
              <button type="button" data-action="save-api-key">저장</button>
              <button type="button" data-action="clear-api-key">삭제</button>
            </div>
            <span class="chat-api-models"></span>
          </div>
        </div>
        <div class="chat-appearance-editor" hidden></div>
        <div class="chat-message-list" role="log" aria-live="polite"></div>
        <form class="chat-composer" hidden>
          <textarea class="chat-composer-input" rows="2" placeholder="메시지를 입력하세요..."></textarea>
          <button type="submit" class="chat-composer-send" aria-label="전송">➤</button>
        </form>
        <div class="chat-translation-input" hidden>
          <div class="chat-translation-backdrop"></div>
          <div class="chat-translation-card">
            <div class="chat-language-panel" hidden></div>
            <div class="chat-translated-text"></div>
            <textarea class="chat-translation-textarea" placeholder="메시지를 입력하세요..."></textarea>
            <div class="chat-input-iconbar">
              <button type="button" data-action="input-mic" aria-label="마이크">🎤</button>
              <button type="button" data-action="input-refine" aria-label="다듬기">✨</button>
              <button type="button" data-action="input-translate" aria-label="번역">Aa</button>
              <button type="button" data-action="toggle-language-panel" aria-label="언어">
                <span class="chat-input-translate-icon"></span>
              </button>
              <button type="button" data-action="input-speak" aria-label="읽기">🔊</button>
              <button type="button" data-action="input-clear" aria-label="삭제">🗑️</button>
              <button type="button" data-action="input-submit" aria-label="전송">▶</button>
            </div>
          </div>
        </div>
        <aside class="chat-side-column" hidden>
          <button type="button" data-action="save-snapshot" aria-label="저장">
            <span class="chat-side-icon-frame">⇩</span>
          </button>
          <button type="button" data-action="open-snapshots" aria-label="폴더">
            <span class="chat-side-icon-frame">▣</span>
          </button>
          <button type="button" data-action="toggle-appearance" aria-label="색상">
            <span class="chat-side-icon-frame"><span class="chat-palette-glyph"></span></span>
          </button>
          <button type="button" data-action="toggle-transparent" aria-label="투명">
            <span class="chat-side-icon-frame">◐</span>
          </button>
          <button type="button" data-action="toggle-input" aria-label="번역 입력">
            <span class="chat-side-icon-frame"><span class="chat-text-input-glyph">✎</span></span>
          </button>
          <button type="button" data-action="toggle-composer" aria-label="문자 입력">
            <span class="chat-side-icon-frame">➤</span>
          </button>
          <button type="button" data-action="toggle-expanded" aria-label="확대">
            <span class="chat-side-icon-frame">⛶</span>
          </button>
          <button type="button" data-action="toggle-minimized" aria-label="축소">
            <span class="chat-side-icon-frame">⊟</span>
          </button>
        </aside>
        <div class="chat-snapshot-modal" hidden>
          <div class="chat-snapshot-sheet">
            <div class="chat-snapshot-header">
              <strong>채팅 저장함</strong>
              <button type="button" data-action="close-snapshots">×</button>
            </div>
            <div class="chat-snapshot-list"></div>
          </div>
        </div>
      </div>
    </section>
  `;
  hostElement.appendChild(layer);

  const elements = {
    panel: layer.querySelector('.chat-panel'),
    errorStrip: layer.querySelector('.chat-error-strip'),
    messageList: layer.querySelector('.chat-message-list'),
    sideColumn: layer.querySelector('.chat-side-column'),
    apiPanel: layer.querySelector('.chat-api-panel'),
    apiInput: layer.querySelector('.chat-api-input'),
    apiModels: layer.querySelector('.chat-api-models'),
    composer: layer.querySelector('.chat-composer'),
    composerInput: layer.querySelector('.chat-composer-input'),
    translationInput: layer.querySelector('.chat-translation-input'),
    translationCard: layer.querySelector('.chat-translation-card'),
    translationTextarea: layer.querySelector('.chat-translation-textarea'),
    translatedText: layer.querySelector('.chat-translated-text'),
    inputIconBar: layer.querySelector('.chat-input-iconbar'),
    languagePanel: layer.querySelector('.chat-language-panel'),
    appearanceEditor: layer.querySelector('.chat-appearance-editor'),
    snapshotModal: layer.querySelector('.chat-snapshot-modal'),
    snapshotList: layer.querySelector('.chat-snapshot-list'),
  };

  function update() {
    render();
    onStateChange?.();
  }

  function refreshActiveApiKeys() {
    activeApiKeys = createActiveApiKeys(storedApiKey);
    return activeApiKeys;
  }

  function hasActiveChatApiKey() {
    return Boolean(activeApiKeys.chatApiKey);
  }

  function createClients() {
    refreshActiveApiKeys();
    if (!activeApiKeys.chatApiKey) {
      liveClient = null;
      groundedSearchClient = null;
      literalTranslator = null;
      textRefiner = null;
      ttsClient = null;
      return;
    }

    groundedSearchClient = new GeminiGroundedSearchClient({
      apiKey: activeApiKeys.groundedSearchApiKey,
      model: CHAT_CONFIG.groundedSearchModel,
    });
    literalTranslator = new GeminiLiteralTranslator({
      apiKey: activeApiKeys.chatApiKey,
      model: CHAT_CONFIG.literalTranslationModel,
      fallbackModel: CHAT_CONFIG.literalTranslationFallbackModel,
    });
    textRefiner = new GeminiTextRefiner({
      apiKey: activeApiKeys.chatApiKey,
      model: CHAT_CONFIG.textRefinerModel,
    });
    ttsClient = new GeminiTtsClient({
      apiKey: activeApiKeys.chatApiKey,
      model: CHAT_CONFIG.ttsModel,
      fallbackModel: CHAT_CONFIG.ttsFallbackModel,
      voiceName: CHAT_CONFIG.ttsVoiceName,
      promptPrefix: CHAT_CONFIG.ttsPromptPrefix,
    });

    liveClient = new GeminiLiveTextClient({
      apiKey: activeApiKeys.chatApiKey,
      model: CHAT_CONFIG.liveModel,
      systemPrompt: buildLiveSystemPrompt(),
      initialGreetingPrompt: CHAT_CONFIG.liveInitialGreetingPrompt,
      liveVoiceName: CHAT_CONFIG.liveVoiceName,
    });
    liveClient.onConnectionChange = (connected) => {
      if (!connected) {
        liveAudioPlayer.stop();
        stopLiveMicrophone({ keepPreference: true });
      }
      chatState.connectionState = connected ? 'listening' : 'idle';
      update();
    };
    liveClient.onTextDelta = handleAiTextDelta;
    liveClient.onInputTranscript = handleInputTranscript;
    liveClient.onTurnComplete = handleAiTurnComplete;
    liveClient.onAudioChunk = handleAiAudioChunk;
    liveClient.onInterrupted = handleAiInterrupted;
    liveClient.onError = (message) => {
      chatState.errorMessage = message;
      update();
    };
  }

  function handleAiAudioChunk(audioBase64, mimeType) {
    if (!audioBase64) {
      return;
    }

    if (isTextInputActive) {
      liveAudioPlayer.stop();
      return;
    }

    holdLiveMicrophoneInputForAiOutput();
    const didQueue = liveAudioPlayer.playChunk(audioBase64, getAudioSampleRate(mimeType));
    if (!didQueue) {
      return;
    }

    didQueueLiveAudioInTurn = true;
    chatState.connectionState = 'speaking';
    update();
  }

  function ensureApiKey() {
    refreshActiveApiKeys();
    if (activeApiKeys.chatApiKey) {
      return true;
    }
    chatState.isApiKeyPanelVisible = true;
    chatState.isOpen = true;
    update();
    onMessage?.('Gemini API key를 사용할 수 없어 채팅을 시작할 수 없습니다.');
    return false;
  }

  async function ensureLiveConnected({ sendGreeting = false, startMicrophone = true } = {}) {
    if (chatState.isRecordingMicEnabled) {
      return false;
    }

    if (!ensureApiKey()) {
      return false;
    }

    if (!liveClient) {
      createClients();
    }

    if (!liveClient) {
      return false;
    }

    if (!liveClient.isConnected()) {
      chatState.connectionState = 'connecting';
      update();
      await liveClient.connect();
    }

    if (sendGreeting && !hasSentInitialGreeting) {
      hasSentInitialGreeting = true;
      isInitialGreetingInProgress = true;
      didQueueLiveAudioInTurn = false;
      currentAiText = '';
      currentAiMessageId = null;
      liveClient.sendInitialGreeting();
    }

    if (startMicrophone && wantsLiveMicrophone) {
      startOrDeferLiveMicrophone();
    }

    return true;
  }

  function handleLiveMicrophoneError(message) {
    chatState.isLiveMicActive = false;
    chatState.isLiveMicStarting = false;
    chatState.errorMessage = message;
    onMessage?.(message);
    update();
  }

  async function ensureLiveMicrophone({ explicit = false } = {}) {
    if (chatState.isRecordingMicEnabled || isTextInputActive) {
      return false;
    }

    if (!explicit && hasTriedAutomaticLiveMicrophone && !chatState.isLiveMicActive) {
      return false;
    }

    if (!wantsLiveMicrophone && !explicit) {
      return false;
    }

    if (!liveClient?.isConnected()) {
      return false;
    }

    if (liveMicrophone.isActive()) {
      chatState.isLiveMicActive = true;
      chatState.isLiveMicStarting = false;
      update();
      return true;
    }

    if (!explicit) {
      hasTriedAutomaticLiveMicrophone = true;
    }

    chatState.isLiveMicStarting = true;
    update();
    const didStart = await liveMicrophone.start();
    if (didStart && isAiOutputInProgress()) {
      holdLiveMicrophoneInputForAiOutput();
      shouldStartMicrophoneAfterPlayback = wantsLiveMicrophone;
    }
    chatState.isLiveMicStarting = false;
    chatState.isLiveMicActive = didStart;
    if (didStart) {
      chatState.errorMessage = '';
    }
    update();
    return didStart;
  }

  function startOrDeferLiveMicrophone({ explicit = false } = {}) {
    if (chatState.isRecordingMicEnabled || isTextInputActive || !wantsLiveMicrophone || !liveClient?.isConnected()) {
      return false;
    }

    if (isAiOutputInProgress()) {
      shouldStartMicrophoneAfterPlayback = true;
      return false;
    }

    void ensureLiveMicrophone({ explicit });
    return true;
  }

  function stopLiveMicrophone({ keepPreference = false } = {}) {
    if (!keepPreference) {
      wantsLiveMicrophone = false;
      shouldStartMicrophoneAfterPlayback = false;
    }
    isHoldingLiveMicrophoneInputForAi = false;
    liveMicrophone.stop();
    chatState.isLiveMicActive = false;
    chatState.isLiveMicStarting = false;
    update();
  }

  function pauseMainLiveMicrophoneForInput() {
    isHoldingLiveMicrophoneInputForAi = false;
    shouldStartMicrophoneAfterPlayback = false;
    liveMicrophone.stop();
    chatState.isLiveMicActive = false;
    chatState.isLiveMicStarting = false;
  }

  function holdLiveMicrophoneInputForAiOutput() {
    isHoldingLiveMicrophoneInputForAi = true;
    shouldStartMicrophoneAfterPlayback = wantsLiveMicrophone;
  }

  function isAiOutputInProgress() {
    return Boolean(
      isInitialGreetingInProgress
        || currentAiMessageId
        || currentAiText.trim()
        || liveAudioPlayer.isPlaying(),
    );
  }

  function resumeMainLiveMicrophoneIfWanted() {
    if (chatState.isRecordingMicEnabled || isTextInputActive || !wantsLiveMicrophone || !liveClient?.isConnected()) {
      return;
    }
    startOrDeferLiveMicrophone({ explicit: true });
  }

  function setTextInputActive(active) {
    isTextInputActive = active;
    if (!active) {
      return;
    }

    liveAudioPlayer.stop();
    if (currentAiMessageId) {
      const message = getMessageById(chatState, currentAiMessageId);
      if (message) {
        message.status = 'ready';
      }
    }
    currentAiText = '';
    currentAiMessageId = null;
    chatState.currentAiMessageId = null;
    if (hasActiveChatApiKey()) {
      chatState.connectionState = 'listening';
    }
  }

  function clearInputTranslation() {
    chatState.input.translatedText = '';
    lastInputTranslationKey = '';
  }

  function deactivateInputMic({ resumeMain = true } = {}) {
    chatState.input.isInputMicActive = false;
    setTextInputActive(false);
    stopSpeechRecognition();
    if (resumeMain) {
      resumeMainLiveMicrophoneIfWanted();
    }
  }

  function handleLiveMicrophoneChunk(base64) {
    if (!base64 || !liveClient?.isConnected()) {
      return;
    }

    if (isTextInputActive) {
      return;
    }

    if (isHoldingLiveMicrophoneInputForAi || isAiOutputInProgress()) {
      return;
    }

    liveClient.sendAudio(base64, 'audio/pcm;rate=16000');
  }

  function handleInputTranscript(text) {
    if (!text) {
      return;
    }
    const trimmedTranscript = text.trim();

    if (isTextInputActive) {
      if (chatState.input.isVisible && chatState.input.isInputMicActive && !chatState.input.isSpeaking) {
        chatState.input.value = `${chatState.input.value}${text}`;
        clearInputTranslation();
        scheduleAutoTranslation();
        update();
      }
      return;
    }

    const now = Date.now();
    const lastMessage = chatState.messages[chatState.messages.length - 1];
    const shouldExtendLastUserMessage = lastMessage
      && lastMessage.role === 'user'
      && now - lastMessage.createdAt < INPUT_TRANSCRIPT_MERGE_MS;

    if (shouldExtendLastUserMessage) {
      lastMessage.text = `${lastMessage.text}${text}`;
      lastMessage.createdAt = now;
    } else if (trimmedTranscript) {
      chatState.messages.push(createUserMessage(text));
    }

    chatState.isOpen = true;
    chatState.isSending = true;
    chatState.connectionState = liveAudioPlayer.isPlaying() ? 'speaking' : 'processing';
    update();
    scrollToEnd();

    // Do not send extra clientContent here. Runtime context updates can interrupt
    // an answer that the Live model has already started speaking.
  }

  function handleAiTextDelta(text) {
    if (!text) {
      return;
    }

    if (isTextInputActive) {
      return;
    }

    holdLiveMicrophoneInputForAiOutput();
    currentAiText += text;
    if (!currentAiMessageId) {
      const message = createAiMessage(currentAiText, 'streaming', 'live');
      currentAiMessageId = message.id;
      chatState.currentAiMessageId = message.id;
      chatState.messages.push(message);
    } else {
      const message = getMessageById(chatState, currentAiMessageId);
      if (message) {
        message.text = currentAiText;
        message.status = 'streaming';
        message.createdAt = Date.now();
      }
    }

    update();
    scrollToEnd();
  }

  function handleAiInterrupted() {
    liveAudioPlayer.stop();
    didQueueLiveAudioInTurn = false;
    isHoldingLiveMicrophoneInputForAi = false;
    if (isTextInputActive) {
      currentAiText = '';
      currentAiMessageId = null;
      chatState.currentAiMessageId = null;
      if (hasActiveChatApiKey()) {
        chatState.connectionState = 'listening';
      }
      update();
      return;
    }
    handleAiTurnComplete();
  }

  async function speakInitialGreetingFallback(text) {
    const trimmed = text.trim();
    if (!trimmed) {
      return;
    }

    pauseMainLiveMicrophoneForInput();
    try {
      let didPlayGeminiTts = false;
      if (ttsClient) {
        try {
          const audioSource = await Promise.race([
            ttsClient.generateAudio(trimmed),
            new Promise((resolve) => {
              setTimeout(() => resolve(''), GEMINI_TTS_START_WAIT_MS);
            }),
          ]);
          if (audioSource) {
            await audioPlayer.play(audioSource);
            didPlayGeminiTts = true;
          }
        } catch {
          didPlayGeminiTts = false;
        }
      }

      if (!didPlayGeminiTts) {
        await repeatSpeech(
          speechSynthesizer,
          trimmed,
          1,
          0,
          {
            language: 'en-US',
            pitch: 1.08,
            rate: 0.92,
          },
        );
      }
    } catch {
      // Startup greeting audio is best-effort when the Live API sends text only.
    } finally {
      if (isInitialGreetingInProgress) {
        isInitialGreetingInProgress = false;
      }
      isHoldingLiveMicrophoneInputForAi = false;
      if (shouldStartMicrophoneAfterPlayback) {
        shouldStartMicrophoneAfterPlayback = false;
        resumeMainLiveMicrophoneIfWanted();
      }
      if (hasActiveChatApiKey()) {
        chatState.connectionState = 'listening';
      }
      update();
    }
  }

  function handleAiTurnComplete() {
    if (isTextInputActive) {
      currentAiText = '';
      currentAiMessageId = null;
      chatState.currentAiMessageId = null;
      chatState.isSending = false;
      chatState.connectionState = hasActiveChatApiKey() ? 'listening' : 'idle';
      update();
      return;
    }

    if (currentAiMessageId) {
      const message = getMessageById(chatState, currentAiMessageId);
      if (message) {
        message.status = 'ready';
      }
    }
    const completedAiText = currentAiText.trim();
    const shouldUseInitialGreetingFallback = isInitialGreetingInProgress
      && completedAiText
      && !didQueueLiveAudioInTurn;
    currentAiText = '';
    currentAiMessageId = null;
    chatState.currentAiMessageId = null;
    chatState.isSending = false;
    if (shouldUseInitialGreetingFallback) {
      void speakInitialGreetingFallback(completedAiText);
    } else {
      liveAudioPlayer.markTurnEnd();
    }
    didQueueLiveAudioInTurn = false;
    chatState.connectionState = hasActiveChatApiKey()
      ? (shouldUseInitialGreetingFallback || liveAudioPlayer.isPlaying() ? 'speaking' : 'listening')
      : 'idle';
    update();
  }

  function appendErrorMessage(text) {
    chatState.messages.push(createErrorMessage(text));
    chatState.isSending = false;
    update();
    scrollToEnd();
  }

  function appendAiMessage(text, source = 'manual') {
    if (!text.trim()) {
      return null;
    }
    const message = createAiMessage(text, 'ready', source);
    chatState.messages.push(message);
    update();
    scrollToEnd();
    return message;
  }

  async function sendTextTurn(text, options = {}) {
    const trimmed = text.trim();
    if (!trimmed) {
      return false;
    }
    const responseLanguageCode = options.languageCode
      ?? resolveChatLanguageCode(trimmed)
      ?? '';

    chatState.isOpen = true;
    isHoldingLiveMicrophoneInputForAi = false;
    liveAudioPlayer.stop();
    chatState.messages.push(createUserMessage(trimmed));
    chatState.isSending = true;
    chatState.errorMessage = '';
    update();
    scrollToEnd();

    if (shouldUseGroundedSearch(trimmed)) {
      appendAiMessage(buildGroundedSearchHandoff(trimmed, responseLanguageCode), 'live');
      await runGroundedSearch(trimmed, { languageCode: responseLanguageCode });
      chatState.isSending = false;
      update();
      return true;
    }

    try {
      const connected = await ensureLiveConnected();
      if (!connected || !liveClient) {
        chatState.isSending = false;
        update();
        return false;
      }
      currentAiText = '';
      currentAiMessageId = null;
      didQueueLiveAudioInTurn = false;
      liveClient.sendTextTurn(buildTypedUserTurn(trimmed, responseLanguageCode));
      return true;
    } catch (error) {
      appendErrorMessage(toChatErrorMessage(error));
      return false;
    }
  }

  async function runGroundedSearch(query, options = {}) {
    try {
      if (!groundedSearchClient) {
        if (!ensureApiKey()) {
          return;
        }
        createClients();
      }

      const result = await groundedSearchClient.searchLatestInfo(query, new Date(), {
        languageCode: options.languageCode ?? '',
      });
      appendAiMessage(result.displayText, 'analysis');
    } catch (error) {
      appendAiMessage(toGroundedSearchMessage(error, query, options.languageCode ?? ''), 'analysis');
    }
  }

  async function toggleMessageTranslation(messageId, literal = false) {
    const message = getMessageById(chatState, messageId);
    if (!message || message.role !== 'ai' || !message.text.trim()) {
      return;
    }

    const visibleMap = literal ? chatState.visibleLiteralTranslations : chatState.visibleTranslations;
    const cacheMap = literal ? chatState.literalTranslations : chatState.translations;
    const loadingMap = literal ? chatState.literalTranslating : chatState.translating;
    const cached = cacheMap[message.id];
    const sourceText = message.text.trim();

    if (visibleMap[message.id]) {
      visibleMap[message.id] = false;
      update();
      return;
    }

    if (cached?.sourceText === sourceText) {
      visibleMap[message.id] = true;
      update();
      return;
    }

    loadingMap[message.id] = true;
    update();

    try {
      const lines = splitChatMessageLines(sourceText);
      const translatedLines = literal
        ? await translateLiteralLines(lines)
        : await translateGeneralLines(lines);
      cacheMap[message.id] = {
        sourceText,
        lines: translatedLines.map((line) => line.trim()).filter(Boolean),
      };
      visibleMap[message.id] = true;
    } catch (error) {
      chatState.errorMessage = toChatErrorMessage(error);
    } finally {
      loadingMap[message.id] = false;
      update();
    }
  }

  async function translateGeneralLines(lines) {
    return Promise.all(lines.map((line) => {
      const direction = getTranslationDirection(line);
      return googleTranslator.translate(line, direction.from, direction.to);
    }));
  }

  async function translateLiteralLines(lines) {
    if (!literalTranslator) {
      if (!ensureApiKey()) {
        return [];
      }
      createClients();
    }

    if (!literalTranslator) {
      return [];
    }

    return Promise.all(lines.map((line) => literalTranslator.translate(line, 'en', 'ko')));
  }

  async function speakText(message, text, repeatCount) {
    const trimmed = text.trim();
    if (!message || message.role !== 'ai' || !trimmed) {
      return;
    }

    liveAudioPlayer.stop();
    chatState.speakingMessageId = message.id;
    update();

    try {
      let didPlayGeminiTts = false;
      if (ttsClient) {
        try {
          const audioSource = await Promise.race([
            ttsClient.generateAudio(trimmed),
            new Promise((resolve) => {
              setTimeout(() => resolve(''), GEMINI_TTS_START_WAIT_MS);
            }),
          ]);
          if (audioSource) {
            for (let index = 0; index < repeatCount; index += 1) {
              await audioPlayer.play(audioSource);
              if (index < repeatCount - 1 && CHAT_CONFIG.ttsRepeatDelayMs > 0) {
                await wait(CHAT_CONFIG.ttsRepeatDelayMs);
              }
            }
            didPlayGeminiTts = true;
          }
        } catch {
          didPlayGeminiTts = false;
        }
      }

      if (!didPlayGeminiTts) {
        await repeatSpeech(
          speechSynthesizer,
          trimmed,
          repeatCount,
          CHAT_CONFIG.ttsRepeatDelayMs,
          {
            language: getTranslationLanguageSpeechLocale(resolveChatLanguageCode(trimmed)) ?? 'en-US',
            pitch: 1.08,
            rate: 0.92,
          },
        );
      }
    } catch (error) {
      chatState.errorMessage = toChatErrorMessage(error);
    } finally {
      chatState.speakingMessageId = null;
      update();
    }
  }

  function stopSpeechRecognition() {
    speechRecognitionShouldRestart = false;
    if (!speechRecognition) {
      return;
    }
    try {
      speechRecognition.stop();
    } catch {
      // Ignore stale recognition handles.
    }
    speechRecognition = null;
  }

  function startSpeechRecognition() {
    if (chatState.isRecordingMicEnabled) {
      return;
    }

    stopSpeechRecognition();
    pauseMainLiveMicrophoneForInput();
    setTextInputActive(true);
    const recognition = createSpeechRecognition({
      language: getTranslationLanguageSpeechLocale(chatState.input.sourceLanguageCode) ?? 'ko-KR',
      onText: (text) => {
        chatState.input.value = `${chatState.input.value}${text}`;
        clearInputTranslation();
        scheduleAutoTranslation();
        update();
      },
      onEnd: () => {
        if (speechRecognitionShouldRestart && chatState.input.isInputMicActive) {
          startSpeechRecognition();
        }
      },
      onError: () => {
        chatState.input.isInputMicActive = false;
        setTextInputActive(false);
        speechRecognitionShouldRestart = false;
        resumeMainLiveMicrophoneIfWanted();
        update();
      },
    });

    if (!recognition) {
      chatState.input.isInputMicActive = false;
      setTextInputActive(false);
      onMessage?.('이 브라우저는 음성 입력을 지원하지 않습니다.');
      resumeMainLiveMicrophoneIfWanted();
      return;
    }

    speechRecognition = recognition;
    speechRecognitionShouldRestart = true;
    try {
      recognition.start();
    } catch {
      chatState.input.isInputMicActive = false;
      setTextInputActive(false);
      speechRecognitionShouldRestart = false;
      resumeMainLiveMicrophoneIfWanted();
    }
  }

  function scheduleAutoTranslation() {
    if (autoTranslationTimer) {
      clearTimeout(autoTranslationTimer);
    }

    if (!chatState.input.isVisible || chatState.input.isSpeaking) {
      return;
    }

    const trimmed = chatState.input.value.trim();
    if (!trimmed || chatState.input.sourceLanguageCode === chatState.input.targetLanguageCode) {
      return;
    }

    const translationKey = [
      chatState.input.sourceLanguageCode,
      chatState.input.targetLanguageCode,
      normalizeSourceText(trimmed, chatState.input.sourceLanguageCode),
    ].join(':');
    if (translationKey === lastInputTranslationKey) {
      return;
    }

    autoTranslationTimer = setTimeout(() => {
      autoTranslationTimer = null;
      void translateInput({ autoSpeak: true });
    }, AUTO_TRANSLATION_DEBOUNCE_MS);
  }

  async function refineInput() {
    const trimmed = chatState.input.value.trim();
    if (!trimmed || chatState.input.isRefining || chatState.input.sourceLanguageCode !== 'ko') {
      return;
    }

    if (!textRefiner) {
      if (!ensureApiKey()) {
        return;
      }
      createClients();
    }

    if (!textRefiner) {
      return;
    }

    chatState.input.isRefining = true;
    update();
    try {
      const refined = await textRefiner.refine(trimmed);
      chatState.input.value = normalizeKoreanSpacing(refined || trimmed);
      clearInputTranslation();
    } catch (error) {
      chatState.errorMessage = toChatErrorMessage(error);
    } finally {
      chatState.input.isRefining = false;
      update();
    }
  }

  async function translateInput({ autoSpeak = false } = {}) {
    const trimmed = chatState.input.value.trim();
    const sourceLanguageCode = chatState.input.sourceLanguageCode;
    const targetLanguageCode = chatState.input.targetLanguageCode;
    if (!trimmed || sourceLanguageCode === targetLanguageCode || chatState.input.isTranslating) {
      return;
    }

    chatState.input.isTranslating = true;
    update();

    try {
      let finalSourceText = trimmed;
      if (sourceLanguageCode === 'ko') {
        finalSourceText = normalizeKoreanSpacing(trimmed);
      } else if (sourceLanguageCode === 'en') {
        finalSourceText = normalizeEnglishSpacing(trimmed);
      }
      finalSourceText = normalizeSourceText(finalSourceText, sourceLanguageCode);
      chatState.input.value = finalSourceText;

      const translationKey = [
        sourceLanguageCode,
        targetLanguageCode,
        finalSourceText,
      ].join(':');
      if (translationKey === lastInputTranslationKey && chatState.input.translatedText.trim()) {
        return;
      }

      const translated = await googleTranslator.translate(
        finalSourceText,
        sourceLanguageCode,
        targetLanguageCode,
      );

      chatState.input.translatedText = translated;
      lastInputTranslationKey = translationKey;
      if (autoSpeak && translated.trim()) {
        void speakInputTranslation();
      }
    } catch (error) {
      chatState.errorMessage = toChatErrorMessage(error);
    } finally {
      chatState.input.isTranslating = false;
      update();
    }
  }

  async function speakInputTranslation() {
    const translated = chatState.input.translatedText.trim();
    if (!translated || chatState.input.isSpeaking) {
      return;
    }

    pauseMainLiveMicrophoneForInput();
    speechRecognitionShouldRestart = false;
    stopSpeechRecognition();
    chatState.input.isInputMicActive = false;
    chatState.input.isSpeaking = true;
    update();
    try {
      let didSpeak = await repeatSpeech(
        speechSynthesizer,
        translated,
        INPUT_TTS_REPEAT_COUNT,
        INPUT_TTS_REPEAT_DELAY_MS,
        {
          language: getTranslationLanguageSpeechLocale(chatState.input.targetLanguageCode),
        },
      );

      if (!didSpeak && ttsClient) {
        try {
          const audioSource = await ttsClient.generateAudio(translated);
          if (audioSource) {
            for (let index = 0; index < INPUT_TTS_REPEAT_COUNT; index += 1) {
              await audioPlayer.play(audioSource);
              if (index < INPUT_TTS_REPEAT_COUNT - 1) {
                await wait(INPUT_TTS_REPEAT_DELAY_MS);
              }
            }
            didSpeak = true;
          }
        } catch {
          didSpeak = false;
        }
      }
    } finally {
      chatState.input.isSpeaking = false;
      deactivateInputMic({ resumeMain: false });
      update();
      resumeMainLiveMicrophoneIfWanted();
    }
  }

  function toggleInput() {
    chatState.input.isVisible = !chatState.input.isVisible;
    if (chatState.input.isVisible) {
      chatState.input.value = '';
      clearInputTranslation();
      chatState.input.isInputMicActive = true;
      chatState.composer.isVisible = false;
      startSpeechRecognition();
    } else {
      deactivateInputMic();
    }
    update();
  }

  function toggleLiveMicrophone() {
    chatState.isRecordingMicEnabled = !chatState.isRecordingMicEnabled;
    if (chatState.isRecordingMicEnabled) {
      deactivateInputMic({ resumeMain: false });
      stopLiveMicrophone({ keepPreference: true });
      liveAudioPlayer.stop();
      audioPlayer.stop();
      speechSynthesizer.stop();
      liveClient?.disconnect();
      currentAiText = '';
      currentAiMessageId = null;
      chatState.currentAiMessageId = null;
      chatState.connectionState = 'idle';
      chatState.isSending = false;
      chatState.errorMessage = '';
      onMessage?.('녹화 마이크 모드입니다. AI 대화를 끊었습니다.');
      update();
      return;
    }

    wantsLiveMicrophone = true;
    hasTriedAutomaticLiveMicrophone = false;
    onMessage?.('녹화 마이크 모드를 껐습니다. AI 대화를 다시 연결합니다.');
    update();
    if (hasActiveChatApiKey()) {
      void ensureLiveConnected({
        sendGreeting: !hasSentInitialGreeting && chatState.messages.length === 0,
        startMicrophone: true,
      }).catch((error) => {
        appendErrorMessage(toChatErrorMessage(error));
      });
    }
  }

  function toggleComposer() {
    chatState.composer.isVisible = !chatState.composer.isVisible;
    if (chatState.composer.isVisible) {
      chatState.input.isVisible = false;
      deactivateInputMic();
    }
    update();
    if (chatState.composer.isVisible) {
      setTimeout(() => elements.composerInput.focus(), 0);
    }
  }

  function saveSnapshot() {
    const now = new Date().toISOString();
    const snapshot = {
      id: `snapshot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title: buildSnapshotTitle(chatState.messages),
      createdAt: now,
      updatedAt: now,
      content: {
        messages: chatState.messages,
        translations: chatState.translations,
        visibleTranslations: chatState.visibleTranslations,
        literalTranslations: chatState.literalTranslations,
        visibleLiteralTranslations: chatState.visibleLiteralTranslations,
        appearance: chatState.appearance,
      },
    };
    chatState.snapshots = [snapshot, ...chatState.snapshots].slice(0, 30);
    saveChatSnapshots(chatState.snapshots);
    onMessage?.('채팅을 저장했습니다.');
    update();
  }

  function openSnapshot(snapshotId) {
    const snapshot = chatState.snapshots.find((item) => item.id === snapshotId);
    if (!snapshot?.content) {
      return;
    }

    chatState.messages = snapshot.content.messages ?? [];
    chatState.translations = snapshot.content.translations ?? {};
    chatState.visibleTranslations = snapshot.content.visibleTranslations ?? {};
    chatState.literalTranslations = snapshot.content.literalTranslations ?? {};
    chatState.visibleLiteralTranslations = snapshot.content.visibleLiteralTranslations ?? {};
    chatState.appearance = {
      ...createDefaultChatAppearance(),
      ...(snapshot.content.appearance ?? {}),
    };
    chatState.activeSnapshot = snapshot;
    chatState.isSnapshotLibraryVisible = false;
    saveChatAppearance(chatState.appearance);
    update();
  }

  function deleteSnapshot(snapshotId) {
    chatState.snapshots = chatState.snapshots.filter((snapshot) => snapshot.id !== snapshotId);
    saveChatSnapshots(chatState.snapshots);
    update();
  }

  function setAppearanceColor(target, color) {
    if (!target || !(target in chatState.appearance)) {
      return;
    }

    chatState.appearance[target] = color;
    saveChatAppearance(chatState.appearance);
    update();
  }

  function resetAppearance() {
    chatState.appearance = createDefaultChatAppearance();
    saveChatAppearance(chatState.appearance);
    update();
  }

  function clearConversation() {
    chatState.messages = [];
    chatState.currentAiMessageId = null;
    currentAiMessageId = null;
    currentAiText = '';
    chatState.translations = {};
    chatState.visibleTranslations = {};
    chatState.literalTranslations = {};
    chatState.visibleLiteralTranslations = {};
    chatState.errorMessage = '';
    update();
  }

  function scrollToEnd() {
    const scroll = () => {
      elements.messageList.scrollTop = elements.messageList.scrollHeight;
    };
    requestAnimationFrame(scroll);
    setTimeout(scroll, 80);
  }

  function renderMessages() {
    const fragment = document.createDocumentFragment();

    for (const message of chatState.messages) {
      const bubble = document.createElement('article');
      bubble.className = [
        'chat-bubble',
        message.role === 'ai' ? 'chat-bubble-ai' : 'chat-bubble-user',
        message.source === 'analysis' ? 'chat-bubble-analysis' : '',
        message.status === 'error' ? 'chat-bubble-error' : '',
      ].filter(Boolean).join(' ');
      bubble.dataset.messageId = message.id;
      bubble.style.maxWidth = '82%';
      if (message.role === 'ai') {
        bubble.style.backgroundColor = chatState.appearance.aiBubbleBackgroundColor;
        bubble.style.color = chatState.appearance.aiTextColor;
        bubble.style.borderColor = chatState.appearance.aiBubbleBorderColor;
      } else {
        bubble.style.backgroundColor = chatState.appearance.myBubbleBackgroundColor;
        bubble.style.color = chatState.appearance.myTextColor;
        bubble.style.borderColor = chatState.appearance.myBubbleBorderColor;
      }

      const content = document.createElement('div');
      content.className = 'chat-bubble-content';
      const translatedLines = chatState.visibleTranslations[message.id]
        ? getTranslationLines(chatState.translations, message)
        : [];
      const literalLines = chatState.visibleLiteralTranslations[message.id]
        ? getTranslationLines(chatState.literalTranslations, message)
        : [];
      splitChatMessageLines(message.text).forEach((line, index, lines) => {
        const group = document.createElement('div');
        group.className = 'chat-message-line-group';
        if (index < lines.length - 1) {
          group.classList.add(message.role === 'ai' ? 'chat-ai-sentence-gap' : 'chat-sentence-gap');
        }

        const row = document.createElement('div');
        row.className = 'chat-message-line';
        const bullet = document.createElement('button');
        bullet.type = 'button';
        bullet.className = 'chat-message-bullet';
        bullet.dataset.action = 'speak-sentence';
        bullet.dataset.messageId = message.id;
        bullet.dataset.lineIndex = String(index);
        bullet.disabled = message.role !== 'ai';
        bullet.style.backgroundColor = message.role === 'ai'
          ? chatState.appearance.aiTextColor
          : chatState.appearance.myTextColor;
        const text = document.createElement('span');
        text.className = containsKorean(line)
          ? 'chat-message-text chat-message-text-korean'
          : 'chat-message-text';
        text.textContent = line;
        row.append(bullet, text);
        group.append(row);

        if (message.role === 'ai' && translatedLines[index]) {
          const translation = document.createElement('div');
          translation.className = 'chat-translation-line';
          translation.style.color = chatState.appearance.aiKoreanTranslationTextColor;
          translation.textContent = translatedLines[index];
          group.append(translation);
        }

        if (message.role === 'ai' && literalLines[index]) {
          const literal = document.createElement('div');
          literal.className = 'chat-literal-line';
          literal.textContent = literalLines[index];
          group.append(literal);
        }

        content.append(group);
      });
      bubble.append(content);

      if (message.role === 'ai') {
        const isTranslationActive = chatState.translating[message.id] || chatState.visibleTranslations[message.id];
        const isLiteralActive = chatState.literalTranslating[message.id] || chatState.visibleLiteralTranslations[message.id];
        const isSpeaking = chatState.speakingMessageId === message.id;
        const translateButton = createButton('⇄', 'translate-message', 'chat-bubble-action chat-translate-action');
        translateButton.dataset.messageId = message.id;
        translateButton.classList.toggle('active', !!isTranslationActive);
        const literalButton = createButton('직', 'literal-message', 'chat-bubble-action chat-literal-action');
        literalButton.dataset.messageId = message.id;
        literalButton.classList.toggle('active', !!isLiteralActive);
        const speakerButton = createButton('🔊', 'speak-message', 'chat-bubble-action chat-speak-action');
        speakerButton.dataset.messageId = message.id;
        speakerButton.classList.toggle('active', !!isSpeaking);
        bubble.append(translateButton, literalButton, speakerButton);
      }

      fragment.append(bubble);
    }

    elements.messageList.replaceChildren(fragment);
  }

  function renderApiPanel() {
    elements.apiPanel.hidden = !chatState.isApiKeyPanelVisible;
    elements.apiInput.value = chatState.apiKeyDraft;
    elements.apiModels.textContent = [
      CHAT_CONFIG.liveModel,
      CHAT_CONFIG.groundedSearchModel,
      CHAT_CONFIG.literalTranslationModel,
      CHAT_CONFIG.ttsModel,
      CHAT_CONFIG.textRefinerModel,
    ].join(' · ');
  }

  function buildAppearanceTargetButton(target) {
    const targetColor = getChatAppearanceColor(chatState.appearance, target.id);
    const swatchColor = targetColor === 'transparent' ? '#7C8798' : targetColor;
    const className = [
      'chat-appearance-target',
      target.underline ? 'underlined' : '',
      chatState.appearanceTarget === target.id ? 'active' : '',
    ].filter(Boolean).join(' ');

    return `
      <button type="button" data-action="select-appearance-target" data-target="${target.id}" class="${className}">
        <span class="chat-appearance-target-swatch" style="background:${swatchColor}"></span>
        <span>${target.label}</span>
      </button>
    `;
  }

  function buildPaletteCells(pickerColor) {
    const cells = [];
    const cellWidth = APPEARANCE_PALETTE_WIDTH / APPEARANCE_HUE_STEPS;
    const cellHeight = APPEARANCE_PALETTE_HEIGHT / APPEARANCE_SATURATION_STEPS;

    for (let row = 0; row < APPEARANCE_SATURATION_STEPS; row += 1) {
      for (let col = 0; col < APPEARANCE_HUE_STEPS; col += 1) {
        const hue = (col / Math.max(1, APPEARANCE_HUE_STEPS - 1)) * 359;
        const saturation = 1 - (row / Math.max(1, APPEARANCE_SATURATION_STEPS - 1));
        cells.push(
          `<span class="chat-palette-cell" style="left:${col * cellWidth}px;top:${row * cellHeight}px;width:${cellWidth + 0.5}px;height:${cellHeight + 0.5}px;background:${hsvToHex({ h: hue, s: saturation, v: pickerColor.v })}"></span>`,
        );
      }
    }

    return cells.join('');
  }

  function buildValueCells(pickerColor) {
    const cells = [];
    const cellHeight = APPEARANCE_VALUE_BAR_HEIGHT / APPEARANCE_VALUE_STEPS;

    for (let row = 0; row < APPEARANCE_VALUE_STEPS; row += 1) {
      const value = 1 - (row / Math.max(1, APPEARANCE_VALUE_STEPS - 1));
      cells.push(
        `<span class="chat-value-cell" style="top:${row * cellHeight}px;height:${cellHeight + 0.5}px;background:${hsvToHex({ h: pickerColor.h, s: pickerColor.s, v: value })}"></span>`,
      );
    }

    return cells.join('');
  }

  function renderAppearanceEditor() {
    elements.appearanceEditor.hidden = !chatState.showAppearanceEditor || !chatState.showSideColumn;
    if (elements.appearanceEditor.hidden) {
      return;
    }

    const pickerColor = getAppearancePickerColor(chatState.appearance, chatState.appearanceTarget);
    const previewColor = hsvToHex(pickerColor);
    const paletteMarkerLeft = clampMarker((pickerColor.h / 359) * APPEARANCE_PALETTE_WIDTH - 7, -1, APPEARANCE_PALETTE_WIDTH - 13);
    const paletteMarkerTop = clampMarker((1 - pickerColor.s) * APPEARANCE_PALETTE_HEIGHT - 7, -1, APPEARANCE_PALETTE_HEIGHT - 13);
    const valueMarkerTop = clampMarker((1 - pickerColor.v) * APPEARANCE_VALUE_BAR_HEIGHT - 1, 0, APPEARANCE_VALUE_BAR_HEIGHT - 3);
    const targetColumns = CHAT_APPEARANCE_TARGET_COLUMNS.map((column, index) => (
      `<div class="chat-appearance-target-column ${index < CHAT_APPEARANCE_TARGET_COLUMNS.length - 1 ? 'spaced' : ''}">
        ${column.map(buildAppearanceTargetButton).join('')}
      </div>`
    )).join('');
    const actionTargets = CHAT_APPEARANCE_ACTION_TARGETS.map((target, index) => (
      `<button type="button" data-action="select-appearance-target" data-target="${target.id}" class="chat-appearance-action-target ${index > 0 ? 'spaced' : ''} ${chatState.appearanceTarget === target.id ? 'active' : ''}">
        <span class="chat-appearance-target-swatch" style="background:${getChatAppearanceColor(chatState.appearance, target.id)}"></span>
        <span>${target.label}</span>
      </button>`
    )).join('');

    elements.appearanceEditor.innerHTML = `
      <div class="chat-appearance-header">
        <span class="chat-appearance-preview" style="background:${previewColor}"></span>
        <span class="chat-appearance-preview-text">${previewColor}</span>
      </div>
      <div class="chat-appearance-targets">${targetColumns}</div>
      <div class="chat-appearance-actions">
        <button type="button" data-action="reset-appearance" class="chat-appearance-reset">기본값</button>
        ${actionTargets}
      </div>
      <div class="chat-appearance-picker-row">
        <div class="chat-color-palette" data-appearance-picker="palette">
          ${buildPaletteCells(pickerColor)}
          <span class="chat-palette-marker" style="left:${paletteMarkerLeft}px;top:${paletteMarkerTop}px"></span>
        </div>
        <div class="chat-value-bar" data-appearance-picker="value">
          ${buildValueCells(pickerColor)}
          <span class="chat-value-marker" style="top:${valueMarkerTop}px"></span>
        </div>
      </div>
    `;
  }

  function renderLanguagePanel() {
    const input = chatState.input;
    elements.languagePanel.hidden = !input.isLanguagePanelVisible;
    if (elements.languagePanel.hidden) {
      return;
    }

    const selectedCode = input.languageSelectionTarget === 'target'
      ? input.targetLanguageCode
      : input.sourceLanguageCode;

    const languageOptions = CHAT_TRANSLATION_LANGUAGES.map((language) => (
      `<button type="button" data-action="select-input-language" data-code="${language.code}" class="${language.code === selectedCode ? 'active' : ''}">${language.label}</button>`
    )).join('');

    elements.languagePanel.innerHTML = `
      <div class="chat-language-row">
        <button type="button" data-action="select-language-target" class="${input.languageSelectionTarget === 'target' ? 'active' : ''}">
          <span>위 번역</span><strong>${getTranslationLanguageLabel(input.targetLanguageCode)}</strong>
        </button>
        <button type="button" data-action="swap-input-languages" class="chat-language-swap">⇄</button>
        <button type="button" data-action="select-language-source" class="${input.languageSelectionTarget === 'source' ? 'active' : ''}">
          <span>아래 입력</span><strong>${getTranslationLanguageLabel(input.sourceLanguageCode)}</strong>
        </button>
      </div>
      <div class="chat-language-grid">${languageOptions}</div>
    `;
  }

  function renderInput() {
    const input = chatState.input;
    elements.translationInput.hidden = !input.isVisible;
    elements.translationTextarea.value = input.value;
    elements.translationTextarea.style.color = chatState.appearance.inputKoreanTextColor;
    elements.translationTextarea.style.backgroundColor = 'transparent';
    elements.translationCard.style.backgroundColor = chatState.appearance.inputBackgroundColor;
    elements.inputIconBar.style.backgroundColor = chatState.appearance.inputBackgroundColor;
    elements.inputIconBar.style.color = chatState.appearance.inputKoreanTextColor;
    elements.translatedText.style.color = chatState.appearance.inputEnglishTextColor;
    elements.translatedText.textContent = input.translatedText;
    elements.translationCard.classList.toggle('language-open', input.isLanguagePanelVisible);
    layer.querySelector('[data-action="input-mic"]')?.classList.toggle('active', input.isInputMicActive);
    layer.querySelector('[data-action="input-refine"]')?.classList.toggle('active', input.isRefining);
    layer.querySelector('[data-action="input-translate"]')?.classList.toggle('active', input.isTranslating);
    layer.querySelector('[data-action="input-speak"]')?.classList.toggle('active', input.isSpeaking);
    layer.querySelector('[data-action="toggle-language-panel"]')?.classList.toggle('active', input.isLanguagePanelVisible);
    renderLanguagePanel();
  }

  function renderSnapshots() {
    elements.snapshotModal.hidden = !chatState.isSnapshotLibraryVisible;
    if (elements.snapshotModal.hidden) {
      return;
    }

    const fragment = document.createDocumentFragment();
    if (chatState.snapshots.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'chat-snapshot-empty';
      empty.textContent = '저장된 채팅이 없습니다.';
      fragment.append(empty);
    }

    for (const snapshot of chatState.snapshots) {
      const row = document.createElement('div');
      row.className = 'chat-snapshot-row';
      const title = document.createElement('button');
      title.type = 'button';
      title.dataset.action = 'open-snapshot';
      title.dataset.snapshotId = snapshot.id;
      title.textContent = snapshot.title || snapshot.createdAt;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.dataset.action = 'delete-snapshot';
      remove.dataset.snapshotId = snapshot.id;
      remove.textContent = '×';
      row.append(title, remove);
      fragment.append(row);
    }

    elements.snapshotList.replaceChildren(fragment);
  }

  function renderSideColumnStyles() {
    const buttons = elements.sideColumn.querySelectorAll('button[data-action]');
    buttons.forEach((button) => {
      const frame = button.querySelector('.chat-side-icon-frame');
      const isActive = button.classList.contains('active');
      button.style.color = isActive ? '#FFFFFF' : chatState.appearance.iconInactiveColor;
      if (!frame) {
        return;
      }
      frame.style.borderColor = isActive ? '#FFFFFF' : chatState.appearance.iconFrameBorderColor;
      frame.style.backgroundColor = isActive ? '#1677FF' : chatState.appearance.iconFrameBackgroundColor;
    });
  }

  function render() {
    elements.panel.hidden = !chatState.isOpen;
    elements.panel.classList.toggle('chat-panel-expanded', chatState.layout === 'expanded');
    elements.panel.classList.toggle('chat-panel-minimized', chatState.layout === 'minimized');
    elements.panel.classList.toggle('chat-panel-transparent', chatState.isTransparent);
    elements.panel.classList.toggle('chat-panel-side-open', chatState.showSideColumn);
    elements.panel.style.backgroundColor = chatState.isTransparent
      ? 'transparent'
      : chatState.appearance.panelBackgroundColor;
    elements.sideColumn.hidden = !chatState.showSideColumn;
    elements.composer.hidden = !chatState.composer.isVisible;
    elements.composerInput.value = chatState.composer.draft;
    elements.errorStrip.hidden = !chatState.errorMessage;
    elements.errorStrip.title = chatState.errorMessage;

    renderMessages();
    renderApiPanel();
    renderAppearanceEditor();
    renderInput();
    renderSnapshots();

    layer.querySelector('[data-action="toggle-transparent"]')?.classList.toggle('active', chatState.isTransparent);
    layer.querySelector('[data-action="toggle-input"]')?.classList.toggle('active', chatState.input.isVisible);
    layer.querySelector('[data-action="toggle-composer"]')?.classList.toggle('active', chatState.composer.isVisible);
    layer.querySelector('[data-action="toggle-expanded"]')?.classList.toggle('active', chatState.layout === 'expanded');
    layer.querySelector('[data-action="toggle-minimized"]')?.classList.toggle('active', chatState.layout === 'minimized');
    layer.querySelector('[data-action="toggle-appearance"]')?.classList.toggle('active', chatState.showAppearanceEditor);
    renderSideColumnStyles();
  }

  function toChatErrorMessage(error) {
    if (error instanceof Error && error.message) {
      if (/401|403|API key|permission/i.test(error.message)) {
        return 'Gemini API key를 확인해 주세요.';
      }
      return error.message.slice(0, 160);
    }
    return '채팅 처리 중 오류가 발생했습니다.';
  }

  function handleClick(event) {
    const button = event.target.closest('[data-action]');
    if (!button || !layer.contains(button)) {
      return;
    }

    const action = button.dataset.action;
    const messageId = button.dataset.messageId;
    const snapshotId = button.dataset.snapshotId;

    switch (action) {
      case 'save-api-key': {
        const nextKey = elements.apiInput.value.trim();
        if (!nextKey) {
          return;
        }
        storedApiKey = nextKey;
        refreshActiveApiKeys();
        chatState.apiKeyDraft = nextKey;
        chatState.isApiKeyPanelVisible = false;
        saveApiKey(nextKey);
        if (liveClient) {
          liveClient.disconnect();
        }
        liveAudioPlayer.stop();
        hasSentInitialGreeting = false;
        createClients();
        update();
        void ensureLiveConnected({ sendGreeting: true }).catch((error) => {
          appendErrorMessage(toChatErrorMessage(error));
        });
        break;
      }
      case 'clear-api-key':
        storedApiKey = '';
        refreshActiveApiKeys();
        chatState.apiKeyDraft = '';
        chatState.isApiKeyPanelVisible = !hasActiveChatApiKey();
        clearApiKey();
        liveClient?.disconnect();
        liveAudioPlayer.stop();
        hasSentInitialGreeting = false;
        createClients();
        update();
        if (chatState.isOpen && hasActiveChatApiKey()) {
          void ensureLiveConnected({ sendGreeting: chatState.messages.length === 0 }).catch((error) => {
            appendErrorMessage(toChatErrorMessage(error));
          });
        }
        break;
      case 'translate-message':
        void toggleMessageTranslation(messageId, false);
        break;
      case 'literal-message':
        void toggleMessageTranslation(messageId, true);
        break;
      case 'speak-message': {
        const message = getMessageById(chatState, messageId);
        void speakText(message, message?.text ?? '', CHAT_CONFIG.ttsRepeatCount);
        break;
      }
      case 'speak-sentence': {
        const message = getMessageById(chatState, messageId);
        const lineIndex = Number.parseInt(button.dataset.lineIndex ?? '0', 10);
        const sentence = message ? splitChatMessageLines(message.text)[lineIndex] ?? '' : '';
        void speakText(message, sentence, SENTENCE_TTS_REPEAT_COUNT);
        break;
      }
      case 'save-snapshot':
        saveSnapshot();
        break;
      case 'open-snapshots':
        chatState.isSnapshotLibraryVisible = true;
        update();
        break;
      case 'close-snapshots':
        chatState.isSnapshotLibraryVisible = false;
        update();
        break;
      case 'open-snapshot':
        openSnapshot(snapshotId);
        break;
      case 'delete-snapshot':
        deleteSnapshot(snapshotId);
        break;
      case 'toggle-appearance':
        chatState.showAppearanceEditor = !chatState.showAppearanceEditor;
        update();
        break;
      case 'toggle-transparent':
        chatState.isTransparent = !chatState.isTransparent;
        update();
        break;
      case 'toggle-input':
        toggleInput();
        break;
      case 'toggle-composer':
        toggleComposer();
        break;
      case 'toggle-expanded':
        chatState.layout = chatState.layout === 'expanded' ? 'default' : 'expanded';
        chatState.showAppearanceEditor = chatState.layout === 'expanded' ? false : chatState.showAppearanceEditor;
        update();
        break;
      case 'toggle-minimized':
        chatState.layout = chatState.layout === 'minimized' ? 'default' : 'minimized';
        chatState.showAppearanceEditor = chatState.layout === 'minimized' ? false : chatState.showAppearanceEditor;
        update();
        break;
      case 'select-appearance-target':
        chatState.appearanceTarget = button.dataset.target;
        chatState.showAppearanceEditor = true;
        update();
        break;
      case 'reset-appearance':
        resetAppearance();
        break;
      case 'input-mic':
        chatState.input.isInputMicActive = !chatState.input.isInputMicActive;
        if (chatState.input.isInputMicActive) {
          startSpeechRecognition();
        } else {
          deactivateInputMic();
        }
        update();
        break;
      case 'input-refine':
        void refineInput();
        break;
      case 'input-translate':
        void translateInput({ autoSpeak: true });
        break;
      case 'toggle-language-panel':
        chatState.input.isLanguagePanelVisible = !chatState.input.isLanguagePanelVisible;
        update();
        break;
      case 'input-speak':
        void speakInputTranslation();
        break;
      case 'input-clear':
        chatState.input.value = '';
        clearInputTranslation();
        update();
        break;
      case 'input-submit': {
        const text = chatState.input.value.trim();
        if (text) {
          const languageCode = chatState.input.sourceLanguageCode;
          chatState.input.value = '';
          clearInputTranslation();
          void sendTextTurn(text, { languageCode });
        }
        break;
      }
      case 'select-language-target':
        chatState.input.languageSelectionTarget = 'target';
        update();
        break;
      case 'select-language-source':
        chatState.input.languageSelectionTarget = 'source';
        update();
        break;
      case 'select-input-language': {
        const code = button.dataset.code;
        if (chatState.input.languageSelectionTarget === 'target') {
          if (code !== chatState.input.sourceLanguageCode) {
            chatState.input.targetLanguageCode = code;
          }
        } else if (code !== chatState.input.targetLanguageCode) {
          chatState.input.sourceLanguageCode = code;
        }
        clearInputTranslation();
        chatState.input.isLanguagePanelVisible = false;
        update();
        break;
      }
      case 'swap-input-languages': {
        const previousSource = chatState.input.sourceLanguageCode;
        const previousValue = chatState.input.value;
        chatState.input.sourceLanguageCode = chatState.input.targetLanguageCode;
        chatState.input.targetLanguageCode = previousSource;
        chatState.input.value = chatState.input.translatedText;
        chatState.input.translatedText = previousValue;
        lastInputTranslationKey = '';
        update();
        break;
      }
      default:
        break;
    }
  }

  function updateAppearanceFromPicker(pointerEvent, pickerType) {
    const target = chatState.appearanceTarget;
    if (!target || !(target in chatState.appearance)) {
      return;
    }

    const picker = getAppearancePickerColor(chatState.appearance, target);
    if (pickerType === 'palette') {
      const palette = elements.appearanceEditor.querySelector('[data-appearance-picker="palette"]');
      if (!palette) {
        return;
      }
      const rect = palette.getBoundingClientRect();
      const x = pointerEvent.clientX - rect.left;
      const y = pointerEvent.clientY - rect.top;
      setAppearanceColor(target, hsvToHex({
        ...picker,
        h: clampUnit(x / APPEARANCE_PALETTE_WIDTH) * 359,
        s: 1 - clampUnit(y / APPEARANCE_PALETTE_HEIGHT),
      }));
      return;
    }

    if (pickerType === 'value') {
      const valueBar = elements.appearanceEditor.querySelector('[data-appearance-picker="value"]');
      if (!valueBar) {
        return;
      }
      const rect = valueBar.getBoundingClientRect();
      const y = pointerEvent.clientY - rect.top;
      setAppearanceColor(target, hsvToHex({
        ...picker,
        v: 1 - clampUnit(y / APPEARANCE_VALUE_BAR_HEIGHT),
      }));
    }
  }

  function handleGlobalAudioUnlock() {
    audioPlayer.unlock();
    liveAudioPlayer.unlock();
    liveMicrophone.unlock();
  }

  function handlePointerDown(event) {
    handleGlobalAudioUnlock();
    const picker = event.target.closest('[data-appearance-picker]');
    if (!picker || !layer.contains(picker)) {
      return;
    }

    event.preventDefault();
    const pickerType = picker.dataset.appearancePicker;
    updateAppearanceFromPicker(event, pickerType);

    const handlePointerMove = (moveEvent) => {
      updateAppearanceFromPicker(moveEvent, pickerType);
    };
    const handlePointerUp = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
  }

  elements.composer.addEventListener('submit', (event) => {
    event.preventDefault();
    const draft = elements.composerInput.value.trim();
    if (!draft) {
      return;
    }
    chatState.composer.draft = '';
    elements.composerInput.value = '';
    void sendTextTurn(draft);
  });

  elements.composerInput.addEventListener('input', () => {
    chatState.composer.draft = elements.composerInput.value;
  });

  elements.translationTextarea.addEventListener('input', () => {
    chatState.input.value = elements.translationTextarea.value;
    clearInputTranslation();
    scheduleAutoTranslation();
  });

  elements.apiInput.addEventListener('input', () => {
    chatState.apiKeyDraft = elements.apiInput.value;
  });

  layer.addEventListener('click', handleClick);
  layer.addEventListener('pointerdown', handlePointerDown);
  window.addEventListener('pointerdown', handleGlobalAudioUnlock, { passive: true });
  window.addEventListener('keydown', handleGlobalAudioUnlock);

  createClients();

  return {
    start() {
      render();
      if (hasActiveChatApiKey()) {
        void ensureLiveConnected({ sendGreeting: true, startMicrophone: false }).catch((error) => {
          chatState.errorMessage = toChatErrorMessage(error);
          update();
        });
      }
    },
    stop() {
      liveClient?.disconnect();
      stopLiveMicrophone({ keepPreference: true });
      stopSpeechRecognition();
      liveAudioPlayer.stop();
      audioPlayer.stop();
      speechSynthesizer.stop();
      window.removeEventListener('pointerdown', handleGlobalAudioUnlock);
      window.removeEventListener('keydown', handleGlobalAudioUnlock);
    },
    toggleChat() {
      chatState.isOpen = !chatState.isOpen;
      if (!chatState.isOpen) {
        shouldStartMicrophoneAfterPlayback = false;
        if (!isInitialGreetingInProgress) {
          liveAudioPlayer.stop();
        }
        stopLiveMicrophone({ keepPreference: true });
        chatState.layout = 'default';
        chatState.showAppearanceEditor = false;
        chatState.composer.isVisible = false;
        chatState.input.isVisible = false;
        deactivateInputMic({ resumeMain: false });
      }
      update();
      if (chatState.isOpen && hasActiveChatApiKey() && !chatState.isRecordingMicEnabled) {
        void ensureLiveConnected({
          sendGreeting: !hasSentInitialGreeting && chatState.messages.length === 0,
          startMicrophone: true,
        }).catch((error) => {
          appendErrorMessage(toChatErrorMessage(error));
        });
      }
    },
    openChat() {
      chatState.isOpen = true;
      update();
    },
    toggleSideColumn() {
      chatState.showSideColumn = !chatState.showSideColumn;
      if (!chatState.showSideColumn) {
        chatState.showAppearanceEditor = false;
      }
      update();
    },
    handleToolbarFeature(featureId) {
      if (featureId === 'chat') {
        this.toggleChat();
        return true;
      }
      if (featureId === 'mic') {
        toggleLiveMicrophone();
        return true;
      }
      if (featureId === 'columns') {
        this.toggleSideColumn();
        return true;
      }
      return false;
    },
    clearConversation,
  };
}
