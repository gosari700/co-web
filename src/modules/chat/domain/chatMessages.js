function createMessageId(role) {
  return `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createUserMessage(text) {
  return {
    id: createMessageId('user'),
    role: 'user',
    text,
    createdAt: Date.now(),
    status: 'ready',
    source: 'manual',
  };
}

export function createAiMessage(text, status = 'ready', source = 'live') {
  return {
    id: createMessageId('ai'),
    role: 'ai',
    text,
    createdAt: Date.now(),
    status,
    source,
  };
}

export function createErrorMessage(text) {
  return {
    id: createMessageId('ai'),
    role: 'ai',
    text,
    createdAt: Date.now(),
    status: 'error',
    source: 'error',
  };
}

export function splitChatMessageLines(text) {
  const trimmed = text.trim();
  if (!trimmed) {
    return [];
  }

  const lines = trimmed
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length > 1) {
    return lines;
  }

  return trimmed
    .split(/(?<=[.!?])(?:\s+|(?=[가-힣ㄱ-ㅎㅏ-ㅣ]))/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function containsKorean(text) {
  return /[가-힣ㄱ-ㅎㅏ-ㅣ]/.test(text);
}

export function getTranslationDirection(text) {
  return containsKorean(text)
    ? { from: 'ko', to: 'en' }
    : { from: 'en', to: 'ko' };
}

export function buildTypedUserTurn(text) {
  return [
    '[System] Typed user message. Reply only in the same language as this message unless the user explicitly asks for another language. If this message is Korean, answer in Korean-only response sentences. If this message is English, answer in English-only response sentences. Do not mix Korean and English except for quoted words, proper nouns, URLs, ticker symbols, or language-learning examples.',
    text,
  ].join('\n');
}

export function buildGroundedSearchHandoff(query) {
  return /[가-힣]/.test(query)
    ? '최신 정보와 출처를 바로 확인할게요.'
    : 'I will check the latest information and sources now.';
}

export function toGroundedSearchMessage(error, query) {
  const message = error instanceof Error ? error.message : '';
  const isKoreanRequest = /[가-힣]/.test(query);
  if (/429|quota|rate limit|too_many_requests/i.test(message)) {
    return isKoreanRequest
      ? '최신 정보 검색 API 할당량이 부족합니다. API 키, 결제, 사용량 한도를 확인한 뒤 다시 시도해 주세요.'
      : 'The latest-information search API quota is exhausted. Please check the API key, billing, and usage limits, then try again.';
  }

  return isKoreanRequest
    ? '최신 정보 검색에 실패했습니다. 잠시 후 다시 물어봐 주세요.'
    : 'Latest-information search failed. Please ask again in a moment.';
}
