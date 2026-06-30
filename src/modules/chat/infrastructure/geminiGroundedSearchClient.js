const GEMINI_REST_BASE =
  'https://generativelanguage.googleapis.com/v1beta/models';
const YAHOO_CHART_BASE =
  'https://query1.finance.yahoo.com/v8/finance/chart';
const MAX_SOURCE_COUNT = 3;
const HANGUL_PATTERN = /[가-힣]/;
const SAMSUNG_ELECTRONICS_STOCK_PATTERN =
  /삼성\s*전자|samsung\s+electronics/i;
const STOCK_PRICE_REQUEST_PATTERN =
  /주가|시세|현재가|가격|stock\s*price|share\s*price|quote|price/i;

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

function isKoreanRequest(text) {
  return HANGUL_PATTERN.test(text);
}

function isSamsungElectronicsStockQuery(text) {
  return SAMSUNG_ELECTRONICS_STOCK_PATTERN.test(text)
    && STOCK_PRICE_REQUEST_PATTERN.test(text);
}

function buildGroundedPrompt(query, date) {
  return [
    `TODAY: ${buildTodayString(date)}.`,
    'Use Google Search grounding to answer with the freshest available information.',
    'Use strong expert judgment across politics, economics, society, culture, science, medicine, space, biology, technology, law, and other domains when it helps interpret the search results.',
    'Ground current facts, numbers, prices, schedules, names, and claims in the search results; do not replace fresh evidence with memory.',
    'Reply in the same language as the user’s latest question.',
    'For Korean questions, every explanation sentence must be Korean. For English questions, every explanation sentence must be English. Do not mix Korean and English except for quoted words, proper nouns, ticker symbols, URLs, or source names.',
    'Start with the direct answer, then give only the key context in short, easy-to-scan lines.',
    'For prices, stocks, weather, news, sports, and public facts, include the date or time when available and keep numbers exact.',
    'If sources disagree or the information may have changed, say that clearly.',
    'For medical, legal, financial, or safety topics, keep the answer educational and do not replace a qualified professional.',
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

function collectSources(value, sources) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectSources(item, sources));
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  if (isRecord(value.web)) {
    const uri = asString(value.web.uri);
    if (uri) {
      addSource(sources, uri, asString(value.web.title));
    }
  }

  Object.values(value).forEach((item) => collectSources(item, sources));
}

function getResponseText(data) {
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

function compactSourceLabel(source) {
  const rawLabel = (source.title || source.uri).trim();
  const domainMatch = rawLabel.match(/(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)/i);
  const label = domainMatch?.[1] ?? rawLabel;

  return label
    .replace(/^www\./i, '')
    .replace(/\/+$/g, '')
    .trim();
}

function formatDisplayText(text, sources, query) {
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

  const sourceLabel = isKoreanRequest(query) ? '출처' : 'Sources';
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

function formatMarketTime(seconds, timezone, query) {
  if (!seconds) {
    return null;
  }

  const date = new Date(seconds * 1000);
  return new Intl.DateTimeFormat(isKoreanRequest(query) ? 'ko-KR' : 'en-US', {
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

async function readErrorSnippet(response) {
  try {
    return (await response.text()).slice(0, 160);
  } catch {
    return '';
  }
}

async function searchSamsungElectronicsQuote(query) {
  const response = await fetch(`${YAHOO_CHART_BASE}/005930.KS?range=1d&interval=1m`);
  if (!response.ok) {
    throw new Error(`Yahoo quote error ${response.status}: ${await readErrorSnippet(response)}`);
  }

  const meta = getYahooQuoteMeta(await response.json());
  const price = asNumber(meta?.regularMarketPrice);
  if (!meta || price === null) {
    throw new Error('Yahoo quote response was missing Samsung Electronics price.');
  }

  const previousClose = asNumber(meta.previousClose) ?? asNumber(meta.chartPreviousClose);
  const marketTime = formatMarketTime(
    asNumber(meta.regularMarketTime),
    asString(meta.exchangeTimezoneName) || 'Asia/Seoul',
    query,
  );
  const source = {
    title: 'finance.yahoo.com',
    uri: 'https://finance.yahoo.com/quote/005930.KS',
  };

  const answerLines = isKoreanRequest(query)
    ? [
      `삼성전자 보통주(005930.KS) 현재가는 ${formatKrw(price)}입니다.`,
      marketTime ? `기준: ${marketTime} KST` : '',
      previousClose !== null
        ? `전일 종가 ${formatKrw(previousClose)} 대비 ${formatSignedKrw(price - previousClose)}(${formatSignedPercent(((price - previousClose) / previousClose) * 100)})입니다.`
        : '',
    ]
    : [
      `Samsung Electronics common stock (005930.KS) is currently ${formatKrw(price)}.`,
      marketTime ? `As of ${marketTime} KST` : '',
      previousClose !== null
        ? `Change from previous close ${formatKrw(previousClose)}: ${formatSignedKrw(price - previousClose)} (${formatSignedPercent(((price - previousClose) / previousClose) * 100)}).`
        : '',
    ];

  return {
    displayText: formatDisplayText(answerLines.filter(Boolean).join('\n'), [source], query),
    sources: [source],
  };
}

export class GeminiGroundedSearchClient {
  constructor(config) {
    this.config = config;
  }

  async searchLatestInfo(query, date = new Date()) {
    const trimmed = query.trim();
    if (!trimmed) {
      throw new Error('검색할 질문이 비어 있습니다.');
    }

    if (isSamsungElectronicsStockQuery(trimmed)) {
      return searchSamsungElectronicsQuote(trimmed);
    }

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
              parts: [{ text: buildGroundedPrompt(trimmed, date) }],
            },
          ],
          tools: [{ google_search: {} }],
          generationConfig: {
            maxOutputTokens: 768,
          },
        }),
      },
    );

    if (!response.ok) {
      throw new Error(`Gemini search error ${response.status}: ${await readErrorSnippet(response)}`);
    }

    const data = await response.json();
    const text = getResponseText(data);
    if (!text) {
      throw new Error('Gemini search response was empty.');
    }

    const sourceMap = new Map();
    collectSources(data, sourceMap);
    const sources = [...sourceMap.values()].slice(0, MAX_SOURCE_COUNT);

    return {
      displayText: formatDisplayText(text, sources, trimmed),
      sources,
    };
  }
}
