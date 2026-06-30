export const CHAT_TRANSLATION_LANGUAGES = Object.freeze([
  { code: 'ko', label: '한국어', englishName: 'Korean', speechLocale: 'ko-KR' },
  { code: 'en', label: '영어', englishName: 'English', speechLocale: 'en-US' },
  { code: 'ja', label: '일본어', englishName: 'Japanese', speechLocale: 'ja-JP' },
  { code: 'zh-CN', label: '중국어(간체)', englishName: 'Chinese (Simplified)', speechLocale: 'zh-CN' },
  { code: 'zh-TW', label: '중국어(번체)', englishName: 'Chinese (Traditional)', speechLocale: 'zh-TW' },
  { code: 'es', label: '스페인어', englishName: 'Spanish', speechLocale: 'es-ES' },
  { code: 'fr', label: '프랑스어', englishName: 'French', speechLocale: 'fr-FR' },
  { code: 'de', label: '독일어', englishName: 'German', speechLocale: 'de-DE' },
  { code: 'it', label: '이탈리아어', englishName: 'Italian', speechLocale: 'it-IT' },
  { code: 'pt', label: '포르투갈어', englishName: 'Portuguese', speechLocale: 'pt-PT' },
  { code: 'ru', label: '러시아어', englishName: 'Russian', speechLocale: 'ru-RU' },
  { code: 'vi', label: '베트남어', englishName: 'Vietnamese', speechLocale: 'vi-VN' },
  { code: 'th', label: '태국어', englishName: 'Thai', speechLocale: 'th-TH' },
  { code: 'id', label: '인도네시아어', englishName: 'Indonesian', speechLocale: 'id-ID' },
  { code: 'hi', label: '힌디어', englishName: 'Hindi', speechLocale: 'hi-IN' },
  { code: 'ar', label: '아랍어', englishName: 'Arabic', speechLocale: 'ar-SA' },
  { code: 'tr', label: '터키어', englishName: 'Turkish', speechLocale: 'tr-TR' },
  { code: 'nl', label: '네덜란드어', englishName: 'Dutch', speechLocale: 'nl-NL' },
  { code: 'pl', label: '폴란드어', englishName: 'Polish', speechLocale: 'pl-PL' },
  { code: 'uk', label: '우크라이나어', englishName: 'Ukrainian', speechLocale: 'uk-UA' },
]);

export function getTranslationLanguage(code) {
  return CHAT_TRANSLATION_LANGUAGES.find((item) => item.code === code);
}

export function getTranslationLanguageLabel(code) {
  return getTranslationLanguage(code)?.label ?? code;
}

export function getTranslationLanguageSpeechLocale(code) {
  return getTranslationLanguage(code)?.speechLocale;
}
