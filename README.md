# co-web

`co-second`의 웹앱 버전입니다. 배포 파일에는 Gemini API 키를 넣지 않습니다.
사용자는 웹앱 안의 키 설정 창에서 자기 API 키를 입력하고, 그 값은 해당 브라우저의
`localStorage`에만 저장됩니다.

## 기능 범위

- 카메라/마이크 기반 Gemini Live 대화
- 한국어/영어 입력창, 250ms 자동 번역, 영어 음성 2회 읽기
- Gemini TTS 실패 시 브라우저 음성 합성 fallback
- AI 말풍선 번역/직역/다시 읽기/고정
- 선택 영역 분석
- 드로잉, 수학 `=` 박스, 자연어 필기 설명 박스
- 단어 사전 링크
- 지도, 미디어 파일, YouTube 오버레이
- 채팅 스냅샷 저장

## 로컬 실행

정적 파일이므로 별도 빌드 없이 실행할 수 있습니다.

```bash
python3 -m http.server 4173
```

그 다음 `http://localhost:4173`을 엽니다.

## 배포

GitHub 저장소를 Vercel 프로젝트로 Import하면 `main` 브랜치에 푸시될 때마다 자동 배포됩니다.
Vercel 환경 변수에 개인 API 키를 넣을 필요가 없습니다.
