export const TOOLBAR_FEATURES = Object.freeze({
  map: { id: 'map', label: '지도', implemented: false },
  analysis: { id: 'analysis', label: '선택 분석', implemented: false },
  media: { id: 'media', label: '미디어', implemented: false },
  youtube: { id: 'youtube', label: 'YouTube', implemented: false },
  mic: { id: 'mic', label: '마이크', implemented: false },
  drawing: { id: 'drawing', label: '드로잉', implemented: false },
  columns: { id: 'columns', label: '세로줄', implemented: true },
  chat: { id: 'chat', label: '채팅', implemented: true },
});

export function getToolbarFeature(id) {
  return TOOLBAR_FEATURES[id] || null;
}
