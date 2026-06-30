import {
  REGISTERED_CHAT_LANGUAGE_NAMES,
  getChatLanguageName,
  resolveChatLanguageCode,
} from './chatLanguage.js';

const GROUNDED_SEARCH_MESSAGES = Object.freeze({
  ko: {
    handoff: '최신 정보와 출처를 바로 확인할게요.',
    quota: '최신 정보 검색 API 할당량이 부족합니다. API 키, 결제, 사용량 한도를 확인한 뒤 다시 시도해 주세요.',
    failure: '최신 정보 검색에 실패했습니다. 잠시 후 다시 물어봐 주세요.',
  },
  en: {
    handoff: 'I will check the latest information and sources now.',
    quota: 'The latest-information search API quota is exhausted. Please check the API key, billing, and usage limits, then try again.',
    failure: 'Latest-information search failed. Please ask again in a moment.',
  },
  ja: {
    handoff: '最新情報と出典をすぐ確認します。',
    quota: '最新情報検索APIの割り当てが不足しています。APIキー、請求、使用量上限を確認してからもう一度試してください。',
    failure: '最新情報の検索に失敗しました。少し後でもう一度聞いてください。',
  },
  'zh-CN': {
    handoff: '我现在就查看最新信息和来源。',
    quota: '最新信息搜索 API 配额不足。请检查 API 密钥、结算和使用量限制后再试。',
    failure: '最新信息搜索失败。请稍后再问。',
  },
  'zh-TW': {
    handoff: '我現在就查看最新資訊和來源。',
    quota: '最新資訊搜尋 API 配額不足。請檢查 API 金鑰、帳單和使用量限制後再試。',
    failure: '最新資訊搜尋失敗。請稍後再問。',
  },
  es: {
    handoff: 'Ahora revisaré la información más reciente y las fuentes.',
    quota: 'La cuota de la API de búsqueda de información reciente se agotó. Revisa la clave API, la facturación y los límites de uso, y vuelve a intentarlo.',
    failure: 'Falló la búsqueda de información reciente. Vuelve a preguntar dentro de un momento.',
  },
  fr: {
    handoff: 'Je vais vérifier maintenant les informations les plus récentes et les sources.',
    quota: 'Le quota de l’API de recherche d’informations récentes est épuisé. Vérifiez la clé API, la facturation et les limites d’utilisation, puis réessayez.',
    failure: 'La recherche d’informations récentes a échoué. Redemandez dans un instant.',
  },
  de: {
    handoff: 'Ich prüfe jetzt die neuesten Informationen und Quellen.',
    quota: 'Das API-Kontingent für die Suche nach aktuellen Informationen ist erschöpft. Prüfe API-Schlüssel, Abrechnung und Nutzungslimits und versuche es erneut.',
    failure: 'Die Suche nach aktuellen Informationen ist fehlgeschlagen. Bitte frag gleich noch einmal.',
  },
  it: {
    handoff: 'Ora controllo le informazioni più recenti e le fonti.',
    quota: 'La quota dell’API per la ricerca di informazioni aggiornate è esaurita. Controlla la chiave API, la fatturazione e i limiti di utilizzo, poi riprova.',
    failure: 'La ricerca di informazioni aggiornate non è riuscita. Riprova tra poco.',
  },
  pt: {
    handoff: 'Vou verificar agora as informações mais recentes e as fontes.',
    quota: 'A cota da API de busca de informações recentes acabou. Verifique a chave da API, o faturamento e os limites de uso e tente novamente.',
    failure: 'A busca de informações recentes falhou. Pergunte novamente daqui a pouco.',
  },
  ru: {
    handoff: 'Сейчас проверю самую свежую информацию и источники.',
    quota: 'Квота API поиска актуальной информации исчерпана. Проверьте API-ключ, оплату и лимиты использования, затем попробуйте снова.',
    failure: 'Не удалось найти актуальную информацию. Пожалуйста, спросите снова чуть позже.',
  },
  vi: {
    handoff: 'Tôi sẽ kiểm tra ngay thông tin mới nhất và các nguồn.',
    quota: 'Hạn mức API tìm kiếm thông tin mới nhất đã hết. Hãy kiểm tra khóa API, thanh toán và giới hạn sử dụng rồi thử lại.',
    failure: 'Không tìm được thông tin mới nhất. Vui lòng hỏi lại sau ít phút.',
  },
  th: {
    handoff: 'ฉันจะตรวจสอบข้อมูลล่าสุดและแหล่งที่มาตอนนี้',
    quota: 'โควตา API สำหรับค้นหาข้อมูลล่าสุดหมดแล้ว โปรดตรวจสอบคีย์ API การชำระเงิน และขีดจำกัดการใช้งาน แล้วลองอีกครั้ง',
    failure: 'ค้นหาข้อมูลล่าสุดไม่สำเร็จ โปรดลองถามอีกครั้งในอีกสักครู่',
  },
  id: {
    handoff: 'Saya akan memeriksa informasi terbaru dan sumbernya sekarang.',
    quota: 'Kuota API pencarian informasi terbaru sudah habis. Periksa kunci API, penagihan, dan batas penggunaan, lalu coba lagi.',
    failure: 'Pencarian informasi terbaru gagal. Silakan tanyakan lagi sebentar lagi.',
  },
  hi: {
    handoff: 'मैं अभी नवीनतम जानकारी और स्रोत देखती हूँ।',
    quota: 'नवीनतम जानकारी खोज API की सीमा समाप्त हो गई है। API कुंजी, बिलिंग और उपयोग सीमा जांचकर फिर कोशिश करें।',
    failure: 'नवीनतम जानकारी खोजने में विफल रही। कृपया थोड़ी देर बाद फिर पूछें।',
  },
  ar: {
    handoff: 'سأتحقق الآن من أحدث المعلومات والمصادر.',
    quota: 'نفدت حصة واجهة برمجة تطبيقات البحث عن أحدث المعلومات. يرجى التحقق من مفتاح API والفوترة وحدود الاستخدام ثم المحاولة مرة أخرى.',
    failure: 'فشل البحث عن أحدث المعلومات. يرجى السؤال مرة أخرى بعد قليل.',
  },
  tr: {
    handoff: 'En güncel bilgileri ve kaynakları şimdi kontrol edeceğim.',
    quota: 'Güncel bilgi arama API kotası tükendi. API anahtarını, faturalandırmayı ve kullanım sınırlarını kontrol edip tekrar deneyin.',
    failure: 'Güncel bilgi araması başarısız oldu. Lütfen biraz sonra tekrar sorun.',
  },
  nl: {
    handoff: 'Ik controleer nu de nieuwste informatie en bronnen.',
    quota: 'Het API-tegoed voor zoeken naar actuele informatie is op. Controleer de API-sleutel, facturering en gebruikslimieten en probeer het opnieuw.',
    failure: 'Zoeken naar actuele informatie is mislukt. Vraag het zo meteen opnieuw.',
  },
  pl: {
    handoff: 'Sprawdzę teraz najnowsze informacje i źródła.',
    quota: 'Limit API wyszukiwania najnowszych informacji został wyczerpany. Sprawdź klucz API, rozliczenia i limity użycia, a potem spróbuj ponownie.',
    failure: 'Wyszukiwanie najnowszych informacji nie powiodło się. Zapytaj ponownie za chwilę.',
  },
  uk: {
    handoff: 'Зараз перевірю найновішу інформацію та джерела.',
    quota: 'Квоту API пошуку актуальної інформації вичерпано. Перевірте API-ключ, оплату та ліміти використання, а потім спробуйте ще раз.',
    failure: 'Не вдалося знайти актуальну інформацію. Будь ласка, запитайте ще раз трохи пізніше.',
  },
});

function getGroundedSearchMessages(query, languageCode = '') {
  const resolvedLanguageCode = resolveChatLanguageCode(query, languageCode);
  return GROUNDED_SEARCH_MESSAGES[resolvedLanguageCode] ?? GROUNDED_SEARCH_MESSAGES.en;
}

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

export function buildTypedUserTurn(text, languageCode = '') {
  const selectedLanguageName = getChatLanguageName(languageCode);
  const selectedLanguageRule = selectedLanguageName
    ? ` The app input language selected by the user is ${selectedLanguageName}; use that as a strong hint, but if the words clearly use another language, follow the words themselves.`
    : '';

  return [
    `[System] Typed user message. Reply only in the same language as this message unless the user explicitly asks for another language.${selectedLanguageRule} Registered app languages are: ${REGISTERED_CHAT_LANGUAGE_NAMES}. If this message is in any registered language, answer only in that exact language. If the user switches from English to another registered language, immediately answer in that new language. Do not give bilingual replies except for explicit translation/language-practice requests; quoted words, proper nouns, URLs, ticker symbols, and language-learning examples may stay in their original language.`,
    text,
  ].join('\n');
}

export function buildGroundedSearchHandoff(query, languageCode = '') {
  return getGroundedSearchMessages(query, languageCode).handoff;
}

export function toGroundedSearchMessage(error, query, languageCode = '') {
  const message = error instanceof Error ? error.message : '';
  const localizedMessages = getGroundedSearchMessages(query, languageCode);
  if (/429|quota|rate limit|too_many_requests/i.test(message)) {
    return localizedMessages.quota;
  }

  return localizedMessages.failure;
}
