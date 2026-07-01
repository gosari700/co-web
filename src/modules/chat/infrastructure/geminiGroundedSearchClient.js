import {
  getChatLanguageName,
  resolveChatLanguageCode,
} from '../domain/chatLanguage.js';

const GEMINI_INTERACTIONS_BASE =
  'https://generativelanguage.googleapis.com/v1beta/interactions';
const GEMINI_REST_BASE =
  'https://generativelanguage.googleapis.com/v1beta/models';
const YAHOO_CHART_BASE =
  'https://query1.finance.yahoo.com/v8/finance/chart';
const MAX_SOURCE_COUNT = 5;
const HANGUL_PATTERN = /[가-힣]/;
const SAMSUNG_ELECTRONICS_STOCK_PATTERN =
  /삼성\s*전자|samsung\s+electronics/i;
const STOCK_PRICE_REQUEST_PATTERN =
  /주가|시세|현재가|가격|stock\s*price|share\s*price|quote|price/i;
const SOURCE_LABELS = Object.freeze({
  ko: '출처',
  en: 'Sources',
  ja: '出典',
  'zh-CN': '来源',
  'zh-TW': '來源',
  es: 'Fuentes',
  fr: 'Sources',
  de: 'Quellen',
  it: 'Fonti',
  pt: 'Fontes',
  ru: 'Источники',
  vi: 'Nguồn',
  th: 'แหล่งที่มา',
  id: 'Sumber',
  hi: 'स्रोत',
  ar: 'المصادر',
  tr: 'Kaynaklar',
  nl: 'Bronnen',
  pl: 'Źródła',
  uk: 'Джерела',
});
const DATE_LOCALES = Object.freeze({
  ko: 'ko-KR',
  en: 'en-US',
  ja: 'ja-JP',
  'zh-CN': 'zh-CN',
  'zh-TW': 'zh-TW',
  es: 'es-ES',
  fr: 'fr-FR',
  de: 'de-DE',
  it: 'it-IT',
  pt: 'pt-PT',
  ru: 'ru-RU',
  vi: 'vi-VN',
  th: 'th-TH',
  id: 'id-ID',
  hi: 'hi-IN',
  ar: 'ar-SA',
  tr: 'tr-TR',
  nl: 'nl-NL',
  pl: 'pl-PL',
  uk: 'uk-UA',
});

function isRecord(value) {
  return typeof value === 'object' && value !== null;
}

function asString(value) {
  return typeof value === 'string' ? value : '';
}

function asNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function buildTodayString(date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getRequestLanguageCode(text, languageCode = '') {
  return resolveChatLanguageCode(text, languageCode);
}

function getDisplayLanguageCode(text, languageCode = '') {
  return getRequestLanguageCode(text, languageCode) ?? 'en';
}

function isKoreanRequest(text, languageCode = '') {
  return getRequestLanguageCode(text, languageCode) === 'ko' || HANGUL_PATTERN.test(text);
}

function isSamsungElectronicsStockQuery(text) {
  return SAMSUNG_ELECTRONICS_STOCK_PATTERN.test(text)
    && STOCK_PRICE_REQUEST_PATTERN.test(text);
}

function buildGroundedPrompt(query, date, languageCode = '') {
  const requestLanguageName = getChatLanguageName(getRequestLanguageCode(query, languageCode));
  const languageRule = requestLanguageName
    ? `The user's latest request language is ${requestLanguageName}. Reply only in ${requestLanguageName}, unless the user explicitly asks for translation or bilingual practice.`
    : 'Reply only in the same language as the user’s latest question, unless the user explicitly asks for translation or bilingual practice. Infer the language from the words themselves, and never default to English just because the text uses the Latin alphabet.';

  return [
    `TODAY: ${buildTodayString(date)}.`,
    'Answer using Gemini Google Search grounding, like a current web search assistant.',
    'For current/latest/recent facts, people, offices, politics, economics, science, medicine, space, biotechnology, products, laws, schedules, releases, news, papers, and all other changing knowledge, search the web first and ground the answer in the retrieved current sources.',
    'Do not answer volatile or current facts from memory. If search results are weak or conflicting, say what is verified and what is uncertain.',
    'Do not switch to academic paper results unless the user specifically asks for papers, studies, clinical trials, journals, or scholarly research.',
    'Start with the direct answer. Then add only the key context, dates, and source labels.',
    languageRule,
    'Never show irrelevant results from another domain. If the search result does not answer the user question, do not present it as an answer.',
    '',
    `User question: ${query}`,
  ].join('\n');
}

function addSource(sources, uri, title) {
  const trimmedUri = uri.trim();
  if (!trimmedUri || sources.has(trimmedUri)) {
    return;
  }

  sources.set(trimmedUri, {
    uri: trimmedUri,
    title: title?.trim() || trimmedUri,
  });
}

function getAnnotationSource(annotation) {
  const url = asString(annotation.url) || asString(annotation.uri);
  if (!url) {
    return null;
  }

  return {
    title: asString(annotation.title) || url,
    uri: url,
  };
}

function collectInteractionSources(value, sources) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectInteractionSources(item, sources));
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  if (asString(value.type) === 'url_citation') {
    const source = getAnnotationSource(value);
    if (source) {
      addSource(sources, source.uri, source.title);
    }
  }

  if (isRecord(value.web)) {
    const uri = asString(value.web.uri);
    if (uri) {
      addSource(sources, uri, asString(value.web.title));
    }
  }

  Object.values(value).forEach((item) => collectInteractionSources(item, sources));
}

function getInteractionText(data) {
  if (!isRecord(data)) {
    return '';
  }

  const directText = asString(data.output_text)
    || asString(data.outputText)
    || asString(data.text);
  if (directText.trim()) {
    return directText.trim();
  }

  const steps = Array.isArray(data.steps) ? data.steps : [];
  const modelTexts = steps
    .filter((step) => isRecord(step) && asString(step.type) === 'model_output')
    .flatMap((step) => {
      if (!isRecord(step) || !Array.isArray(step.content)) {
        return [];
      }

      return step.content
        .map((content) => isRecord(content) ? asString(content.text) : '')
        .filter(Boolean);
    });

  if (modelTexts.length > 0) {
    return modelTexts.join('\n').trim();
  }

  return '';
}

function getGenerateContentText(data) {
  if (!isRecord(data) || !Array.isArray(data.candidates)) {
    return '';
  }

  return data.candidates
    .map((candidate) => {
      if (!isRecord(candidate) || !isRecord(candidate.content) || !Array.isArray(candidate.content.parts)) {
        return '';
      }

      return candidate.content.parts
        .map((part) => isRecord(part) ? asString(part.text) : '')
        .join('');
    })
    .join('')
    .trim();
}

function buildGroundedResponse(data, query, languageCode = '') {
  const text = getInteractionText(data) || getGenerateContentText(data);
  if (!text) {
    throw new Error('Gemini search response was empty.');
  }

  const sourceMap = new Map();
  collectInteractionSources(data, sourceMap);
  const sources = [...sourceMap.values()].slice(0, MAX_SOURCE_COUNT);

  return {
    displayText: formatDisplayText(text, sources, query, languageCode),
    sources,
  };
}

function compactSourceLabel(source) {
  const rawLabel = (source.title || source.uri).trim();
  const domainMatch = rawLabel.match(/(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)/i);
  const label = domainMatch?.[1] ?? rawLabel;

  return label
    .replace(/^www\./i, '')
    .replace(/\/+$/g, '')
    .trim();
}

function formatDisplayText(text, sources, query, languageCode = '') {
  const answer = text.trim();
  if (sources.length === 0) {
    return answer;
  }

  const labels = sources
    .map(compactSourceLabel)
    .filter(Boolean)
    .filter((label, index, allLabels) => (
      allLabels.findIndex((item) => item.toLowerCase() === label.toLowerCase()) === index
    ));

  if (labels.length === 0) {
    return answer;
  }

  const sourceLabel = SOURCE_LABELS[getDisplayLanguageCode(query, languageCode)] ?? SOURCE_LABELS.en;
  return `${answer}\n\n${sourceLabel}: ${labels.join(', ')}`;
}

function formatKrw(value) {
  return `${Math.round(value).toLocaleString('ko-KR')}원`;
}

function formatSignedKrw(value) {
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  return `${sign}${formatKrw(Math.abs(value))}`;
}

function formatSignedPercent(value) {
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  return `${sign}${Math.abs(value).toFixed(2)}%`;
}

function formatMarketTime(seconds, timezone, query, languageCode = '') {
  if (!seconds) {
    return null;
  }

  const date = new Date(seconds * 1000);
  return new Intl.DateTimeFormat(DATE_LOCALES[getDisplayLanguageCode(query, languageCode)] ?? DATE_LOCALES.en, {
    timeZone: timezone || 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function getYahooQuoteMeta(data) {
  if (!isRecord(data) || !isRecord(data.chart) || !Array.isArray(data.chart.result)) {
    return null;
  }

  const firstResult = data.chart.result[0];
  if (!isRecord(firstResult) || !isRecord(firstResult.meta)) {
    return null;
  }

  return firstResult.meta;
}

function buildSamsungQuoteSnapshot({
  price,
  previousClose,
  marketTimeSeconds,
  timezone,
  sourceTitle,
  sourceUri,
  priceKind,
}) {
  if (price === null) {
    return null;
  }

  return {
    price,
    previousClose,
    marketTimeSeconds,
    timezone: timezone || 'Asia/Seoul',
    source: {
      title: sourceTitle || 'finance.yahoo.com',
      uri: sourceUri || 'https://finance.yahoo.com/quote/005930.KS',
    },
    priceKind: priceKind || 'current',
  };
}

function buildSamsungQuoteSnapshotFromApi(data) {
  if (!isRecord(data)) {
    return null;
  }

  return buildSamsungQuoteSnapshot({
    price: asNumber(data.price),
    previousClose: asNumber(data.previousClose),
    marketTimeSeconds: asNumber(data.marketTimeEpochSeconds),
    timezone: asString(data.timezone),
    sourceTitle: asString(data.sourceTitle),
    sourceUri: asString(data.sourceUri),
    priceKind: asString(data.priceKind),
  });
}

function buildSamsungQuoteSnapshotFromYahooMeta(meta) {
  const price = asNumber(meta?.regularMarketPrice);
  if (!meta || price === null) {
    return null;
  }

  return buildSamsungQuoteSnapshot({
    price,
    previousClose: asNumber(meta.previousClose) ?? asNumber(meta.chartPreviousClose),
    marketTimeSeconds: asNumber(meta.regularMarketTime),
    timezone: asString(meta.exchangeTimezoneName) || 'Asia/Seoul',
    sourceTitle: 'finance.yahoo.com',
    sourceUri: 'https://finance.yahoo.com/quote/005930.KS',
    priceKind: 'current',
  });
}

async function readErrorSnippet(response) {
  try {
    return (await response.text()).slice(0, 220);
  } catch {
    return '';
  }
}

async function fetchSameOriginSamsungElectronicsQuote() {
  const response = await fetch('/api/samsung-electronics-quote', {
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(`Samsung quote API error ${response.status}: ${await readErrorSnippet(response)}`);
  }

  const snapshot = buildSamsungQuoteSnapshotFromApi(await response.json());
  if (!snapshot) {
    throw new Error('Samsung quote API response was missing price.');
  }

  return snapshot;
}

async function fetchYahooSamsungElectronicsQuote() {
  const response = await fetch(`${YAHOO_CHART_BASE}/005930.KS?range=1d&interval=1m`);
  if (!response.ok) {
    throw new Error(`Yahoo quote error ${response.status}: ${await readErrorSnippet(response)}`);
  }

  const snapshot = buildSamsungQuoteSnapshotFromYahooMeta(getYahooQuoteMeta(await response.json()));
  if (!snapshot) {
    throw new Error('Yahoo quote response was missing Samsung Electronics price.');
  }

  return snapshot;
}

async function fetchSamsungElectronicsQuoteSnapshot() {
  try {
    return await fetchSameOriginSamsungElectronicsQuote();
  } catch (sameOriginError) {
    try {
      return await fetchYahooSamsungElectronicsQuote();
    } catch {
      throw sameOriginError;
    }
  }
}

async function searchSamsungElectronicsQuote(query, languageCode = '') {
  const quote = await fetchSamsungElectronicsQuoteSnapshot();
  const { price, previousClose, source } = quote;
  const marketTime = formatMarketTime(
    quote.marketTimeSeconds,
    quote.timezone,
    query,
    languageCode,
  );
  const hasPreviousClose = previousClose !== null && previousClose !== 0;

  const answerLines = isKoreanRequest(query, languageCode)
    ? [
      `삼성전자 보통주(005930.KS) 현재가는 ${formatKrw(price)}입니다.`,
      marketTime ? `기준: ${marketTime} KST` : '',
      hasPreviousClose
        ? `전일 종가 ${formatKrw(previousClose)} 대비 ${formatSignedKrw(price - previousClose)}(${formatSignedPercent(((price - previousClose) / previousClose) * 100)})입니다.`
        : '',
    ]
    : [
      `Samsung Electronics common stock (005930.KS) is currently ${formatKrw(price)}.`,
      marketTime ? `As of ${marketTime} KST` : '',
      hasPreviousClose
        ? `Change from previous close ${formatKrw(previousClose)}: ${formatSignedKrw(price - previousClose)} (${formatSignedPercent(((price - previousClose) / previousClose) * 100)}).`
        : '',
    ];

  return {
    displayText: formatDisplayText(answerLines.filter(Boolean).join('\n'), [source], query, languageCode),
    sources: [source],
  };
}

export class GeminiGroundedSearchClient {
  constructor(config) {
    this.config = config;
  }

  async searchLatestInfo(query, date = new Date(), options = {}) {
    const trimmed = query.trim();
    const languageCode = options.languageCode ?? '';
    if (!trimmed) {
      throw new Error('검색할 질문이 비어 있습니다.');
    }

    if (isSamsungElectronicsStockQuery(trimmed)) {
      return searchSamsungElectronicsQuote(trimmed, languageCode);
    }

    return this.searchGeminiLikeWeb(trimmed, date, languageCode);
  }

  async searchGeminiLikeWeb(trimmed, date, languageCode = '') {
    const prompt = buildGroundedPrompt(trimmed, date, languageCode);
    const response = await fetch(GEMINI_INTERACTIONS_BASE, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': this.config.apiKey,
      },
      body: JSON.stringify({
        model: this.config.model,
        input: prompt,
        tools: [{ type: 'google_search' }],
      }),
    });

    if (response.ok) {
      return buildGroundedResponse(await response.json(), trimmed, languageCode);
    }

    const interactionsError = await readErrorSnippet(response);
    const fallbackResponse = await this.searchGenerateContentGrounded(prompt);
    if (fallbackResponse) {
      return buildGroundedResponse(fallbackResponse, trimmed, languageCode);
    }

    throw new Error(`Gemini interactions search error ${response.status}: ${interactionsError}`);
  }

  async searchGenerateContentGrounded(prompt) {
    const response = await fetch(
      `${GEMINI_REST_BASE}/${this.config.model}:generateContent?key=${encodeURIComponent(this.config.apiKey)}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: prompt }],
            },
          ],
          tools: [{ google_search: {} }],
          generationConfig: {
            maxOutputTokens: 1024,
          },
        }),
      },
    );

    if (!response.ok) {
      return null;
    }

    return response.json();
  }
}
