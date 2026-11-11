const COLORS = ['#e9ff42', '#58ffc2', '#ff5d8f', '#5fd8ff', '#ffb547', '#ffffff'];

interface Piece {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  spin: number;
  angle: number;
  color: string;
}

/**
 * Bursts confetti over `container` from both bottom corners and the top, then
 * removes its canvas. Stops early when `signal` aborts.
 */
export function launchConfetti(container: HTMLElement, durationMs = 4500, signal?: AbortSignal): void {
  const canvas = document.createElement('canvas');
  canvas.className = 'confetti-canvas';
  container.append(canvas);
  const context = canvas.getContext('2d');
  if (!context) {
    canvas.remove();
    return;
  }
  const scale = Math.min(window.devicePixelRatio || 1, 2);
  const resize = () => {
    canvas.width = container.clientWidth * scale;
    canvas.height = container.clientHeight * scale;
  };
  resize();
  const width = () => canvas.width / scale;
  const height = () => canvas.height / scale;

  const pieces: Piece[] = [];
  const burst = (x: number, y: number, count: number, aim: number, spread: number, power: number) => {
    for (let i = 0; i < count; i += 1) {
      const angle = aim + (Math.random() - 0.5) * spread;
      const speed = power * (0.55 + Math.random() * 0.6);
      pieces.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: 5 + Math.random() * 7,
        spin: (Math.random() - 0.5) * 14,
        angle: Math.random() * Math.PI,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
      });
    }
  };
  burst(0, height(), 90, -Math.PI / 3, 0.9, 1100);
  burst(width(), height(), 90, (-2 * Math.PI) / 3, 0.9, 1100);
  // A gentle shower from the top keeps it going.
  let showered = 0;

  const start = performance.now();
  let last = start;
  let frame = 0;
  const stop = () => {
    cancelAnimationFrame(frame);
    canvas.remove();
  };
  signal?.addEventListener('abort', stop, { once: true });

  const step = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const elapsed = now - start;
    if (elapsed < durationMs * 0.6 && showered < elapsed / 25) {
      showered += 1;
      pieces.push({
        x: Math.random() * width(),
        y: -10,
        vx: (Math.random() - 0.5) * 60,
        vy: 80 + Math.random() * 120,
        size: 5 + Math.random() * 6,
        spin: (Math.random() - 0.5) * 10,
        angle: Math.random() * Math.PI,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
      });
    }
    context.setTransform(scale, 0, 0, scale, 0, 0);
    context.clearRect(0, 0, width(), height());
    const fade = Math.min(1, Math.max(0, (durationMs - elapsed) / 800));
    context.globalAlpha = fade;
    for (const piece of pieces) {
      piece.vy += 900 * dt;
      piece.vx *= 1 - 1.2 * dt;
      piece.vy *= 1 - 1.2 * dt;
      piece.x += piece.vx * dt;
      piece.y += piece.vy * dt;
      piece.angle += piece.spin * dt;
      context.save();
      context.translate(piece.x, piece.y);
      context.rotate(piece.angle);
      context.scale(1, Math.abs(Math.cos(piece.angle * 1.7)) * 0.8 + 0.2);
      context.fillStyle = piece.color;
      context.fillRect(-piece.size / 2, -piece.size / 4, piece.size, piece.size / 2);
      context.restore();
    }
    if (elapsed < durationMs && !signal?.aborted) frame = requestAnimationFrame(step);
    else stop();
  };
  frame = requestAnimationFrame(step);
}
