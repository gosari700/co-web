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

export const CHAT_APPEARANCE_TARGETS = Object.freeze([
  { id: 'panelBackgroundColor', label: '패널' },
  { id: 'aiBubbleBackgroundColor', label: 'AI 배경' },
  { id: 'aiTextColor', label: 'AI 글자' },
  { id: 'aiBubbleBorderColor', label: 'AI 테두리' },
  { id: 'aiKoreanTranslationTextColor', label: '번역' },
  { id: 'inputEnglishTextColor', label: '영어번역' },
  { id: 'inputBackgroundColor', label: '입력 배경' },
  { id: 'inputKoreanTextColor', label: '입력 글자' },
  { id: 'myBubbleBackgroundColor', label: '내 배경' },
  { id: 'myTextColor', label: '내 글자' },
  { id: 'myBubbleBorderColor', label: '내 테두리' },
]);

export const CHAT_APPEARANCE_SWATCHES = Object.freeze([
  '#9E9E9E',
  '#3D3D3D',
  '#4A4A4A',
  '#FFFFFF',
  '#9CDCFE',
  '#FFD180',
  '#00C853',
  '#2196F3',
  '#E65100',
  '#2D2D2D',
  'transparent',
]);

export function createDefaultChatAppearance() {
  return { ...DEFAULT_CHAT_APPEARANCE };
}
