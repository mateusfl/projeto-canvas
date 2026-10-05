import {
	type ClientMessage,
	CloseCode,
	type PlayerIdentity,
	type ServerMessage,
} from "@snake/shared";
import type { ServerWebSocket } from "bun";
import { Hono } from "hono";
import { Arena, type Death } from "./arena.ts";

const PORT = Number(process.env.GAME_API_PORT ?? 3002);
// Só o gateway, na mesma máquina, acessa esta API.
const HOST = process.env.GAME_API_HOST ?? "127.0.0.1";
const PLAYERS_API_URL = process.env.PLAYERS_API_URL ?? "http://127.0.0.1:3001";

const TICK_MS = Number(process.env.TICK_MS ?? 110);
const GRID_WIDTH = Number(process.env.GRID_WIDTH ?? 100);
const GRID_HEIGHT = Number(process.env.GRID_HEIGHT ?? 100);
const FOOD_TARGET = Number(process.env.FOOD_TARGET ?? 180);

type Connection = { arenaId: string; player: PlayerIdentity };
type Socket = ServerWebSocket<Connection>;

type Room = {
	arena: Arena;
	/** Jogadores conectados (vivos ou aguardando para renascer), por id. */
	sockets: Map<number, Socket>;
};

const rooms = new Map<string, Room>();
for (const id of ["1"]) {
	const arena = new Arena(id, {
		width: GRID_WIDTH,
		height: GRID_HEIGHT,
		tickMs: TICK_MS,
		foodTarget: FOOD_TARGET,
	});
	rooms.set(id, { arena, sockets: new Map() });
}

function topic(arenaId: string): string {
	return `arena:${arenaId}`;
}

function send(ws: Socket, message: ServerMessage): void {
	ws.send(JSON.stringify(message));
}

function error(code: string, message: string) {
	return { error: { code, message } };
}

/** Registra o resultado na API de jogadores, que é a dona do banco. */
function reportMatch(arenaId: string, death: Death): void {
	fetch(`${PLAYERS_API_URL}/matches`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			playerId: death.player.id,
			arenaId,
			score: death.score,
			kills: death.kills,
			durationMs: death.durationMs,
		}),
	})
		.then((res) => {
			if (!res.ok) console.error(`Falha ao registrar partida: ${res.status}`);
		})
		.catch((err) => console.error("Falha ao registrar partida:", err));
}

function roomView(room: Room) {
	const snakes = new Map(room.arena.snakeViews().map((s) => [s.id, s]));
	const players = [...room.sockets.values()]
		.map((ws) => {
			const snake = snakes.get(ws.data.player.id);
			return {
				id: ws.data.player.id,
				name: ws.data.player.name,
				color: ws.data.player.color,
				alive: snake !== undefined,
				score: snake?.cells.length ?? 0,
				kills: snake?.kills ?? 0,
			};
		})
		.sort((a, b) => b.score - a.score);
	return { ...room.arena.info, playersOnline: players.length, players };
}

const app = new Hono();

app.get("/arenas", (c) => {
	return c.json({ arenas: [...rooms.values()].map(roomView) });
});

app.get("/arenas/:id", (c) => {
	const room = rooms.get(c.req.param("id"));
	if (!room) {
		return c.json(error("arena_not_found", "Arena não encontrada."), 404);
	}
	return c.json(roomView(room));
});

const PLAY_PATH = /^\/arenas\/([^/]+)\/play$/;

/** O gateway já validou o JWT e repassa a identidade do jogador na query string. */
function identityFrom(url: URL): PlayerIdentity | null {
	const id = Number(url.searchParams.get("playerId"));
	const name = url.searchParams.get("name");
	const color = url.searchParams.get("color");
	const sessionId = url.searchParams.get("sessionId");
	if (!Number.isInteger(id) || id < 1 || !name || !color || !sessionId) {
		return null;
	}
	return { id, name, color, sessionId };
}

const server = Bun.serve({
	hostname: HOST,
	port: PORT,

	fetch(req, server) {
		const url = new URL(req.url);
		const play = PLAY_PATH.exec(url.pathname);
		if (!play) return app.fetch(req);

		const player = identityFrom(url);
		if (!player) {
			return Response.json(error("invalid_identity", "Identidade ausente."), {
				status: 400,
			});
		}
		const data: Connection = { arenaId: play[1] as string, player };
		if (server.upgrade(req, { data })) return;
		return Response.json(
			error("upgrade_required", "Esta rota aceita apenas WebSocket."),
			{ status: 426 },
		);
	},

	websocket: {
		data: {} as Connection,

		open(ws) {
			const { arenaId, player } = ws.data;
			const room = rooms.get(arenaId);
			if (!room) {
				ws.close(CloseCode.ArenaNotFound, "Arena não encontrada.");
				return;
			}

			// O mesmo nome sempre resolve para o mesmo id de jogador, então uma
			// conexão existente com outra sessão significa nome em uso.
			const current = room.sockets.get(player.id);
			if (current && current.data.player.sessionId !== player.sessionId) {
				ws.close(CloseCode.NameInUse, "Nome já em uso nesta arena.");
				return;
			}
			// Mesma sessão (ex.: página recarregada): a conexão nova assume a
			// cobrinha. O registro é trocado antes de fechar a antiga, para o
			// `close` dela não tirar o jogador da arena.
			room.sockets.set(player.id, ws);
			current?.close(CloseCode.Replaced, "Conectado em outra aba.");
			ws.subscribe(topic(arenaId));
			if (!room.arena.isAlive(player.id)) room.arena.spawn(player);
			send(ws, {
				type: "welcome",
				playerId: player.id,
				arena: room.arena.info,
			});
		},

		message(ws, raw) {
			const room = rooms.get(ws.data.arenaId);
			if (!room || room.sockets.get(ws.data.player.id) !== ws) return;

			let message: ClientMessage;
			try {
				message = JSON.parse(String(raw));
			} catch {
				return;
			}

			if (message.type === "dir") {
				if (["up", "down", "left", "right"].includes(message.dir)) {
					room.arena.turn(ws.data.player.id, message.dir);
				}
			} else if (message.type === "respawn") {
				if (!room.arena.isAlive(ws.data.player.id)) {
					room.arena.spawn(ws.data.player);
				}
			}
		},

		close(ws) {
			const { arenaId, player } = ws.data;
			const room = rooms.get(arenaId);
			// Uma conexão recusada ou substituída não é a dona da cobrinha.
			if (!room || room.sockets.get(player.id) !== ws) return;

			room.sockets.delete(player.id);
			const death = room.arena.leave(player.id);
			if (death) reportMatch(arenaId, death);
		},
	},
});

setInterval(() => {
	for (const [arenaId, room] of rooms) {
		if (room.sockets.size === 0) continue;

		for (const death of room.arena.step()) {
			reportMatch(arenaId, death);
			const ws = room.sockets.get(death.player.id);
			if (ws) {
				send(ws, {
					type: "dead",
					score: death.score,
					kills: death.kills,
					killedBy: death.killedBy,
				});
			}
		}

		const state: ServerMessage = {
			type: "state",
			tick: room.arena.tick,
			snakes: room.arena.snakeViews(),
			food: room.arena.foodCells(),
		};
		server.publish(topic(arenaId), JSON.stringify(state));
	}
}, TICK_MS);

console.log(`API de jogo em http://${server.hostname}:${server.port}`);
