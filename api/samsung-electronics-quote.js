const YAHOO_CHART_URL =
  'https://query1.finance.yahoo.com/v8/finance/chart/005930.KS?range=1d&interval=1m';
const NAVER_QUOTE_URL =
  'https://polling.finance.naver.com/api/realtime/domestic/stock/005930';

function isRecord(value) {
  return typeof value === 'object' && value !== null;
}

function asString(value) {
  return typeof value === 'string' ? value : '';
}

function asNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function parseNumericText(value) {
  const normalized = `${value ?? ''}`.replace(/,/g, '').trim();
  if (!normalized) {
    return null;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function toEpochSeconds(value) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  const time = date.getTime();
  return Number.isFinite(time) ? Math.floor(time / 1000) : null;
}

async function readErrorSnippet(response) {
  try {
    return (await response.text()).slice(0, 160);
  } catch {
    return '';
  }
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

async function fetchYahooQuote() {
  const response = await fetch(YAHOO_CHART_URL, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      Accept: 'application/json',
    },
  });
  if (!response.ok) {
    throw new Error(`Yahoo quote error ${response.status}: ${await readErrorSnippet(response)}`);
  }

  const meta = getYahooQuoteMeta(await response.json());
  const price = asNumber(meta?.regularMarketPrice);
  if (!meta || price === null) {
    throw new Error('Yahoo quote response was missing Samsung Electronics price.');
  }

  return {
    price,
    previousClose: asNumber(meta.previousClose) ?? asNumber(meta.chartPreviousClose),
    marketTimeEpochSeconds: asNumber(meta.regularMarketTime),
    timezone: asString(meta.exchangeTimezoneName) || 'Asia/Seoul',
    sourceTitle: 'finance.yahoo.com',
    sourceUri: 'https://finance.yahoo.com/quote/005930.KS',
    symbol: '005930.KS',
  };
}

async function fetchNaverQuote() {
  const response = await fetch(NAVER_QUOTE_URL, {
    headers: {
      Accept: 'application/json',
      Referer: 'https://finance.naver.com/',
      'User-Agent': 'Mozilla/5.0',
    },
  });
  if (!response.ok) {
    throw new Error(`Naver quote error ${response.status}: ${await readErrorSnippet(response)}`);
  }

  const data = await response.json();
  const item = Array.isArray(data?.datas) ? data.datas[0] : null;
  if (!isRecord(item)) {
    throw new Error('Naver quote response was missing Samsung Electronics data.');
  }

  const price = parseNumericText(item.closePriceRaw) ?? parseNumericText(item.closePrice);
  const change = parseNumericText(item.compareToPreviousClosePriceRaw)
    ?? parseNumericText(item.compareToPreviousClosePrice);
  if (price === null) {
    throw new Error('Naver quote response was missing Samsung Electronics price.');
  }

  return {
    price,
    previousClose: change === null ? null : price - change,
    marketTimeEpochSeconds: toEpochSeconds(item.localTradedAt),
    timezone: item.stockExchangeType?.zoneId || 'Asia/Seoul',
    sourceTitle: 'finance.naver.com',
    sourceUri: 'https://finance.naver.com/item/main.naver?code=005930',
    symbol: '005930.KS',
  };
}

function setCorsHeaders(response) {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  response.setHeader('Cache-Control', 'no-store');
}

export default async function handler(request, response) {
  setCorsHeaders(response);

  if (request.method === 'OPTIONS') {
    response.status(204).end();
    return;
  }

  if (request.method !== 'GET') {
    response.status(405).json({ error: 'Method not allowed.' });
    return;
  }

  try {
    response.status(200).json(await fetchYahooQuote());
  } catch (yahooError) {
    try {
      response.status(200).json(await fetchNaverQuote());
    } catch (naverError) {
      response.status(502).json({
        error: 'Samsung Electronics quote lookup failed.',
        yahooError: yahooError instanceof Error ? yahooError.message : '',
        naverError: naverError instanceof Error ? naverError.message : '',
      });
    }
  }
}
