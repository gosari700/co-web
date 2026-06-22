const STORAGE_KEY = 'co-web.geminiApiKey';

export function loadApiKey() {
  return localStorage.getItem(STORAGE_KEY) || '';
}

export function saveApiKey(apiKey) {
  const trimmed = apiKey.trim();
  if (!trimmed) {
    localStorage.removeItem(STORAGE_KEY);
    return;
  }
  localStorage.setItem(STORAGE_KEY, trimmed);
}

export function clearApiKey() {
  localStorage.removeItem(STORAGE_KEY);
}
