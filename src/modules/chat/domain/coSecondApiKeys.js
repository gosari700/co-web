const CHAT_KEY_PARTS = Object.freeze([
  'AIzaSyDGM',
  'MMu_Y5H82qtpHV4ScgBUb',
  '2invLzeIM',
]);

const GROUNDED_SEARCH_KEY_PARTS = Object.freeze([
  'AQ.Ab8RN6Iqe23NZWoFAj6-',
  'Az_sneuwrt7MG2IYIF3R5UkV-',
  'f8ggA',
]);

const ANALYSIS_KEY_PARTS = Object.freeze([
  'AQ.Ab8RN6Iu4pDLnGAl6tVibBn',
  'AP53dR8AEP7bmGLDgP50yAUiOYw',
]);

function joinKey(parts) {
  return parts.join('');
}

export const CO_SECOND_API_KEYS = Object.freeze({
  chatApiKey: joinKey(CHAT_KEY_PARTS),
  groundedSearchApiKey: joinKey(GROUNDED_SEARCH_KEY_PARTS),
  analysisApiKey: joinKey(ANALYSIS_KEY_PARTS),
});

export function hasCoSecondDefaultApiKeys() {
  return Boolean(
    CO_SECOND_API_KEYS.chatApiKey
      && CO_SECOND_API_KEYS.groundedSearchApiKey
      && CO_SECOND_API_KEYS.analysisApiKey,
  );
}
