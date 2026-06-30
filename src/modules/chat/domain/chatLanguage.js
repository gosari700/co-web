import {
  CHAT_TRANSLATION_LANGUAGES,
  getTranslationLanguage,
} from './translationLanguages.js';

export const REGISTERED_CHAT_LANGUAGE_NAMES = CHAT_TRANSLATION_LANGUAGES
  .map((language) => language.englishName)
  .join(', ');

const LANGUAGE_DETECTION_PATTERNS = Object.freeze([
  { code: 'ko', pattern: /[가-힣ㄱ-ㅎㅏ-ㅣ]/ },
  { code: 'ja', pattern: /[\u3040-\u30ff]/ },
  { code: 'ar', pattern: /[\u0600-\u06ff]/ },
  { code: 'th', pattern: /[\u0e00-\u0e7f]/ },
  { code: 'hi', pattern: /[\u0900-\u097f]/ },
  { code: 'uk', pattern: /[іїєґІЇЄҐ]/ },
  { code: 'ru', pattern: /[\u0400-\u04ff]/ },
  { code: 'zh-CN', pattern: /[\u4e00-\u9fff]/ },
  { code: 'vi', pattern: /[ăâđêôơưĂÂĐÊÔƠƯ]/ },
  { code: 'tr', pattern: /[ğışİĞŞ]/ },
  { code: 'pl', pattern: /[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/ },
  { code: 'de', pattern: /[äöüßÄÖÜẞ]/ },
  { code: 'es', pattern: /[¿¡ñÑ]/ },
  { code: 'pt', pattern: /[ãõÃÕ]/ },
  { code: 'fr', pattern: /[æœÿÆŒŸ]/ },
]);

export function resolveChatLanguageCode(text = '', explicitLanguageCode = '') {
  const explicitLanguage = getTranslationLanguage(explicitLanguageCode);
  if (explicitLanguage) {
    return explicitLanguage.code;
  }

  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }

  return LANGUAGE_DETECTION_PATTERNS.find(({ pattern }) => pattern.test(trimmed))?.code ?? null;
}

export function getChatLanguageName(code) {
  return getTranslationLanguage(code)?.englishName ?? '';
}
