export function createPwaController({
  state,
  installButton,
  onMessage,
}) {
  function updateInstallButton() {
    installButton.hidden = state.pwa.isStandalone || !state.pwa.installPrompt;
  }

  async function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) {
      return;
    }
    if (state.pwa.isStandalone && navigator.serviceWorker.controller) {
      return;
    }

    try {
      await navigator.serviceWorker.register('/sw.js');
    } catch (error) {
      console.warn('[co-web] service worker registration failed:', error);
    }
  }

  function bindInstallPrompt() {
    window.addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault();
      state.pwa.installPrompt = event;
      updateInstallButton();
    });

    window.addEventListener('appinstalled', () => {
      state.pwa.installPrompt = null;
      state.pwa.isStandalone = true;
      updateInstallButton();
      onMessage('홈 화면 설치가 완료되었습니다.');
    });

    installButton.addEventListener('click', async () => {
      if (!state.pwa.installPrompt) {
        onMessage('Chrome 메뉴에서 "홈 화면에 추가"를 선택해 주세요.');
        return;
      }

      const promptEvent = state.pwa.installPrompt;
      state.pwa.installPrompt = null;
      updateInstallButton();
      await promptEvent.prompt();
    });
  }

  return {
    start() {
      void registerServiceWorker();
      bindInstallPrompt();
      updateInstallButton();
    },
  };
}
