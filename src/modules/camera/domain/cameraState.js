export const CAMERA_STATUS = Object.freeze({
  booting: 'booting',
  idle: 'idle',
  ready: 'ready',
  error: 'error',
});

export function toCameraErrorMessage(error) {
  if (error?.name === 'NotAllowedError') {
    return '카메라 권한이 거부되었습니다. Chrome 사이트 설정에서 카메라를 허용해 주세요.';
  }
  if (error?.name === 'NotFoundError') {
    return '사용 가능한 카메라를 찾지 못했습니다.';
  }
  if (error?.name === 'NotReadableError') {
    return '다른 앱이 카메라를 사용 중일 수 있습니다.';
  }
  return error?.message || '카메라를 시작할 수 없습니다.';
}
