import { CAMERA_STATUS, toCameraErrorMessage } from '../domain/cameraState.js';

export function createCameraController({
  state,
  videoElement,
  onStateChange,
}) {
  async function start() {
    if (!navigator.mediaDevices?.getUserMedia) {
      state.camera.status = CAMERA_STATUS.error;
      state.camera.errorMessage = '이 브라우저는 카메라 미리보기를 지원하지 않습니다.';
      onStateChange();
      return;
    }

    stop();
    state.camera.status = CAMERA_STATUS.booting;
    state.camera.errorMessage = '';
    onStateChange();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });

      state.camera.stream = stream;
      videoElement.srcObject = stream;
      await videoElement.play();
      state.camera.status = CAMERA_STATUS.ready;
      onStateChange();
    } catch (error) {
      state.camera.stream = null;
      state.camera.status = CAMERA_STATUS.error;
      state.camera.errorMessage = toCameraErrorMessage(error);
      onStateChange();
    }
  }

  function stop() {
    if (state.camera.stream) {
      state.camera.stream.getTracks().forEach((track) => track.stop());
    }
    state.camera.stream = null;
    videoElement.srcObject = null;
  }

  return {
    start,
    stop,
  };
}
