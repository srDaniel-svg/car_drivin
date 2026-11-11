import { describe, expect, it } from 'vitest';
import { PREGUNTAS } from './preguntas';
import { answerQuiz, createQuizMatch, QUIZ_MAX_QUESTIONS } from './quizMatch';

const wrong = (correct: number) => (correct + 1) % 4;

describe('quiz match', () => {
  it('has a well-formed question bank', () => {
    expect(PREGUNTAS.length).toBeGreaterThanOrEqual(30);
    for (const pregunta of PREGUNTAS) {
      expect(new Set(pregunta.opciones).size).toBe(4);
      expect(pregunta.opciones[pregunta.correcta]).toBeDefined();
    }
  });

  it('keeps the right answer findable after shuffling the options', () => {
    for (let run = 0; run < 50; run += 1) {
      const match = createQuizMatch(0, PREGUNTAS);
      const source = PREGUNTAS.find((pregunta) => pregunta.texto === match.question.text)!;
      expect(match.question.options[match.question.correct]).toBe(
        source.opciones[source.correcta],
      );
    }
  });

  it('crowns the race winner when they answer right', () => {
    const match = createQuizMatch(1, PREGUNTAS);
    const result = answerQuiz(match, match.question.correct, PREGUNTAS);
    expect(result).toMatchObject({ right: true, finished: true });
    expect(match.champion).toBe(1);
    expect(match.correct).toEqual([0, 1]);
  });

  it('lets the other player steal the win after a miss or a timeout', () => {
    const match = createQuizMatch(0, PREGUNTAS);
    const miss = answerQuiz(match, null, PREGUNTAS);
    expect(miss).toMatchObject({ right: false, finished: false });
    expect(match.turn).toBe(1);
    expect(match.number).toBe(2);
    answerQuiz(match, match.question.correct, PREGUNTAS);
    expect(match.champion).toBe(1);
  });

  it('lets the race result stand when nobody answers right', () => {
    const match = createQuizMatch(1, PREGUNTAS);
    const asked = new Set<string>();
    let result;
    do {
      asked.add(match.question.text);
      result = answerQuiz(match, wrong(match.question.correct), PREGUNTAS);
    } while (!result.finished);
    expect(match.number).toBe(QUIZ_MAX_QUESTIONS);
    expect(asked.size).toBe(QUIZ_MAX_QUESTIONS);
    expect(match.champion).toBe(1);
  });
});
