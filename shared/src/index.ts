export type Direction = "up" | "down" | "left" | "right";

export type Cell = [x: number, y: number];

/** Identidade do jogador carregada no JWT e repassada pelo gateway às APIs. */
export type PlayerIdentity = {
	id: number;
	name: string;
	color: string;
	/** Identifica a sessão (um login), para diferenciar reconexão de nome duplicado. */
	sessionId: string;
};

export type ArenaInfo = {
	id: string;
	width: number;
	height: number;
	tickMs: number;
};

export type SnakeView = {
	id: number;
	name: string;
	color: string;
	/** Células da cobrinha, da cabeça para a cauda. */
	cells: Cell[];
	kills: number;
};

export type ClientMessage =
	| { type: "dir"; dir: Direction }
	| { type: "respawn" };

export type ServerMessage =
	| { type: "welcome"; playerId: number; arena: ArenaInfo }
	| { type: "state"; tick: number; snakes: SnakeView[]; food: Cell[] }
	| { type: "dead"; score: number; kills: number; killedBy: string | null };

/** Códigos de fechamento do WebSocket usados pela API de jogo. */
export const CloseCode = {
	Replaced: 4000,
	Unauthorized: 4401,
	ArenaNotFound: 4404,
	NameInUse: 4409,
} as const;

export const NAME_MIN_LENGTH = 2;
export const NAME_MAX_LENGTH = 16;

/** Forma canônica do nome, usada para comparar nomes sem diferenciar maiúsculas. */
export function nameKey(name: string): string {
	return name.trim().normalize("NFKC").toLowerCase();
}
