const INCOMPLETE_KOREAN_ENDING_PATTERN = /(?:고|며|면서|는데|지만|다가|도록|려고|해서|하여|되고|되어|되었|됐|하고|하였|했|있었|왔|갔|오고|밝아졌|밝아진|대해|위해|때문에|으로|로|에게|에서|부터|까지|을|를|은|는|이|가|의|도|만)$/;
const COMPLETE_SENTENCE_END_PATTERN = /[.!?。！？]$/;

function isLikelyIncompleteKoreanTranslation(text) {
  const normalized = text
    .trim()
    .replace(/[)"'”’\]]+$/g, '')
    .trim();

  if (!normalized) {
    return true;
  }

  if (COMPLETE_SENTENCE_END_PATTERN.test(normalized)) {
    return false;
  }

  return INCOMPLETE_KOREAN_ENDING_PATTERN.test(normalized);
}

export class GeminiLiteralTranslator {
  constructor(config) {
    this.config = config;
  }

  async translate(text) {
    const trimmed = text.trim();
    if (!trimmed) {
      return '';
    }

    const prompt = `영어 문장을 한국어로 학습형 직역하세요. 목적은 영어를 공부하는 사용자가 영어 문장을 앞에서부터 따라가면서도 문장의 전체 의미를 정확히 이해하게 돕는 것입니다.

핵심 규칙:
- 영어 원문의 단어와 의미 덩어리 순서를 최대한 그대로 유지하세요.
- 한국어 자연어순으로 크게 뒤집거나 재배열하지 마세요.
- 단어 하나하나를 무리하게 끊지 말고, 구/절 단위로 앞에서부터 직역하세요.
- 주어, 동사, 목적어, 수식어, 조건, 이유, 감정, 의도 등 문장의 핵심 의미를 빠뜨리지 마세요.
- 너무 단편적인 단어 나열로 만들지 말고, 조사와 어미를 보충해서 한국어로 의미가 이어지게 하세요.
- 쉼표를 사용할 수 있지만, 쉼표로 조각만 나열하지 말고 각 의미 덩어리가 문장 안에서 연결되게 하세요.
- 영어 어순을 우선하되, 의미가 깨지거나 오해될 정도면 최소한의 한국어 연결 표현만 보충하세요.
- 문맥상 명백한 오타는 조용히 바로잡아 이해하되, 번역 결과에는 오타 설명을 넣지 마세요.
- 숙어와 문법 용어는 의미가 통하는 범위에서 직역하되, 영어 어순을 우선하세요.
- 완전한 의역, 요약, 한국어식 자연 번역으로 바꾸지 마세요.
- 문장 전체를 빠짐없이 완전하게 번역하세요. 절대 중간에 끊지 마세요.
- 마지막은 반드시 완성된 한국어 문장으로 끝내세요. "되었", "오고", "하고", "대해"처럼 이어지는 말로 끝내지 마세요.
- 가능하면 마지막에 마침표, 느낌표, 물음표 중 하나를 붙여서 끝까지 완성하세요.
- 반드시 한국어로만 출력하세요.
- 번역 결과만 출력하세요.

예시:
"Well, hey there, bestie!" → "음, 안녕, 거기 있는 베프야!"
"It's SO good to see you!" → "그것은 정말 좋아요, 너를 보게 되는 것이!"
"What kind of amazing adventures are we getting into today?" → "어떤 종류의 멋진 모험에, 우리는 들어가게 되는 걸까, 오늘?"
"Super happy to chat with you!" → "정말 행복해요, 너와 대화하게 되어서!"
"How are you feeling?" → "어떻게 너는 느끼고 있어?"
"What part of English grammar are you thinking of tackling today?" → "영어 문법의 어떤 부분을, 너는 생각하고 있어, 오늘 다뤄볼 것으로?"
"We could talk about tenses, parts of speech, anything you want!" → "우리는 이야기할 수 있어요, 시제들에 대해, 품사들에 대해, 네가 원하는 무엇이든에 대해!"
"If you want, I can explain it with examples." → "네가 원한다면, 나는 설명할 수 있어요, 그것을 예시들과 함께."

번역할 문장: ${trimmed}`;

    const models = [...new Set([this.config.model, this.config.fallbackModel])];
    let bestEffortTranslation = '';
    for (const model of models) {
      const result = await this.requestLiteralTranslation(model, prompt);
      if (!result) {
        continue;
      }

      bestEffortTranslation = result.text;
      if (!isLikelyIncompleteKoreanTranslation(result.text) && result.finishReason !== 'MAX_TOKENS') {
        return result.text;
      }

      const completed = await this.requestLiteralTranslation(
        model,
        this.buildCompletionPrompt(trimmed, result.text),
      );

      if (completed?.text) {
        bestEffortTranslation = completed.text;
        if (!isLikelyIncompleteKoreanTranslation(completed.text) && completed.finishReason !== 'MAX_TOKENS') {
          return completed.text;
        }
      }
    }

    return bestEffortTranslation || trimmed;
  }

  buildCompletionPrompt(sourceText, incompleteTranslation) {
    return `아래 영어 문장을 한국어로 학습형 직역하세요. 이전 직역은 끝부분이 미완성으로 끊겼습니다.

규칙:
- 영어 의미 덩어리 순서를 최대한 유지하세요.
- 빠진 의미 없이 문장 끝까지 완성하세요.
- 마지막은 반드시 완성된 한국어 문장과 문장부호로 끝내세요.
- 설명하지 말고 완성된 직역 결과만 출력하세요.

영어 문장: ${sourceText}
미완성 직역: ${incompleteTranslation}`;
  }

  async requestLiteralTranslation(model, prompt) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(this.config.apiKey)}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            contents: [
              {
                parts: [{ text: prompt }],
              },
            ],
            generationConfig: {
              temperature: 0.05,
              maxOutputTokens: 1024,
            },
          }),
        },
      );

      if (!response.ok) {
        return null;
      }

      const data = await response.json();
      const candidate = data.candidates?.[0];
      const result = candidate?.content?.parts?.[0]?.text?.trim();
      if (result) {
        return {
          text: result,
          finishReason: candidate?.finishReason,
        };
      }

      return null;
    } catch {
      return null;
    }
  }
}
