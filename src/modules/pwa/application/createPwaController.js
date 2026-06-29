export function createPwaController({
  state,
  installButton,
  onMessage,
}) {
  function updateInstallButton() {
    installButton.hidden = state.pwa.isStandalone || !state.pwa.installPrompt;
  }

  async function clearServiceWorkers() {
    if ('serviceWorker' in navigator) {
      try {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map((registration) => registration.unregister()));
      } catch (error) {
        console.warn('[co-web] service worker cleanup failed:', error);
      }
    }

    if (!window.caches?.keys) {
      return;
    }

    try {
      const keys = await window.caches.keys();
      await Promise.all(keys.map((key) => window.caches.delete(key)));
    } catch (error) {
      console.warn('[co-web] cache cleanup failed:', error);
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
      bindInstallPrompt();
      updateInstallButton();
      window.setTimeout(() => {
        void clearServiceWorkers();
      }, 1500);
    },
  };
}
