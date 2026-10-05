import type { ArenaInfo, Cell, SnakeView } from "@snake/shared";
import { animate } from "motion";

export type Frame = { snakes: SnakeView[]; food: Cell[] };

/** Cobrinha eliminada, queimando da cabeça para a cauda como um pavio. */
type Burning = { snake: SnakeView; progress: number };

/** Anel que se expande na cabeça de quem acabou de comer. */
type Pulse = { snakeId: number; progress: number };

type Animation = { stop: () => void };

const MINIMAP_SIZE = 150;
const MINIMAP_MARGIN = 16;
const BACKGROUND = "#0b1020";
/** A câmera desliza até o alvo quando está longe dele (ex.: ao renascer). */
const GLIDE_START_CELLS = 2;
const GLIDE_END_CELLS = 0.05;

/** Menor diferença entre duas coordenadas em um eixo que dá a volta. */
function wrapDelta(value: number, size: number): number {
	return ((((value + size / 2) % size) + size) % size) - size / 2;
}

/** Tamanho da célula em pixels: a tela nunca mostra mais que meia arena. */
function cellSize(width: number, height: number): number {
	return Math.min(40, Math.max(14, Math.round(Math.max(width, height) / 48)));
}

/** Cresce devagar com o tamanho, para cobrinhas longas não demorarem a sumir. */
export function burnSeconds(length: number): number {
	return Math.min(1.6, 0.45 + length * 0.03);
}

/**
 * Estado visual da partida. O servidor move as cobrinhas uma célula por tick;
 * aqui a cabeça e a cauda deslizam entre o tick anterior e o atual, e a câmera
 * acompanha a cabeça do jogador, para o movimento não parecer aos saltos.
 */
export class Scene {
	private frame: Frame | null = null;
	private previous = new Map<number, SnakeView>();
	private frameAt = 0;
	private camera: { x: number; y: number } | null = null;
	private gliding = false;
	private lastDrawAt = 0;
	private readonly burning = new Set<Burning>();
	private readonly pulses = new Set<Pulse>();
	private readonly animations = new Set<Animation>();

	constructor(
		private readonly arena: ArenaInfo,
		private readonly myId: number,
	) {}

	/** Recebe o estado de um novo tick e dispara as animações que ele implica. */
	push(frame: Frame, now: number): void {
		const previous = new Map(
			(this.frame?.snakes ?? []).map((snake) => [snake.id, snake]),
		);
		const current = new Map(frame.snakes.map((snake) => [snake.id, snake]));

		for (const snake of previous.values()) {
			if (!current.has(snake.id)) this.burn(snake);
		}
		for (const snake of frame.snakes) {
			const before = previous.get(snake.id);
			if (before && snake.cells.length > before.cells.length) {
				this.pulse(snake.id);
			}
		}

		this.previous = previous;
		this.frame = frame;
		this.frameAt = now;
	}

	/** Interrompe as animações em andamento. */
	dispose(): void {
		for (const animation of this.animations) animation.stop();
		this.animations.clear();
	}

	draw(
		ctx: CanvasRenderingContext2D,
		width: number,
		height: number,
		now: number,
	): void {
		const { arena, frame } = this;
		if (!frame) return;

		const dt = now - (this.lastDrawAt || now);
		this.lastDrawAt = now;
		// Quanto do caminho entre o tick anterior e o atual já foi percorrido.
		const t = Math.min(1, Math.max(0, (now - this.frameAt) / arena.tickMs));
		const camera = this.updateCamera(frame, t, dt);

		const size = cellSize(width, height);
		const toScreen = ([x, y]: Cell): Cell => [
			width / 2 + wrapDelta(x - camera.x, arena.width) * size - size / 2,
			height / 2 + wrapDelta(y - camera.y, arena.height) * size - size / 2,
		];
		const visible = ([sx, sy]: Cell) =>
			sx > -size && sx < width && sy > -size && sy < height;
		const gap = Math.max(1, size * 0.08);
		const square = ([sx, sy]: Cell, scale = 1) => {
			const side = (size - gap * 2) * scale;
			ctx.beginPath();
			ctx.roundRect(
				sx + (size - side) / 2,
				sy + (size - side) / 2,
				side,
				side,
				size * 0.25 * scale,
			);
		};

		ctx.fillStyle = BACKGROUND;
		ctx.fillRect(0, 0, width, height);

		// Linhas do grid, deslocadas junto com a câmera.
		ctx.strokeStyle = "#161d33";
		ctx.lineWidth = 1;
		ctx.beginPath();
		const offsetX = (width / 2 - (camera.x % 1) * size - size / 2) % size;
		const offsetY = (height / 2 - (camera.y % 1) * size - size / 2) % size;
		for (let x = offsetX; x < width; x += size) {
			ctx.moveTo(Math.round(x) + 0.5, 0);
			ctx.lineTo(Math.round(x) + 0.5, height);
		}
		for (let y = offsetY; y < height; y += size) {
			ctx.moveTo(0, Math.round(y) + 0.5);
			ctx.lineTo(width, Math.round(y) + 0.5);
		}
		ctx.stroke();

		ctx.fillStyle = "#fbbf24";
		for (const cell of frame.food) {
			const [sx, sy] = toScreen(cell);
			if (!visible([sx, sy])) continue;
			ctx.beginPath();
			ctx.arc(sx + size / 2, sy + size / 2, size * 0.24, 0, Math.PI * 2);
			ctx.fill();
		}

		for (const { snake, progress } of this.burning) {
			// A chama percorre o corpo: o que ficou para trás dela já sumiu.
			const flame = progress * snake.cells.length;
			const index = Math.floor(flame);
			const remaining = 1 - (flame - index);

			ctx.fillStyle = snake.color;
			ctx.globalAlpha = 0.9;
			for (let i = index + 1; i < snake.cells.length; i++) {
				const at = toScreen(snake.cells[i] as Cell);
				if (!visible(at)) continue;
				square(at);
				ctx.fill();
			}
			ctx.globalAlpha = 1;

			const cell = snake.cells[index];
			if (!cell) continue;
			const at = toScreen(cell);
			if (!visible(at)) continue;
			const glow = ctx.createRadialGradient(
				at[0] + size / 2,
				at[1] + size / 2,
				0,
				at[0] + size / 2,
				at[1] + size / 2,
				size * 1.4,
			);
			glow.addColorStop(0, "rgba(255, 237, 213, 0.9)");
			glow.addColorStop(0.35, "rgba(251, 146, 60, 0.45)");
			glow.addColorStop(1, "rgba(251, 146, 60, 0)");
			ctx.fillStyle = glow;
			ctx.fillRect(at[0] - size, at[1] - size, size * 3, size * 3);
			ctx.fillStyle = "#fff7ed";
			square(at, remaining);
			ctx.fill();
		}

		for (const snake of frame.snakes) {
			const head = this.headOf(snake, t);

			ctx.fillStyle = snake.color;
			for (let i = snake.cells.length - 1; i >= 1; i--) {
				const at = toScreen(this.segmentOf(snake, i, t));
				if (!visible(at)) continue;
				square(at);
				ctx.fill();
			}

			const at = toScreen(head);
			if (!visible(at)) continue;
			square(at);
			ctx.fill();
			if (snake.id === this.myId) {
				ctx.strokeStyle = "#ffffff";
				ctx.lineWidth = 2;
				ctx.stroke();
			}
			this.drawEyes(ctx, snake, at, size);

			for (const pulse of this.pulses) {
				if (pulse.snakeId !== snake.id) continue;
				ctx.strokeStyle = snake.color;
				ctx.globalAlpha = 1 - pulse.progress;
				ctx.lineWidth = 2;
				ctx.beginPath();
				ctx.arc(
					at[0] + size / 2,
					at[1] + size / 2,
					size * (0.5 + pulse.progress * 0.9),
					0,
					Math.PI * 2,
				);
				ctx.stroke();
				ctx.globalAlpha = 1;
			}

			ctx.font = "600 12px system-ui, sans-serif";
			ctx.textAlign = "center";
			ctx.fillStyle = "#e2e8f0";
			ctx.fillText(snake.name, at[0] + size / 2, at[1] - 6);
		}

		this.drawMinimap(ctx, width, height, frame);
	}

	/** Posição da cabeça entre o tick anterior e o atual. */
	private headOf(snake: SnakeView, t: number): Cell {
		return this.segmentOf(snake, 0, t);
	}

	/**
	 * Posição de um segmento entre o tick anterior e o atual. Cada segmento
	 * desliza da célula que ocupava para a do segmento à frente, então o corpo
	 * inteiro anda junto. O segmento novo de quem cresceu não tem de onde vir.
	 */
	private segmentOf(snake: SnakeView, index: number, t: number): Cell {
		const cell = snake.cells[index] as Cell;
		const before = this.previous.get(snake.id)?.cells[index];
		return before ? this.between(before, cell, t) : cell;
	}

	/** Interpola entre duas células pelo caminho mais curto, cruzando a borda. */
	private between(from: Cell, to: Cell, t: number): Cell {
		const { width, height } = this.arena;
		const dx = wrapDelta(to[0] - from[0], width);
		const dy = wrapDelta(to[1] - from[1], height);
		// Mais de uma célula de distância não é um passo normal (ex.: renasceu).
		if (Math.abs(dx) + Math.abs(dy) > 1) return to;
		return [
			(from[0] + dx * t + width) % width,
			(from[1] + dy * t + height) % height,
		];
	}

	/** Mantém a câmera na cabeça do jogador; após a eliminação ela fica parada. */
	private updateCamera(frame: Frame, t: number, dt: number) {
		const { width, height } = this.arena;
		const mine = frame.snakes.find((snake) => snake.id === this.myId);
		const target = mine ? this.headOf(mine, t) : null;

		if (!this.camera) {
			const [x, y] = target ?? [width / 2, height / 2];
			this.camera = { x, y };
		}
		if (!target) return this.camera;

		const dx = wrapDelta(target[0] - this.camera.x, width);
		const dy = wrapDelta(target[1] - this.camera.y, height);
		const distance = Math.max(Math.abs(dx), Math.abs(dy));
		if (distance > GLIDE_START_CELLS) this.gliding = true;
		else if (distance < GLIDE_END_CELLS) this.gliding = false;

		const ease = this.gliding ? 1 - Math.exp(-dt / 140) : 1;
		this.camera.x = (this.camera.x + dx * ease + width) % width;
		this.camera.y = (this.camera.y + dy * ease + height) % height;
		return this.camera;
	}

	private drawEyes(
		ctx: CanvasRenderingContext2D,
		snake: SnakeView,
		[sx, sy]: Cell,
		size: number,
	): void {
		const [head, neck] = snake.cells;
		if (!head || !neck) return;
		const dx = Math.sign(wrapDelta(head[0] - neck[0], this.arena.width));
		const dy = Math.sign(wrapDelta(head[1] - neck[1], this.arena.height));
		const cx = sx + size / 2 + dx * size * 0.14;
		const cy = sy + size / 2 + dy * size * 0.14;

		ctx.fillStyle = BACKGROUND;
		for (const side of [-1, 1]) {
			ctx.beginPath();
			// Os olhos ficam lado a lado, perpendiculares à direção do movimento.
			ctx.arc(
				cx - dy * side * size * 0.18,
				cy + dx * side * size * 0.18,
				size * 0.09,
				0,
				Math.PI * 2,
			);
			ctx.fill();
		}
	}

	private drawMinimap(
		ctx: CanvasRenderingContext2D,
		width: number,
		height: number,
		frame: Frame,
	): void {
		const { arena } = this;
		const scale = MINIMAP_SIZE / Math.max(arena.width, arena.height);
		const mapWidth = arena.width * scale;
		const mapHeight = arena.height * scale;
		const left = width - mapWidth - MINIMAP_MARGIN;
		const top = height - mapHeight - MINIMAP_MARGIN;

		ctx.fillStyle = "rgba(15, 23, 42, 0.8)";
		ctx.fillRect(left, top, mapWidth, mapHeight);
		ctx.strokeStyle = "#334155";
		ctx.lineWidth = 1;
		ctx.strokeRect(left + 0.5, top + 0.5, mapWidth, mapHeight);

		const dot = Math.max(2, scale);
		for (const snake of frame.snakes) {
			ctx.fillStyle = snake.color;
			for (const [x, y] of snake.cells) {
				ctx.fillRect(left + x * scale, top + y * scale, dot, dot);
			}
			const head = snake.cells[0];
			if (snake.id === this.myId && head) {
				ctx.strokeStyle = "#ffffff";
				ctx.beginPath();
				ctx.arc(
					left + head[0] * scale,
					top + head[1] * scale,
					5,
					0,
					Math.PI * 2,
				);
				ctx.stroke();
			}
		}
	}

	private burn(snake: SnakeView): void {
		const burning: Burning = { snake, progress: 0 };
		this.burning.add(burning);
		// `easeIn` acelera a chama conforme ela avança pelo corpo.
		this.run(burnSeconds(snake.cells.length), "easeIn", {
			update: (value) => {
				burning.progress = value;
			},
			done: () => this.burning.delete(burning),
		});
	}

	private pulse(snakeId: number): void {
		const pulse: Pulse = { snakeId, progress: 0 };
		this.pulses.add(pulse);
		this.run(0.4, "easeOut", {
			update: (value) => {
				pulse.progress = value;
			},
			done: () => this.pulses.delete(pulse),
		});
	}

	/** Anima um valor de 0 a 1 com o motion e registra a animação para o `dispose`. */
	private run(
		duration: number,
		ease: "easeIn" | "easeOut",
		handlers: { update: (value: number) => void; done: () => void },
	): void {
		const animation: Animation = animate(0, 1, {
			duration,
			ease,
			onUpdate: handlers.update,
			onComplete: () => {
				this.animations.delete(animation);
				handlers.done();
			},
		});
		this.animations.add(animation);
	}
}
