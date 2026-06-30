const SNAPSHOTS_KEY = 'co-web.chat.snapshots';
const APPEARANCE_KEY = 'co-web.chat.appearance';

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

export function loadChatSnapshots() {
  const snapshots = readJson(SNAPSHOTS_KEY, []);
  return Array.isArray(snapshots) ? snapshots : [];
}

export function saveChatSnapshots(snapshots) {
  writeJson(SNAPSHOTS_KEY, snapshots);
}

export function loadChatAppearance() {
  const appearance = readJson(APPEARANCE_KEY, null);
  return appearance && typeof appearance === 'object' ? appearance : null;
}

export function saveChatAppearance(appearance) {
  writeJson(APPEARANCE_KEY, appearance);
}
