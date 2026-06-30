import { clearApiKey, loadApiKey, saveApiKey } from '../../settings/domain/apiKeyStore.js';
import { CHAT_APPEARANCE_SWATCHES, CHAT_APPEARANCE_TARGETS, createDefaultChatAppearance } from '../domain/chatAppearance.js';
import { CHAT_CONFIG, buildLiveSystemPrompt } from '../domain/chatConfig.js';
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
import { createChatState } from '../domain/createChatState.js';
import { shouldUseGroundedSearch } from '../domain/groundedSearchIntent.js';
import {
  CHAT_TRANSLATION_LANGUAGES,
  getTranslationLanguageLabel,
  getTranslationLanguageSpeechLocale,
} from '../domain/translationLanguages.js';
import { BrowserAudioPlayer, BrowserSpeechSynthesizer, createSpeechRecognition, repeatSpeech } from '../infrastructure/browserAudio.js';
import { loadChatAppearance, loadChatSnapshots, saveChatAppearance, saveChatSnapshots } from '../infrastructure/chatLocalStorage.js';
import { GeminiGroundedSearchClient } from '../infrastructure/geminiGroundedSearchClient.js';
import { GeminiLiteralTranslator } from '../infrastructure/geminiLiteralTranslator.js';
import { GeminiLiveTextClient } from '../infrastructure/geminiLiveTextClient.js';
import { GeminiTextRefiner } from '../infrastructure/geminiTextRefiner.js';
import { GeminiTtsClient } from '../infrastructure/geminiTtsClient.js';
import { GoogleTranslator } from '../infrastructure/googleTranslator.js';

const AUTO_TRANSLATION_DEBOUNCE_MS = 120;
const INPUT_TTS_REPEAT_COUNT = 2;
const INPUT_TTS_REPEAT_DELAY_MS = 200;
const SENTENCE_TTS_REPEAT_COUNT = 2;

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

function withOpacity(color, alphaHex, fallback) {
  const normalized = color.trim();
  const shortHexMatch = /^#([0-9A-Fa-f]{3})$/.exec(normalized);
  if (shortHexMatch) {
    const expanded = shortHexMatch[1]
      .split('')
      .map((char) => `${char}${char}`)
      .join('');
    return `#${expanded}${alphaHex}`;
  }

  if (/^#([0-9A-Fa-f]{6})$/.test(normalized)) {
    return `${normalized}${alphaHex}`;
  }

  return fallback;
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
  const speechSynthesizer = new BrowserSpeechSynthesizer();
  const googleTranslator = new GoogleTranslator();
  let liveClient = null;
  let groundedSearchClient = null;
  let literalTranslator = null;
  let textRefiner = null;
  let ttsClient = null;
  let apiKey = loadApiKey();
  let hasSentInitialGreeting = false;
  let currentAiText = '';
  let currentAiMessageId = null;
  let autoTranslationTimer = null;
  let speechRecognition = null;
  let speechRecognitionShouldRestart = false;

  chatState.apiKeyDraft = apiKey;
  chatState.isApiKeyPanelVisible = !apiKey;
  chatState.snapshots = loadChatSnapshots();
  chatState.appearance = {
    ...createDefaultChatAppearance(),
    ...(loadChatAppearance() ?? {}),
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
              <button type="button" data-action="toggle-language-panel" aria-label="언어">⇄</button>
              <button type="button" data-action="input-speak" aria-label="읽기">🔊</button>
              <button type="button" data-action="input-clear" aria-label="삭제">⌫</button>
              <button type="button" data-action="input-submit" aria-label="전송">▶</button>
            </div>
          </div>
        </div>
        <aside class="chat-side-column" hidden>
          <button type="button" data-action="save-snapshot" aria-label="저장">⇩</button>
          <button type="button" data-action="open-snapshots" aria-label="폴더">▣</button>
          <button type="button" data-action="toggle-appearance" aria-label="색상">◌</button>
          <button type="button" data-action="toggle-transparent" aria-label="투명">◐</button>
          <button type="button" data-action="toggle-input" aria-label="번역 입력">⌨</button>
          <button type="button" data-action="toggle-composer" aria-label="문자 입력">➤</button>
          <button type="button" data-action="toggle-expanded" aria-label="확대">⛶</button>
          <button type="button" data-action="toggle-minimized" aria-label="축소">⊟</button>
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
    languagePanel: layer.querySelector('.chat-language-panel'),
    appearanceEditor: layer.querySelector('.chat-appearance-editor'),
    snapshotModal: layer.querySelector('.chat-snapshot-modal'),
    snapshotList: layer.querySelector('.chat-snapshot-list'),
  };

  function update() {
    render();
    onStateChange?.();
  }

  function createClients() {
    if (!apiKey) {
      liveClient = null;
      groundedSearchClient = null;
      literalTranslator = null;
      textRefiner = null;
      ttsClient = null;
      return;
    }

    groundedSearchClient = new GeminiGroundedSearchClient({
      apiKey,
      model: CHAT_CONFIG.groundedSearchModel,
    });
    literalTranslator = new GeminiLiteralTranslator({
      apiKey,
      model: CHAT_CONFIG.literalTranslationModel,
      fallbackModel: CHAT_CONFIG.literalTranslationFallbackModel,
    });
    textRefiner = new GeminiTextRefiner({
      apiKey,
      model: CHAT_CONFIG.textRefinerModel,
    });
    ttsClient = new GeminiTtsClient({
      apiKey,
      model: CHAT_CONFIG.ttsModel,
      voiceName: CHAT_CONFIG.ttsVoiceName,
      promptPrefix: CHAT_CONFIG.ttsPromptPrefix,
    });

    liveClient = new GeminiLiveTextClient({
      apiKey,
      model: CHAT_CONFIG.liveModel,
      systemPrompt: buildLiveSystemPrompt(),
      initialGreetingPrompt: CHAT_CONFIG.liveInitialGreetingPrompt,
      liveVoiceName: CHAT_CONFIG.liveVoiceName,
    });
    liveClient.onConnectionChange = (connected) => {
      chatState.connectionState = connected ? 'listening' : 'idle';
      update();
    };
    liveClient.onTextDelta = handleAiTextDelta;
    liveClient.onTurnComplete = handleAiTurnComplete;
    liveClient.onInterrupted = handleAiTurnComplete;
    liveClient.onError = (message) => {
      chatState.errorMessage = message;
      update();
    };
  }

  function ensureApiKey() {
    if (apiKey) {
      return true;
    }
    chatState.isApiKeyPanelVisible = true;
    chatState.isOpen = true;
    update();
    onMessage?.('Gemini API key를 로컬에 저장해야 채팅을 시작할 수 있습니다.');
    return false;
  }

  async function ensureLiveConnected({ sendGreeting = false } = {}) {
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
      currentAiText = '';
      currentAiMessageId = null;
      liveClient.sendInitialGreeting();
    }

    return true;
  }

  function handleAiTextDelta(text) {
    if (!text) {
      return;
    }

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

  function handleAiTurnComplete() {
    if (currentAiMessageId) {
      const message = getMessageById(chatState, currentAiMessageId);
      if (message) {
        message.status = 'ready';
      }
    }
    currentAiText = '';
    currentAiMessageId = null;
    chatState.currentAiMessageId = null;
    chatState.isSending = false;
    chatState.connectionState = apiKey ? 'listening' : 'idle';
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

  async function sendTextTurn(text) {
    const trimmed = text.trim();
    if (!trimmed) {
      return false;
    }

    chatState.isOpen = true;
    chatState.messages.push(createUserMessage(trimmed));
    chatState.isSending = true;
    chatState.errorMessage = '';
    update();
    scrollToEnd();

    if (shouldUseGroundedSearch(trimmed)) {
      appendAiMessage(buildGroundedSearchHandoff(trimmed), 'live');
      await runGroundedSearch(trimmed);
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
      liveClient.sendTextTurn(buildTypedUserTurn(trimmed));
      return true;
    } catch (error) {
      appendErrorMessage(toChatErrorMessage(error));
      return false;
    }
  }

  async function runGroundedSearch(query) {
    try {
      if (!groundedSearchClient) {
        if (!ensureApiKey()) {
          return;
        }
        createClients();
      }

      const result = await groundedSearchClient.searchLatestInfo(query);
      appendAiMessage(result.displayText, 'analysis');
    } catch (error) {
      appendAiMessage(toGroundedSearchMessage(error, query), 'analysis');
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

    chatState.speakingMessageId = message.id;
    update();

    try {
      let didPlayGeminiTts = false;
      if (ttsClient) {
        try {
          const audioSource = await Promise.race([
            ttsClient.generateAudio(trimmed),
            new Promise((resolve) => {
              setTimeout(() => resolve(''), 500);
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
            language: containsKorean(trimmed) ? 'ko-KR' : 'en-US',
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
    stopSpeechRecognition();
    const recognition = createSpeechRecognition({
      language: getTranslationLanguageSpeechLocale(chatState.input.sourceLanguageCode) ?? 'ko-KR',
      onText: (text) => {
        chatState.input.value = `${chatState.input.value}${text}`;
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
        speechRecognitionShouldRestart = false;
        update();
      },
    });

    if (!recognition) {
      chatState.input.isInputMicActive = false;
      onMessage?.('이 브라우저는 음성 입력을 지원하지 않습니다.');
      return;
    }

    speechRecognition = recognition;
    speechRecognitionShouldRestart = true;
    try {
      recognition.start();
    } catch {
      chatState.input.isInputMicActive = false;
      speechRecognitionShouldRestart = false;
    }
  }

  function scheduleAutoTranslation() {
    if (autoTranslationTimer) {
      clearTimeout(autoTranslationTimer);
    }

    if (!chatState.input.isInputMicActive || chatState.input.isSpeaking) {
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

      const translated = await googleTranslator.translate(
        finalSourceText,
        sourceLanguageCode,
        targetLanguageCode,
      );

      chatState.input.translatedText = translated;
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

    chatState.input.isSpeaking = true;
    update();
    try {
      let didPlayGeminiTts = false;
      if (ttsClient) {
        try {
          const audioSource = await Promise.race([
            ttsClient.generateAudio(translated),
            new Promise((resolve) => {
              setTimeout(() => resolve(''), 500);
            }),
          ]);
          if (audioSource) {
            for (let index = 0; index < INPUT_TTS_REPEAT_COUNT; index += 1) {
              await audioPlayer.play(audioSource);
              if (index < INPUT_TTS_REPEAT_COUNT - 1) {
                await wait(INPUT_TTS_REPEAT_DELAY_MS);
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
          translated,
          INPUT_TTS_REPEAT_COUNT,
          INPUT_TTS_REPEAT_DELAY_MS,
          {
            language: getTranslationLanguageSpeechLocale(chatState.input.targetLanguageCode),
          },
        );
      }
    } finally {
      chatState.input.isSpeaking = false;
      chatState.input.isInputMicActive = false;
      stopSpeechRecognition();
      update();
    }
  }

  function toggleInput() {
    chatState.input.isVisible = !chatState.input.isVisible;
    if (chatState.input.isVisible) {
      chatState.input.value = '';
      chatState.input.translatedText = '';
      chatState.input.isInputMicActive = true;
      chatState.composer.isVisible = false;
      startSpeechRecognition();
    } else {
      chatState.input.isInputMicActive = false;
      stopSpeechRecognition();
    }
    update();
  }

  function toggleComposer() {
    chatState.composer.isVisible = !chatState.composer.isVisible;
    if (chatState.composer.isVisible) {
      chatState.input.isVisible = false;
      chatState.input.isInputMicActive = false;
      stopSpeechRecognition();
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
    setTimeout(() => {
      elements.messageList.scrollTop = elements.messageList.scrollHeight;
    }, 50);
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

  function renderAppearanceEditor() {
    elements.appearanceEditor.hidden = !chatState.showAppearanceEditor || !chatState.showSideColumn;
    if (elements.appearanceEditor.hidden) {
      return;
    }

    const targetButtons = CHAT_APPEARANCE_TARGETS.map((target) => (
      `<button type="button" data-action="select-appearance-target" data-target="${target.id}" class="${chatState.appearanceTarget === target.id ? 'active' : ''}">${target.label}</button>`
    )).join('');
    const swatches = CHAT_APPEARANCE_SWATCHES.map((color) => (
      `<button type="button" data-action="set-appearance-color" data-color="${color}" class="chat-swatch ${color === 'transparent' ? 'chat-swatch-transparent' : ''}" style="background:${color === 'transparent' ? 'transparent' : color}"></button>`
    )).join('');

    elements.appearanceEditor.innerHTML = `
      <div class="chat-appearance-targets">${targetButtons}</div>
      <div class="chat-appearance-swatches">${swatches}</div>
      <button type="button" data-action="reset-appearance" class="chat-appearance-reset">reset</button>
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
    elements.translationTextarea.style.backgroundColor = chatState.appearance.inputBackgroundColor;
    elements.translationCard.style.backgroundColor = chatState.appearance.inputBackgroundColor;
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
        apiKey = nextKey;
        chatState.apiKeyDraft = nextKey;
        chatState.isApiKeyPanelVisible = false;
        saveApiKey(nextKey);
        if (liveClient) {
          liveClient.disconnect();
        }
        hasSentInitialGreeting = false;
        createClients();
        update();
        void ensureLiveConnected({ sendGreeting: true }).catch((error) => {
          appendErrorMessage(toChatErrorMessage(error));
        });
        break;
      }
      case 'clear-api-key':
        apiKey = '';
        chatState.apiKeyDraft = '';
        chatState.isApiKeyPanelVisible = true;
        clearApiKey();
        liveClient?.disconnect();
        createClients();
        update();
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
        update();
        break;
      case 'set-appearance-color':
        setAppearanceColor(chatState.appearanceTarget, button.dataset.color);
        break;
      case 'reset-appearance':
        resetAppearance();
        break;
      case 'input-mic':
        chatState.input.isInputMicActive = !chatState.input.isInputMicActive;
        if (chatState.input.isInputMicActive) {
          startSpeechRecognition();
        } else {
          stopSpeechRecognition();
        }
        update();
        break;
      case 'input-refine':
        void refineInput();
        break;
      case 'input-translate':
        void translateInput();
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
        chatState.input.translatedText = '';
        update();
        break;
      case 'input-submit': {
        const text = chatState.input.value.trim();
        if (text) {
          chatState.input.value = '';
          chatState.input.translatedText = '';
          void sendTextTurn(text);
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
        chatState.input.translatedText = '';
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
        update();
        break;
      }
      default:
        break;
    }
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
    chatState.input.translatedText = '';
    scheduleAutoTranslation();
  });

  elements.apiInput.addEventListener('input', () => {
    chatState.apiKeyDraft = elements.apiInput.value;
  });

  layer.addEventListener('click', handleClick);

  createClients();

  return {
    start() {
      render();
      if (apiKey) {
        void ensureLiveConnected({ sendGreeting: true }).catch((error) => {
          chatState.errorMessage = toChatErrorMessage(error);
          update();
        });
      }
    },
    stop() {
      liveClient?.disconnect();
      stopSpeechRecognition();
      audioPlayer.stop();
      speechSynthesizer.stop();
    },
    toggleChat() {
      chatState.isOpen = !chatState.isOpen;
      if (!chatState.isOpen) {
        chatState.layout = 'default';
        chatState.showAppearanceEditor = false;
        chatState.composer.isVisible = false;
        chatState.input.isVisible = false;
        chatState.input.isInputMicActive = false;
        stopSpeechRecognition();
      }
      update();
      if (chatState.isOpen && apiKey && !hasSentInitialGreeting && chatState.messages.length === 0) {
        void ensureLiveConnected({ sendGreeting: true }).catch((error) => {
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
      if (featureId === 'columns') {
        this.toggleSideColumn();
        return true;
      }
      return false;
    },
    clearConversation,
  };
}
