import { createAppState } from '../domain/createAppState.js';
import { createCameraController } from '../../camera/application/createCameraController.js';
import { CAMERA_STATUS } from '../../camera/domain/cameraState.js';
import { createChatController } from '../../chat/application/createChatController.js';
import { createPwaController } from '../../pwa/application/createPwaController.js';
import { createToolbarController } from '../../toolbar/application/createToolbarController.js';

export function createCoWebApp({ root }) {
  if (!root) {
    throw new Error('App root is required.');
  }

  const state = createAppState();
  const elements = {
    root,
    cameraPreview: document.querySelector('#camera-preview'),
    permissionPanel: document.querySelector('#camera-permission'),
    permissionTitle: document.querySelector('#permission-title'),
    permissionMessage: document.querySelector('#permission-message'),
    startCameraButton: document.querySelector('#start-camera-button'),
    installButton: document.querySelector('#install-app-button'),
    toast: document.querySelector('#toast'),
    toolbarButtons: Array.from(document.querySelectorAll('.toolbar-button')),
  };

  const showToast = (message) => {
    elements.toast.textContent = message;
    elements.toast.hidden = false;
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => {
      elements.toast.hidden = true;
    }, 1800);
  };

  const render = () => {
    elements.root.dataset.cameraState = state.camera.status;
    const isBooting = state.camera.status === CAMERA_STATUS.booting;
    const isReady = state.camera.status === CAMERA_STATUS.ready;
    elements.permissionPanel.hidden = isBooting || isReady;

    if (isReady) {
      elements.permissionTitle.textContent = '';
      elements.permissionMessage.textContent = '';
    } else if (state.camera.status === CAMERA_STATUS.error) {
      elements.permissionTitle.textContent = '카메라 권한 필요';
      elements.permissionMessage.textContent = state.camera.errorMessage || 'Chrome 권한 설정에서 카메라를 허용해 주세요.';
    } else {
      elements.permissionTitle.textContent = '카메라 준비 중';
      elements.permissionMessage.textContent = '권한을 허용하면 native 앱처럼 전체 화면 카메라가 먼저 열립니다.';
    }

    elements.toolbarButtons.forEach((button) => {
      const feature = button.dataset.feature;
      const isChatActive = feature === 'chat' && state.chat?.isOpen;
      const isChatColumnActive = feature === 'columns' && state.chat?.showSideColumn;
      button.classList.toggle(
        'active',
        isChatActive || isChatColumnActive || feature === state.activeFeature,
      );
    });
  };

  const camera = createCameraController({
    state,
    videoElement: elements.cameraPreview,
    onStateChange: render,
  });

  const pwa = createPwaController({
    state,
    installButton: elements.installButton,
    onStateChange: render,
    onMessage: showToast,
  });

  const chat = createChatController({
    state,
    hostElement: elements.root,
    onStateChange: render,
    onMessage: showToast,
  });

  const toolbar = createToolbarController({
    state,
    buttons: elements.toolbarButtons,
    onStateChange: render,
    onUnsupportedFeature: (feature) => {
      showToast(`${feature.label} 기능은 다음 단계에서 추가합니다.`);
    },
    onFeaturePress: (featureId) => chat.handleToolbarFeature(featureId),
  });

  return {
    start() {
      render();
      pwa.start();
      chat.start();
      toolbar.start();
      elements.startCameraButton.addEventListener('click', () => {
        void camera.start();
      });
      void camera.start();
    },
    stop() {
      camera.stop();
      chat.stop();
    },
  };
}
