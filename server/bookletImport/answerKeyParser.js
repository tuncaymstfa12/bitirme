export function parseAnswerKeyText(rawText) {
  const answerKey = {};
  const text = String(rawText || '').toUpperCase();
  const pattern = /(?:^|\n|\s)(\d{1,3})\s*[:.\-)]\s*([A-E])(?:\s|$)/g;

  for (const match of text.matchAll(pattern)) {
    const questionNumber = Number(match[1]);
    if (questionNumber >= 1 && questionNumber <= 200) {
      answerKey[String(questionNumber)] = match[2];
    }
  }

  return answerKey;
}
