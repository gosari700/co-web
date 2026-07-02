const DAUM_DICTIONARY_BASE = 'https://dic.daum.net';
const MOBILE_WEBVIEW_USER_AGENT =
  'Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0 Mobile Safari/537.36';

function asString(value) {
  return typeof value === 'string' ? value : '';
}

function buildDaumUrl(request) {
  const rawQuery = asString(request.query?.q).trim();
  if (!rawQuery) {
    return null;
  }

  const url = new URL('/search.do', DAUM_DICTIONARY_BASE);
  url.searchParams.set('q', rawQuery);
  return url;
}

async function readErrorSnippet(response) {
  try {
    return (await response.text()).slice(0, 160);
  } catch {
    return '';
  }
}

function prepareHtml(html) {
  const baseTag = '<base href="https://dic.daum.net/">';
  const viewportTag = '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">';
  const styleTag = [
    '<style>',
    'html,body{margin:0!important;min-width:0!important;width:100%!important;max-width:100%!important;min-height:100%;background:#fff;overflow-x:hidden!important;overscroll-behavior:contain;touch-action:pan-y;}',
    'body{overflow-y:auto!important;-webkit-overflow-scrolling:touch;touch-action:pan-y;}',
    '*,*::before,*::after{box-sizing:border-box;max-width:100%;}',
    'img,video,canvas,svg,table{max-width:100%!important;}',
    '#kakaoWrap,#mArticle,#daumWrap,#daumContent,#kakaoContent,.wrap_dic,.wrap_search,.section_search,.list_search,.search_word,.box_word{min-width:0!important;width:100%!important;max-width:100%!important;overflow-x:hidden!important;}',
    '#kakaoHead,#kakaoHead *,.wrap_gnb,.inner_head,#innerSearchContainer,#searchBar{position:static!important;top:auto!important;transform:none!important;-webkit-transform:none!important;}',
    '</style>',
  ].join('');

  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1>${baseTag}${viewportTag}${styleTag}`);
  }

  return `${baseTag}${viewportTag}${styleTag}${html}`;
}

function sendJson(response, status, body) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(body));
}

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');

  if (request.method !== 'GET') {
    sendJson(response, 405, { error: 'Method not allowed.' });
    return;
  }

  const daumUrl = buildDaumUrl(request);
  if (!daumUrl) {
    sendJson(response, 400, { error: 'Dictionary query is required.' });
    return;
  }

  try {
    const upstream = await fetch(daumUrl, {
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
        'User-Agent': MOBILE_WEBVIEW_USER_AGENT,
      },
    });

    if (!upstream.ok) {
      sendJson(response, upstream.status, {
        error: `Daum dictionary error ${upstream.status}`,
        detail: await readErrorSnippet(upstream),
      });
      return;
    }

    response.statusCode = 200;
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(prepareHtml(await upstream.text()));
  } catch (error) {
    sendJson(response, 502, {
      error: 'Daum dictionary proxy failed.',
      detail: error instanceof Error ? error.message : '',
    });
  }
}
