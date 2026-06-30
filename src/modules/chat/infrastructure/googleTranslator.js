export class GoogleTranslator {
  async translate(text, fromLang, toLang) {
    const trimmed = text.trim();
    if (!trimmed) {
      return '';
    }

    const response = await fetch(
      `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${fromLang}&tl=${toLang}&dt=t&q=${encodeURIComponent(trimmed)}`,
    );

    if (!response.ok) {
      throw new Error(`Google Translate error ${response.status}`);
    }

    const data = await response.json();
    return data[0]?.map((segment) => segment[0]).join('') ?? '';
  }
}
