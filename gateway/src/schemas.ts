import { z } from "@hono/zod-openapi";
import { NAME_MAX_LENGTH, NAME_MIN_LENGTH } from "@snake/shared";

export const LinkSchema = z
	.object({
		href: z.string().openapi({ example: "http://localhost:3000/arenas/1" }),
		method: z.string().optional().openapi({ example: "GET" }),
		templated: z.boolean().optional(),
	})
	.openapi("Link");

/** Links HATEOAS: relação -> link, sempre apontando para URLs do gateway. */
export const LinksSchema = z.record(z.string(), LinkSchema).openapi("Links");

export const ErrorSchema = z
	.object({
		error: z.object({
			code: z.string().openapi({ example: "name_in_use" }),
			message: z.string(),
		}),
	})
	.openapi("Error");

export const RootSchema = z
	.object({ name: z.string(), _links: LinksSchema })
	.openapi("Root");

export const SessionBodySchema = z
	.object({
		name: z
			.string()
			.trim()
			.min(NAME_MIN_LENGTH, `mínimo de ${NAME_MIN_LENGTH} caracteres`)
			.max(NAME_MAX_LENGTH, `máximo de ${NAME_MAX_LENGTH} caracteres`)
			.openapi({ example: "mateus" }),
		arenaId: z.string().min(1).optional().openapi({ example: "1" }),
	})
	.openapi("SessionBody");

const PlayerBase = z.object({
	id: z.number().int(),
	name: z.string(),
	color: z.string().openapi({ example: "#22c55e" }),
	createdAt: z.string(),
});

export const SessionSchema = z
	.object({
		token: z.string(),
		tokenType: z.literal("Bearer"),
		expiresIn: z.number().int().openapi({ description: "Em segundos." }),
		player: PlayerBase,
		_links: LinksSchema,
	})
	.openapi("Session");

export const PlayerSchema = PlayerBase.extend({
	stats: z.object({
		matches: z.number().int(),
		bestScore: z.number().int(),
		totalKills: z.number().int(),
	}),
	_links: LinksSchema,
}).openapi("Player");

export const MatchSchema = z
	.object({
		id: z.number().int(),
		playerId: z.number().int(),
		arenaId: z.string(),
		score: z.number().int(),
		kills: z.number().int(),
		durationMs: z.number().int(),
		endedAt: z.string(),
		_links: LinksSchema,
	})
	.openapi("Match");

export const MatchListSchema = z
	.object({ matches: z.array(MatchSchema), _links: LinksSchema })
	.openapi("MatchList");

export const LeaderboardSchema = z
	.object({
		entries: z.array(
			z.object({
				rank: z.number().int(),
				playerId: z.number().int(),
				name: z.string(),
				color: z.string(),
				bestScore: z.number().int(),
				totalKills: z.number().int(),
				matches: z.number().int(),
				_links: LinksSchema,
			}),
		),
		_links: LinksSchema,
	})
	.openapi("Leaderboard");

export const ArenaSchema = z
	.object({
		id: z.string(),
		width: z.number().int(),
		height: z.number().int(),
		tickMs: z.number().int(),
		playersOnline: z.number().int(),
		players: z.array(
			z.object({
				id: z.number().int(),
				name: z.string(),
				color: z.string(),
				alive: z.boolean(),
				score: z.number().int(),
				kills: z.number().int(),
				_links: LinksSchema,
			}),
		),
		_links: LinksSchema,
	})
	.openapi("Arena");

export const ArenaListSchema = z
	.object({ arenas: z.array(ArenaSchema), _links: LinksSchema })
	.openapi("ArenaList");

export const IdParamSchema = z.object({
	id: z.string().openapi({ param: { name: "id", in: "path" }, example: "1" }),
});

export const LimitQuerySchema = z.object({
	limit: z.coerce
		.number()
		.int()
		.min(1)
		.max(100)
		.optional()
		.openapi({ param: { name: "limit", in: "query" }, example: 10 }),
});
