import { swaggerUI } from "@hono/swagger-ui";
import { createRoute, OpenAPIHono, type z } from "@hono/zod-openapi";
import { nameKey } from "@snake/shared";
import type { Context } from "hono";
import { cors } from "hono/cors";
import { type Env, requireAuth } from "./auth.ts";
import { DEFAULT_ARENA_ID, GAME_API_URL, PLAYERS_API_URL } from "./config.ts";
import { ApiError, upstream } from "./http.ts";
import {
	ArenaListSchema,
	ArenaSchema,
	ErrorSchema,
	IdParamSchema,
	LeaderboardSchema,
	LimitQuerySchema,
	MatchListSchema,
	PlayerSchema,
	RootSchema,
	SessionBodySchema,
	SessionSchema,
} from "./schemas.ts";

// Respostas das APIs internas: os recursos do gateway sem os links.
type WithoutLinks<T> = T extends (infer Item)[]
	? WithoutLinks<Item>[]
	: T extends object
		? { [K in keyof T as K extends "_links" ? never : K]: WithoutLinks<T[K]> }
		: T;

type UpstreamArena = WithoutLinks<z.infer<typeof ArenaSchema>>;
type UpstreamPlayer = WithoutLinks<z.infer<typeof PlayerSchema>>;
type UpstreamMatches = WithoutLinks<z.infer<typeof MatchListSchema>>;
type UpstreamSession = Omit<
	WithoutLinks<z.infer<typeof SessionSchema>>,
	"tokenType"
>;
type UpstreamLeaderboard = {
	entries: Omit<
		WithoutLinks<z.infer<typeof LeaderboardSchema>>["entries"][number],
		"rank"
	>[];
};

/**
 * Monta os links HATEOAS a partir do endereço pelo qual o cliente chegou ao
 * gateway, para que funcionem de qualquer máquina da rede.
 */
function linksFor(c: Context) {
	const origin = new URL(c.req.url).origin;
	const get = (path: string) => ({ href: `${origin}${path}`, method: "GET" });
	return {
		root: () => get("/"),
		docs: () => get("/docs"),
		sessions: () => ({ href: `${origin}/sessions`, method: "POST" }),
		leaderboard: () => get("/leaderboard"),
		arenas: () => get("/arenas"),
		arena: (id: string) => get(`/arenas/${encodeURIComponent(id)}`),
		player: (id: number) => get(`/players/${id}`),
		matches: (id: number) => get(`/players/${id}/matches`),
		/** WebSocket da partida; o cliente preenche `token` com o JWT. */
		play: (id: string) => ({
			href: `${origin.replace(/^http/, "ws")}/arenas/${encodeURIComponent(id)}/play{?token}`,
			templated: true,
		}),
	};
}

function withArenaLinks(c: Context, arena: UpstreamArena) {
	const links = linksFor(c);
	return {
		...arena,
		players: arena.players.map((player) => ({
			...player,
			_links: { player: links.player(player.id) },
		})),
		_links: {
			self: links.arena(arena.id),
			play: links.play(arena.id),
			leaderboard: links.leaderboard(),
			arenas: links.arenas(),
		},
	};
}

const json = <T>(schema: T, description: string) => ({
	content: { "application/json": { schema } },
	description,
});

const errorResponse = (description: string) => json(ErrorSchema, description);

const security = [{ bearerAuth: [] }];
const unauthorized = {
	401: errorResponse("Token ausente, inválido ou expirado."),
};

export const app = new OpenAPIHono<Env>({
	defaultHook: (result, c) => {
		if (result.success) return;
		const issue = result.error.issues[0];
		const field = issue?.path.join(".") || "requisição";
		return c.json(
			{
				error: {
					code: "validation_error",
					message: `${field}: ${issue?.message ?? "valor inválido"}`,
				},
			},
			400,
		);
	},
});

app.use("*", cors());

app.onError((err, c) => {
	if (err instanceof ApiError) {
		return c.json(
			{ error: { code: err.code, message: err.message } },
			err.status,
		);
	}
	console.error(err);
	return c.json(
		{ error: { code: "internal_error", message: "Erro interno no gateway." } },
		500,
	);
});

app.notFound((c) => {
	return c.json(
		{ error: { code: "not_found", message: "Rota não encontrada." } },
		404,
	);
});

app.openapi(
	createRoute({
		method: "get",
		path: "/",
		tags: ["Entrada"],
		summary: "Ponto de entrada da API",
		description:
			"Lista os links iniciais. A partir daqui o cliente navega seguindo `_links`.",
		responses: { 200: json(RootSchema, "Links iniciais.") },
	}),
	(c) => {
		const links = linksFor(c);
		return c.json(
			{
				name: "Snake Arena Gateway",
				_links: {
					self: links.root(),
					sessions: links.sessions(),
					arenas: links.arenas(),
					leaderboard: links.leaderboard(),
					docs: links.docs(),
				},
			},
			200,
		);
	},
);

app.openapi(
	createRoute({
		method: "post",
		path: "/sessions",
		tags: ["Sessão"],
		summary: "Entra no jogo com um nome e recebe o JWT",
		description:
			"O nome precisa ser único entre os jogadores conectados à arena. Não há senha: o mesmo nome em outra sessão é o mesmo jogador no ranking.",
		request: {
			body: {
				required: true,
				content: { "application/json": { schema: SessionBodySchema } },
			},
		},
		responses: {
			201: json(SessionSchema, "Sessão criada."),
			400: errorResponse("Nome inválido."),
			404: errorResponse("Arena não encontrada."),
			409: errorResponse("Já existe um jogador com esse nome na arena."),
		},
	}),
	async (c) => {
		const { name, arenaId = DEFAULT_ARENA_ID } = c.req.valid("json");

		const arena = await upstream<UpstreamArena>(
			GAME_API_URL,
			`/arenas/${encodeURIComponent(arenaId)}`,
		);
		if (arena.players.some((p) => nameKey(p.name) === nameKey(name))) {
			throw new ApiError(
				409,
				"name_in_use",
				"Já existe um jogador com esse nome na arena.",
			);
		}

		const session = await upstream<UpstreamSession>(
			PLAYERS_API_URL,
			"/sessions",
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name }),
			},
		);

		const links = linksFor(c);
		return c.json(
			{
				...session,
				tokenType: "Bearer" as const,
				_links: {
					player: links.player(session.player.id),
					arena: links.arena(arena.id),
					play: links.play(arena.id),
					leaderboard: links.leaderboard(),
				},
			},
			201,
		);
	},
);

app.openapi(
	createRoute({
		method: "get",
		path: "/players/{id}",
		tags: ["Jogadores"],
		summary: "Dados e estatísticas de um jogador",
		security,
		middleware: [requireAuth] as const,
		request: { params: IdParamSchema },
		responses: {
			200: json(PlayerSchema, "Jogador."),
			404: errorResponse("Jogador não encontrado."),
			...unauthorized,
		},
	}),
	async (c) => {
		const { id } = c.req.valid("param");
		const player = await upstream<UpstreamPlayer>(
			PLAYERS_API_URL,
			`/players/${encodeURIComponent(id)}`,
		);
		const links = linksFor(c);
		return c.json(
			{
				...player,
				_links: {
					self: links.player(player.id),
					matches: links.matches(player.id),
					leaderboard: links.leaderboard(),
				},
			},
			200,
		);
	},
);

app.openapi(
	createRoute({
		method: "get",
		path: "/players/{id}/matches",
		tags: ["Jogadores"],
		summary: "Partidas mais recentes de um jogador",
		security,
		middleware: [requireAuth] as const,
		request: { params: IdParamSchema, query: LimitQuerySchema },
		responses: {
			200: json(
				MatchListSchema,
				"Partidas, da mais recente para a mais antiga.",
			),
			404: errorResponse("Jogador não encontrado."),
			...unauthorized,
		},
	}),
	async (c) => {
		const { id } = c.req.valid("param");
		const { limit = 20 } = c.req.valid("query");
		const { matches } = await upstream<UpstreamMatches>(
			PLAYERS_API_URL,
			`/players/${encodeURIComponent(id)}/matches?limit=${limit}`,
		);
		const links = linksFor(c);
		return c.json(
			{
				matches: matches.map((match) => ({
					...match,
					_links: { arena: links.arena(match.arenaId) },
				})),
				_links: {
					self: links.matches(Number(id)),
					player: links.player(Number(id)),
				},
			},
			200,
		);
	},
);

app.openapi(
	createRoute({
		method: "get",
		path: "/leaderboard",
		tags: ["Ranking"],
		summary: "Ranking pelo maior tamanho já alcançado",
		security,
		middleware: [requireAuth] as const,
		request: { query: LimitQuerySchema },
		responses: { 200: json(LeaderboardSchema, "Ranking."), ...unauthorized },
	}),
	async (c) => {
		const { limit = 10 } = c.req.valid("query");
		const { entries } = await upstream<UpstreamLeaderboard>(
			PLAYERS_API_URL,
			`/leaderboard?limit=${limit}`,
		);
		const links = linksFor(c);
		return c.json(
			{
				entries: entries.map((entry, index) => ({
					rank: index + 1,
					...entry,
					_links: { player: links.player(entry.playerId) },
				})),
				_links: { self: links.leaderboard(), arenas: links.arenas() },
			},
			200,
		);
	},
);

app.openapi(
	createRoute({
		method: "get",
		path: "/arenas",
		tags: ["Arenas"],
		summary: "Arenas disponíveis",
		security,
		middleware: [requireAuth] as const,
		responses: { 200: json(ArenaListSchema, "Arenas."), ...unauthorized },
	}),
	async (c) => {
		const { arenas } = await upstream<{ arenas: UpstreamArena[] }>(
			GAME_API_URL,
			"/arenas",
		);
		return c.json(
			{
				arenas: arenas.map((arena) => withArenaLinks(c, arena)),
				_links: { self: linksFor(c).arenas() },
			},
			200,
		);
	},
);

app.openapi(
	createRoute({
		method: "get",
		path: "/arenas/{id}",
		tags: ["Arenas"],
		summary: "Estado de uma arena e quem está jogando",
		description:
			"O link `play` é o WebSocket da partida: `ws://.../arenas/{id}/play?token=<jwt>`. O cliente envia `{type:'dir'}` e `{type:'respawn'}` e recebe o estado da arena a cada tick.",
		security,
		middleware: [requireAuth] as const,
		request: { params: IdParamSchema },
		responses: {
			200: json(ArenaSchema, "Arena."),
			404: errorResponse("Arena não encontrada."),
			...unauthorized,
		},
	}),
	async (c) => {
		const { id } = c.req.valid("param");
		const arena = await upstream<UpstreamArena>(
			GAME_API_URL,
			`/arenas/${encodeURIComponent(id)}`,
		);
		return c.json(withArenaLinks(c, arena), 200);
	},
);

app.openAPIRegistry.registerComponent("securitySchemes", "bearerAuth", {
	type: "http",
	scheme: "bearer",
	bearerFormat: "JWT",
	description: "Token devolvido por `POST /sessions`.",
});

app.doc("/openapi.json", {
	openapi: "3.0.0",
	info: {
		title: "Snake Arena Gateway",
		version: "1.0.0",
		description:
			"Gateway do jogo da cobrinha multiplayer. Autentica com JWT, roteia para a API de jogadores e a API de jogo e devolve links HATEOAS (`_links`) em todas as respostas.",
	},
});

app.get("/docs", swaggerUI({ url: "/openapi.json" }));
