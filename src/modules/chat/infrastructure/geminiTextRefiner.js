export class GeminiTextRefiner {
  constructor(config) {
    this.config = config;
  }

  async refine(text) {
    const trimmed = text.trim();
    if (!trimmed) {
      return text;
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${this.config.model}:generateContent?key=${encodeURIComponent(this.config.apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: `당신은 최고 수준의 한국어 문법 및 띄어쓰기 교정 AI입니다.
제공된 텍스트는 음성인식(STT) 결과이므로 띄어쓰기가 무시되었거나, 발음이 유사한 잘못된 단어로 인식되었거나, 문법이 틀렸을 수 있습니다.

[요구사항]
1. 입력된 텍스트의 문맥을 파악하여 가장 일상적이고 자연스러운 한국어 문장으로 완벽하게 교정하세요.
2. 띄어쓰기와 맞춤법을 정확하게 교정하세요.
3. 문장 끝에는 문맥에 맞게 적절한 문장 부호(. ? !)를 추가하고, 문장 부호 뒤에는 띄어쓰기를 하세요.
4. 의미가 변질되지 않는 선에서 가장 매끄러운 문법으로 수정하세요.
5. 절대로 다른 언어로 번역하지 마세요 (입력된 언어 유지).
6. 인사말, 부연 설명, 따옴표 없이 "오직 교정된 텍스트만" 출력하세요.

입력: "${trimmed}"

출력 (오직 교정된 텍스트만):`,
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 256,
          },
        }),
      },
    );

    if (!response.ok) {
      return text;
    }

    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || text;
  }
}
