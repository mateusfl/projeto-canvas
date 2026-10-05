import type {
	ArenaInfo,
	Cell,
	Direction,
	PlayerIdentity,
	SnakeView,
} from "@snake/shared";

const DELTAS: Record<Direction, Cell> = {
	up: [0, -1],
	down: [0, 1],
	left: [-1, 0],
	right: [1, 0],
};

const OPPOSITE: Record<Direction, Direction> = {
	up: "down",
	down: "up",
	left: "right",
	right: "left",
};

const INITIAL_LENGTH = 3;
const MAX_QUEUED_TURNS = 2;
const SPAWN_ATTEMPTS = 50;
/** Células livres exigidas à frente da cabeça ao nascer. */
const SPAWN_CLEARANCE = 6;

export type ArenaOptions = {
	width: number;
	height: number;
	tickMs: number;
	/** Quantidade de comida que a arena tenta manter no grid. */
	foodTarget: number;
	random?: () => number;
};

type Snake = {
	player: PlayerIdentity;
	/** Da cabeça para a cauda. */
	cells: Cell[];
	dir: Direction;
	/** Viradas pedidas pelo cliente e ainda não aplicadas. */
	turns: Direction[];
	kills: number;
	spawnedAt: number;
};

export type Death = {
	player: PlayerIdentity;
	score: number;
	kills: number;
	/** Nome de quem eliminou; `null` se bateu em si mesmo ou saiu da partida. */
	killedBy: string | null;
	durationMs: number;
};

export class Arena {
	readonly id: string;
	readonly width: number;
	readonly height: number;
	readonly tickMs: number;
	readonly foodTarget: number;
	tick = 0;

	private readonly random: () => number;
	private readonly snakes = new Map<number, Snake>();
	/** Comidas indexadas pela chave da célula (`y * width + x`). */
	private readonly food = new Set<number>();

	constructor(id: string, options: ArenaOptions) {
		this.id = id;
		this.width = options.width;
		this.height = options.height;
		this.tickMs = options.tickMs;
		this.foodTarget = options.foodTarget;
		this.random = options.random ?? Math.random;
		this.refillFood();
	}

	get info(): ArenaInfo {
		return {
			id: this.id,
			width: this.width,
			height: this.height,
			tickMs: this.tickMs,
		};
	}

	isAlive(playerId: number): boolean {
		return this.snakes.has(playerId);
	}

	/** Coloca a cobrinha do jogador na arena, longe do centro. */
	spawn(player: PlayerIdentity, now = Date.now()): void {
		const occupied = this.occupiedCells();
		let candidate = this.randomSpawn();
		for (let i = 0; i < SPAWN_ATTEMPTS; i++) {
			if (this.hasRoom(candidate, occupied)) break;
			candidate = this.randomSpawn();
		}
		this.place(player, candidate.cells, candidate.dir, now);
	}

	/** Posiciona uma cobrinha em células específicas (usado no spawn e nos testes). */
	place(
		player: PlayerIdentity,
		cells: Cell[],
		dir: Direction,
		now = Date.now(),
	): void {
		for (const cell of cells) this.food.delete(this.key(cell));
		this.snakes.set(player.id, {
			player,
			cells,
			dir,
			turns: [],
			kills: 0,
			spawnedAt: now,
		});
	}

	/** Enfileira uma virada; ignora a que faria a cobrinha voltar sobre si mesma. */
	turn(playerId: number, dir: Direction): void {
		const snake = this.snakes.get(playerId);
		if (!snake || snake.turns.length >= MAX_QUEUED_TURNS) return;
		const previous = snake.turns.at(-1) ?? snake.dir;
		if (dir === previous || dir === OPPOSITE[previous]) return;
		snake.turns.push(dir);
	}

	/** Remove o jogador que saiu da partida; a cobrinha dele vira comida. */
	leave(playerId: number, now = Date.now()): Death | null {
		const snake = this.snakes.get(playerId);
		if (!snake) return null;
		this.snakes.delete(playerId);
		this.dropFood(snake, this.occupiedCells());
		return this.toDeath(snake, null, now);
	}

	/** Avança um tick: move todas as cobrinhas e resolve comida e colisões. */
	step(now = Date.now()): Death[] {
		this.tick++;

		for (const snake of this.snakes.values()) {
			snake.dir = snake.turns.shift() ?? snake.dir;
			const head = this.wrap(snake.cells[0] as Cell, DELTAS[snake.dir]);
			snake.cells.unshift(head);
			// Só cresce quando come; caso contrário a cauda acompanha o movimento.
			if (!this.food.delete(this.key(head))) snake.cells.pop();
		}

		// Uma cabeça em célula ocupada por qualquer outra parte de cobrinha é fatal.
		const owners = new Map<number, Snake[]>();
		for (const snake of this.snakes.values()) {
			for (const cell of snake.cells) {
				const key = this.key(cell);
				const list = owners.get(key);
				if (list) list.push(snake);
				else owners.set(key, [snake]);
			}
		}

		const dead = new Map<Snake, Snake | null>();
		for (const snake of this.snakes.values()) {
			const atHead = owners.get(this.key(snake.cells[0] as Cell)) ?? [];
			if (atHead.length < 2) continue;
			dead.set(snake, atHead.find((other) => other !== snake) ?? null);
		}

		for (const killer of dead.values()) {
			if (killer) killer.kills++;
		}
		for (const snake of dead.keys()) this.snakes.delete(snake.player.id);

		const occupied = this.occupiedCells();
		const deaths: Death[] = [];
		for (const [snake, killer] of dead) {
			this.dropFood(snake, occupied);
			deaths.push(this.toDeath(snake, killer?.player.name ?? null, now));
		}

		this.refillFood();
		return deaths;
	}

	snakeViews(): SnakeView[] {
		return [...this.snakes.values()].map((snake) => ({
			id: snake.player.id,
			name: snake.player.name,
			color: snake.player.color,
			cells: snake.cells,
			kills: snake.kills,
		}));
	}

	foodCells(): Cell[] {
		return [...this.food].map((key) => [
			key % this.width,
			Math.floor(key / this.width),
		]);
	}

	private key([x, y]: Cell): number {
		return y * this.width + x;
	}

	/** A arena não tem parede: quem sai por um lado reaparece no oposto. */
	private wrap([x, y]: Cell, [dx, dy]: Cell): Cell {
		return [
			(x + dx + this.width) % this.width,
			(y + dy + this.height) % this.height,
		];
	}

	private occupiedCells(): Set<number> {
		const occupied = new Set<number>();
		for (const snake of this.snakes.values()) {
			for (const cell of snake.cells) occupied.add(this.key(cell));
		}
		return occupied;
	}

	/** Sorteia uma posição na metade externa da arena, apontando para o centro. */
	private randomSpawn(): { cells: Cell[]; dir: Direction } {
		const cx = this.width / 2;
		const cy = this.height / 2;
		let x = 0;
		let y = 0;
		do {
			x = Math.floor(this.random() * this.width);
			y = Math.floor(this.random() * this.height);
		} while (Math.abs(x - cx) / cx < 0.5 && Math.abs(y - cy) / cy < 0.5);

		const horizontal = Math.abs(x - cx) / cx >= Math.abs(y - cy) / cy;
		let dir: Direction;
		if (horizontal) dir = x < cx ? "right" : "left";
		else dir = y < cy ? "down" : "up";

		const back = DELTAS[OPPOSITE[dir]];
		const cells: Cell[] = [[x, y]];
		while (cells.length < INITIAL_LENGTH) {
			cells.push(this.wrap(cells.at(-1) as Cell, back));
		}
		return { cells, dir };
	}

	private hasRoom(
		spawn: { cells: Cell[]; dir: Direction },
		occupied: Set<number>,
	): boolean {
		if (spawn.cells.some((cell) => occupied.has(this.key(cell)))) return false;
		let ahead = spawn.cells[0] as Cell;
		for (let i = 0; i < SPAWN_CLEARANCE; i++) {
			ahead = this.wrap(ahead, DELTAS[spawn.dir]);
			if (occupied.has(this.key(ahead))) return false;
		}
		return true;
	}

	/** Deixa comida em metade das células da cobrinha eliminada. */
	private dropFood(snake: Snake, occupied: Set<number>): void {
		snake.cells.forEach((cell, index) => {
			const key = this.key(cell);
			if (index % 2 === 0 && !occupied.has(key)) this.food.add(key);
		});
	}

	private refillFood(): void {
		const occupied = this.occupiedCells();
		const total = this.width * this.height;
		// Limita as tentativas para não travar o tick com a arena cheia.
		let attempts = this.foodTarget * 2;
		while (this.food.size < this.foodTarget && attempts-- > 0) {
			const key = Math.floor(this.random() * total);
			if (!occupied.has(key)) this.food.add(key);
		}
	}

	private toDeath(snake: Snake, killedBy: string | null, now: number): Death {
		return {
			player: snake.player,
			score: snake.cells.length,
			kills: snake.kills,
			killedBy,
			durationMs: Math.max(0, now - snake.spawnedAt),
		};
	}
}
