export function createAppState() {
  return {
    activeFeature: 'camera',
    camera: {
      status: 'booting',
      errorMessage: '',
      stream: null,
    },
    pwa: {
      installPrompt: null,
      isStandalone: window.matchMedia('(display-mode: standalone)').matches
        || window.navigator.standalone === true,
    },
  };
}
