import { PREGUNTAS } from '../quiz/preguntas';
import {
  answerQuiz,
  createQuizMatch,
  QUIZ_ANSWER_SECONDS,
  QUIZ_MAX_QUESTIONS,
} from '../quiz/quizMatch';
import type { QuizMatch } from '../quiz/quizMatch';

const LETTERS = ['A', 'B', 'C', 'D'];
/** Keys that pick each option: the letter or its number. */
const OPTION_KEYS = [
  ['KeyA', 'Digit1', 'Numpad1'],
  ['KeyB', 'Digit2', 'Numpad2'],
  ['KeyC', 'Digit3', 'Numpad3'],
  ['KeyD', 'Digit4', 'Numpad4'],
];
const INTRO_MS = 3200;
const FEEDBACK_MS = 2600;
const HANDOVER_MS = 2400;

function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!,
  );
}

/**
 * The surprise quiz that decides a two-player race: the first car home must
 * answer right within the time limit, or the other driver gets a question to
 * steal the win. Resolves with the finished match, champion set.
 */
export class QuizOverlay {
  constructor(
    private readonly overlay: HTMLElement,
    private readonly names: readonly [string, string],
  ) {}

  async run(raceWinner: number, signal: AbortSignal): Promise<QuizMatch> {
    const match = createQuizMatch(raceWinner, PREGUNTAS);
    const name = escapeHtml(this.names[raceWinner]);
    this.show(
      `<div class="modal compact-modal quiz-modal quiz-intro" data-player="${raceWinner}">
        <div class="eyebrow"><span></span> PRIMER LUGAR <span></span></div>
        <div class="quiz-flag">🏁</div>
        <h2>¡${name} LLEGÓ PRIMERO!</h2>
        <p class="quiz-tease">¡Llegaste primero! Pero todavía no eres el campeón…</p>
        <div class="quiz-loading"><i></i></div>
      </div>`,
    );
    await this.wait(INTRO_MS, signal);

    for (;;) {
      const choice = await this.ask(match, signal);
      const player = match.turn;
      const question = match.question;
      const result = answerQuiz(match, choice, PREGUNTAS);
      this.showFeedback(player, question.correct, choice, result.right, result.correctOption, match);
      await this.wait(FEEDBACK_MS, signal);
      if (result.finished) return match;
      const next = escapeHtml(this.names[match.turn]);
      this.show(
        `<div class="modal compact-modal quiz-modal quiz-handover" data-player="${match.turn}">
          <div class="eyebrow"><span></span> ¡OPORTUNIDAD! <span></span></div>
          <h2>¡${next}, ROBA LA VICTORIA!</h2>
          <p class="quiz-tease">Responde bien la siguiente pregunta y el trofeo es tuyo.</p>
          <div class="quiz-loading"><i></i></div>
        </div>`,
      );
      await this.wait(HANDOVER_MS, signal);
    }
  }

  /** Shows the current question and waits for an answer, or null when time runs out. */
  private ask(match: QuizMatch, signal: AbortSignal): Promise<number | null> {
    const { question, turn } = match;
    const place = turn === match.raceWinner ? 'PRIMER LUGAR' : 'SEGUNDO LUGAR';
    const options = question.options
      .map(
        (option, index) => `
          <button type="button" class="quiz-option" data-option="${index}">
            <b>${LETTERS[index]}</b><span>${escapeHtml(option)}</span>
          </button>`,
      )
      .join('');
    this.show(
      `<div class="modal compact-modal quiz-modal" data-player="${turn}">
        <div class="quiz-head">
          <span class="quiz-place">${place}</span>
          <span class="quiz-player">RESPONDE: ${escapeHtml(this.names[turn])}</span>
          <span>PREGUNTA ${match.number} DE ${QUIZ_MAX_QUESTIONS}</span>
        </div>
        <div class="quiz-title">¡PREGUNTA SORPRESA!</div>
        <h2 class="quiz-question">${escapeHtml(question.text)}</h2>
        <div class="quiz-options">${options}</div>
        <div class="quiz-timer"><i id="quiz-timer-fill"></i><b id="quiz-timer-count">${QUIZ_ANSWER_SECONDS}</b></div>
        <div id="quiz-feedback" class="quiz-feedback" aria-live="assertive"></div>
        <div class="quiz-score">RESPUESTAS CORRECTAS: ${match.correct[turn]}</div>
      </div>`,
    );
    const fill = this.overlay.querySelector<HTMLElement>('#quiz-timer-fill')!;
    const count = this.overlay.querySelector<HTMLElement>('#quiz-timer-count')!;
    return new Promise((resolve) => {
      const listeners = new AbortController();
      const start = performance.now();
      let frame = 0;
      const finish = (choice: number | null) => {
        listeners.abort();
        cancelAnimationFrame(frame);
        resolve(choice);
      };
      const tick = (now: number) => {
        const left = Math.max(0, QUIZ_ANSWER_SECONDS - (now - start) / 1000);
        fill.style.transform = `scaleX(${left / QUIZ_ANSWER_SECONDS})`;
        count.textContent = String(Math.ceil(left));
        this.overlay.querySelector('.quiz-timer')?.classList.toggle('is-urgent', left <= 3);
        if (left <= 0) finish(null);
        else frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
      for (const button of this.overlay.querySelectorAll<HTMLButtonElement>('.quiz-option')) {
        button.addEventListener('click', () => finish(Number(button.dataset.option)), {
          signal: listeners.signal,
        });
      }
      window.addEventListener(
        'keydown',
        (event) => {
          const index = OPTION_KEYS.findIndex((keys) => keys.includes(event.code));
          if (index < 0 || event.repeat) return;
          // Keep the answer keys from also reaching the driving controls (C toggles cruise).
          event.preventDefault();
          event.stopPropagation();
          finish(index);
        },
        { signal: listeners.signal, capture: true },
      );
      signal.addEventListener('abort', () => finish(null), { signal: listeners.signal });
    });
  }

  /** Marks the picked and the right option, and says how it went. */
  private showFeedback(
    player: number,
    correct: number,
    choice: number | null,
    right: boolean,
    correctOption: string,
    match: QuizMatch,
  ): void {
    for (const button of this.overlay.querySelectorAll<HTMLButtonElement>('.quiz-option')) {
      const index = Number(button.dataset.option);
      button.disabled = true;
      button.classList.toggle('is-correct', index === correct);
      button.classList.toggle('is-wrong', index === choice && !right);
    }
    this.overlay.querySelector('.quiz-timer')?.classList.add('is-stopped');
    const feedback = this.overlay.querySelector<HTMLElement>('#quiz-feedback')!;
    feedback.classList.add(right ? 'is-right' : 'is-wrong');
    const answer = escapeHtml(correctOption);
    feedback.innerHTML = right
      ? '<b>¡CORRECTO! 🎉</b>'
      : `<b>${choice === null ? '¡SE ACABÓ EL TIEMPO! ⏰' : '¡INCORRECTO! 😮'}</b><span>¡La respuesta correcta es ${answer}!</span>`;
    const score = this.overlay.querySelector<HTMLElement>('.quiz-score');
    if (score) score.textContent = `RESPUESTAS CORRECTAS: ${match.correct[player]}`;
  }

  private show(html: string): void {
    this.overlay.classList.remove('is-hidden');
    this.overlay.innerHTML = html;
  }

  private wait(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      const timer = window.setTimeout(resolve, ms);
      signal.addEventListener(
        'abort',
        () => {
          window.clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
    });
  }
}
