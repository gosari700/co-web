const CASUAL_CURRENT_PATTERNS = [
  /^(?:지금|오늘|요즘)?\s*(?:뭐\s*해|뭐하|어때|괜찮|잘\s*지내|안녕)/i,
  /^(?:what are you doing|how are you|hi|hello)\b/i,
];

const EXPLICIT_SEARCH_PATTERN =
  /검색|조회|찾아\s*(?:봐|줘|주세요)|알아\s*(?:봐|봐줘|줘|주세요)|뉴스\s*찾|구글|search|look\s*up|google/i;

const FRESHNESS_PATTERN =
  /최신|최근|오늘|어제|내일|현재|지금|실시간|방금|요즘|뉴스|속보|발표|업데이트|latest|recent|current|today|yesterday|tomorrow|now|real[-\s]?time|breaking|news|update/i;

const VOLATILE_TOPIC_PATTERN =
  /대통령|총리|장관|국무총리|시장|도지사|의원|대표|ceo|주가|가격|시세|환율|날씨|기온|미세먼지|태풍|지진|교통|항공|비행기|열차|스코어|점수|경기|결과|순위|일정|개봉|출시|업데이트|버전|사망|부상|선거|여론조사|감독|선수|우승|winner|score|price|stock|exchange\s*rate|weather|schedule|ranking|election|president|prime\s*minister|release/i;

const INFO_REQUEST_PATTERN =
  /누구|뭐|무엇|어디|언제|얼마|몇|왜|어떻게|알려|상황|소식|정보|결과|되[나니]|인가|야\??$|who|what|where|when|how|why|which|tell|result|status|info/i;

function normalizeIntentText(text) {
  return text
    .replace(/\s+/g, ' ')
    .trim();
}

export function shouldUseGroundedSearch(text) {
  const normalized = normalizeIntentText(text);
  if (!normalized) {
    return false;
  }

  if (CASUAL_CURRENT_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return false;
  }

  if (EXPLICIT_SEARCH_PATTERN.test(normalized)) {
    return true;
  }

  if (FRESHNESS_PATTERN.test(normalized) && INFO_REQUEST_PATTERN.test(normalized)) {
    return true;
  }

  return VOLATILE_TOPIC_PATTERN.test(normalized)
    && INFO_REQUEST_PATTERN.test(normalized);
}
