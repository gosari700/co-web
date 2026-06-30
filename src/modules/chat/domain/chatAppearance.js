export const DEFAULT_CHAT_APPEARANCE = Object.freeze({
  panelBackgroundColor: '#9E9E9E',
  iconFrameBackgroundColor: 'transparent',
  iconFrameBorderColor: '#2196F3',
  iconInactiveColor: '#999999',
  aiBubbleBackgroundColor: '#3D3D3D',
  aiTextColor: '#FFFFFF',
  aiBubbleBorderColor: 'transparent',
  aiKoreanTranslationTextColor: '#9CDCFE',
  inputEnglishTextColor: '#9CDCFE',
  inputBackgroundColor: '#2D2D2D',
  inputKoreanTextColor: '#FFFFFF',
  myTextColor: '#FFFFFF',
  myBubbleBackgroundColor: '#4A4A4A',
  myBubbleBorderColor: 'transparent',
});

export const CHAT_APPEARANCE_TARGET_COLUMNS = Object.freeze([
  Object.freeze([
    { id: 'panelBackgroundColor', label: '대화창' },
    { id: 'aiTextColor', label: 'AI글자' },
    { id: 'iconFrameBackgroundColor', label: '아이콘배경', underline: true },
  ]),
  Object.freeze([
    { id: 'aiBubbleBackgroundColor', label: 'AI박스' },
    { id: 'aiBubbleBorderColor', label: 'AI선' },
    { id: 'iconFrameBorderColor', label: '아이콘선', underline: true },
  ]),
  Object.freeze([
    { id: 'inputEnglishTextColor', label: '영어번역' },
    { id: 'inputBackgroundColor', label: '배경색' },
    { id: 'inputKoreanTextColor', label: '한국어' },
  ]),
  Object.freeze([
    { id: 'myTextColor', label: 'my글자' },
    { id: 'myBubbleBackgroundColor', label: '배경색' },
    { id: 'myBubbleBorderColor', label: 'my선' },
  ]),
]);

export const CHAT_APPEARANCE_ACTION_TARGETS = Object.freeze([
  { id: 'aiKoreanTranslationTextColor', label: '한국번역' },
  { id: 'iconInactiveColor', label: '콘색깔' },
]);

export function createDefaultChatAppearance() {
  return { ...DEFAULT_CHAT_APPEARANCE };
}

export function getChatAppearanceColor(appearance, target) {
  if (!target || !(target in appearance)) {
    return DEFAULT_CHAT_APPEARANCE.panelBackgroundColor;
  }
  return appearance[target];
}
