co-porting-core 스킬을 먼저 읽고, 필요한 기능별 스킬 
  도 따라 읽어서, co-second의 구현을 기준으로 이 폴더에  이식해줘. 앱 식별자/배포 설정/secrets는 복사하지 말  
  고, 다른 기능은 건드리지 마라.

## 2026-06-30

- 하단 툴바 아이콘 스케일을 0.70에서 0.77로 조정했다.
- 툴바 높이와 버튼 배치는 변경하지 않았다.
- 앱 시작 시 주소줄/진행바가 다시 보이지 않도록 초기 화면을 검은 launch cover로 고정하고, 기존 cache는 reload 없이 제거하도록 바꿨다.
- `co-second`의 검은 카메라 placeholder 흐름을 기준으로 하되, 웹/PWA 특성은 `cl-web`의 검은 splash와 reload 없는 정리 방식을 참고했다.
- Chrome 홈화면 설치형 PWA에서는 service worker가 standalone/fullscreen 앱 컨테이너 판정에 필요하므로, 캐시하지 않는 network-only service worker를 다시 유지하도록 조정했다.
- WebView 앱 시작 시 `navigator.permissions` 판정에 기대지 않고 바로 카메라 시작을 시도하도록 바꿨다. 수동 `카메라 시작` 화면은 자동 시작 실패/권한 거부 때만 보인다.
