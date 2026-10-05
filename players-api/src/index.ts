import {
	NAME_MAX_LENGTH,
	NAME_MIN_LENGTH,
	type PlayerIdentity,
} from "@snake/shared";
import { Hono } from "hono";
import { sign } from "hono/jwt";
import { z } from "zod";
import {
	addMatch,
	findOrCreatePlayer,
	getPlayer,
	getStats,
	leaderboard,
	listMatches,
} from "./db.ts";

const PORT = Number(process.env.PLAYERS_API_PORT ?? 3001);
// Só o gateway e a API de jogo, na mesma máquina, acessam esta API.
const HOST = process.env.PLAYERS_API_HOST ?? "127.0.0.1";
const JWT_SECRET = process.env.JWT_SECRET ?? "dev-secret-troque-em-producao";
const TOKEN_TTL_SECONDS = 60 * 60 * 12;

const COLORS = [
	"#ef4444",
	"#f97316",
	"#eab308",
	"#84cc16",
	"#22c55e",
	"#14b8a6",
	"#06b6d4",
	"#3b82f6",
	"#6366f1",
	"#a855f7",
	"#ec4899",
	"#f43f5e",
];

const sessionBody = z.object({
	name: z.string().trim().min(NAME_MIN_LENGTH).max(NAME_MAX_LENGTH),
});

const matchBody = z.object({
	playerId: z.number().int().positive(),
	arenaId: z.string().min(1),
	score: z.number().int().nonnegative(),
	kills: z.number().int().nonnegative(),
	durationMs: z.number().int().nonnegative(),
});

function error(code: string, message: string) {
	return { error: { code, message } };
}

function parseLimit(raw: string | undefined, fallback: number): number {
	const limit = Number(raw ?? fallback);
	if (!Number.isInteger(limit) || limit < 1) return fallback;
	return Math.min(limit, 100);
}

const app = new Hono();

app.post("/sessions", async (c) => {
	const body = sessionBody.safeParse(await c.req.json().catch(() => null));
	if (!body.success) {
		return c.json(
			error(
				"invalid_name",
				`O nome deve ter de ${NAME_MIN_LENGTH} a ${NAME_MAX_LENGTH} caracteres.`,
			),
			400,
		);
	}

	const color = COLORS[Math.floor(Math.random() * COLORS.length)] ?? "#22c55e";
	const player = findOrCreatePlayer(body.data.name, color);
	const identity: PlayerIdentity = {
		id: player.id,
		name: player.name,
		color: player.color,
		sessionId: crypto.randomUUID(),
	};
	const now = Math.floor(Date.now() / 1000);
	const token = await sign(
		{
			sub: String(identity.id),
			name: identity.name,
			color: identity.color,
			sid: identity.sessionId,
			iat: now,
			exp: now + TOKEN_TTL_SECONDS,
		},
		JWT_SECRET,
		"HS256",
	);

	return c.json({ token, expiresIn: TOKEN_TTL_SECONDS, player }, 201);
});

app.get("/players/:id", (c) => {
	const player = getPlayer(Number(c.req.param("id")));
	if (!player) {
		return c.json(error("player_not_found", "Jogador não encontrado."), 404);
	}
	return c.json({ ...player, stats: getStats(player.id) });
});

app.get("/players/:id/matches", (c) => {
	const player = getPlayer(Number(c.req.param("id")));
	if (!player) {
		return c.json(error("player_not_found", "Jogador não encontrado."), 404);
	}
	const limit = parseLimit(c.req.query("limit"), 20);
	return c.json({ matches: listMatches(player.id, limit) });
});

// Chamada apenas pela API de jogo; o gateway não expõe esta rota.
app.post("/matches", async (c) => {
	const body = matchBody.safeParse(await c.req.json().catch(() => null));
	if (!body.success) {
		return c.json(error("invalid_match", "Partida inválida."), 400);
	}
	if (!getPlayer(body.data.playerId)) {
		return c.json(error("player_not_found", "Jogador não encontrado."), 404);
	}
	return c.json(addMatch(body.data), 201);
});

app.get("/leaderboard", (c) => {
	const limit = parseLimit(c.req.query("limit"), 10);
	return c.json({ entries: leaderboard(limit) });
});

const server = Bun.serve({ hostname: HOST, port: PORT, fetch: app.fetch });

console.log(`API de jogadores em http://${server.hostname}:${server.port}`);
