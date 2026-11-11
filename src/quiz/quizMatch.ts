import type { Pregunta } from './preguntas';

/** At most this many surprise questions are asked before the race result stands. */
export const QUIZ_MAX_QUESTIONS = 5;
/** Seconds each player has to answer. */
export const QUIZ_ANSWER_SECONDS = 10;

/** A question ready to show: its options shuffled, with the right one tracked. */
export interface QuizQuestion {
  text: string;
  options: string[];
  correct: number;
}

export interface QuizMatch {
  /** The player who crossed the line first (0 or 1). */
  readonly raceWinner: number;
  /** Who is answering now. */
  turn: number;
  /** 1-based number of the question being asked. */
  number: number;
  question: QuizQuestion;
  /** Correct answers per player. */
  correct: [number, number];
  /** The champion, once decided. */
  champion: number | null;
  readonly remaining: Pregunta[];
}

export interface QuizAnswerResult {
  right: boolean;
  /** The answer that was right, to show after a miss. */
  correctOption: string;
  /** True once the quiz is over and `match.champion` is set. */
  finished: boolean;
}

function shuffle<T>(items: T[], random: () => number): T[] {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

function prepare(pregunta: Pregunta, random: () => number): QuizQuestion {
  const order = shuffle([0, 1, 2, 3], random);
  return {
    text: pregunta.texto,
    options: order.map((index) => pregunta.opciones[index]),
    correct: order.indexOf(pregunta.correcta),
  };
}

/** Draws the next question, never repeating one within a match. */
function draw(match: Pick<QuizMatch, 'remaining'>, bank: readonly Pregunta[], random: () => number) {
  if (match.remaining.length === 0) match.remaining.push(...bank);
  const index = Math.floor(random() * match.remaining.length);
  const [pregunta] = match.remaining.splice(index, 1);
  return prepare(pregunta, random);
}

/** The first question goes to whoever crossed the line first. */
export function createQuizMatch(
  raceWinner: number,
  bank: readonly Pregunta[],
  random: () => number = Math.random,
): QuizMatch {
  const remaining = [...bank];
  return {
    raceWinner,
    turn: raceWinner,
    number: 1,
    question: draw({ remaining }, bank, random),
    correct: [0, 0],
    champion: null,
    remaining,
  };
}

/**
 * Settles the current question: `choice` is the option index picked, or null
 * when time ran out. A right answer wins; a miss passes a new question to the
 * other player, and after the last question the race result stands.
 */
export function answerQuiz(
  match: QuizMatch,
  choice: number | null,
  bank: readonly Pregunta[],
  random: () => number = Math.random,
): QuizAnswerResult {
  const { question } = match;
  const right = choice === question.correct;
  const correctOption = question.options[question.correct];
  if (right) {
    match.correct[match.turn] += 1;
    match.champion = match.turn;
    return { right, correctOption, finished: true };
  }
  if (match.number >= QUIZ_MAX_QUESTIONS) {
    match.champion = match.raceWinner;
    return { right, correctOption, finished: true };
  }
  match.turn = 1 - match.turn;
  match.number += 1;
  match.question = draw(match, bank, random);
  return { right, correctOption, finished: false };
}
