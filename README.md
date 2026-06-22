# co-web

`co-second`를 웹으로 다시 올리기 위한 깨끗한 PWA 기반입니다.

이번 리셋의 원칙:

- 기존 정적 프로토타입 기능은 제거했습니다.
- `co-second`와 화면을 맞추기 위해 첫 화면은 카메라 전체 화면과 하단 툴바만 둡니다.
- 기능은 DDD 스타일 모듈 경계 안에서 하나씩 추가합니다.
- API 키는 저장소, Vercel, GitHub Actions에 넣지 않습니다.
- PWA 설치 조건을 맞춰 핸드폰 Chrome에서 홈 화면 아이콘으로 열 수 있게 합니다.

## 현재 단계

1. App shell
2. Camera preview
3. Native-like bottom toolbar placeholders
4. PWA manifest/service worker/install prompt
5. API key local storage 모듈 자리

## 다음 단계

1. Gemini API key 입력 화면
2. Gemini Live 연결
3. Chat panel
4. Input translation/TTS
5. Drawing
6. Selection analysis
7. Map/Media/YouTube
