import { Database } from "bun:sqlite";
import { nameKey } from "@snake/shared";

const path = process.env.PLAYERS_DB ?? `${import.meta.dir}/../players.sqlite`;

const db = new Database(path, { create: true, strict: true });
db.run("PRAGMA journal_mode = WAL;");
db.run("PRAGMA foreign_keys = ON;");
db.run(`
	CREATE TABLE IF NOT EXISTS players (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL,
		name_key TEXT NOT NULL UNIQUE,
		color TEXT NOT NULL,
		created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
	);
`);
db.run(`
	CREATE TABLE IF NOT EXISTS matches (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		player_id INTEGER NOT NULL REFERENCES players(id),
		arena_id TEXT NOT NULL,
		score INTEGER NOT NULL,
		kills INTEGER NOT NULL,
		duration_ms INTEGER NOT NULL,
		ended_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
	);
`);
db.run(
	"CREATE INDEX IF NOT EXISTS matches_player ON matches(player_id, ended_at);",
);

export type Player = {
	id: number;
	name: string;
	color: string;
	createdAt: string;
};

export type PlayerStats = {
	matches: number;
	bestScore: number;
	totalKills: number;
};

export type Match = {
	id: number;
	playerId: number;
	arenaId: string;
	score: number;
	kills: number;
	durationMs: number;
	endedAt: string;
};

export type LeaderboardEntry = {
	playerId: number;
	name: string;
	color: string;
	bestScore: number;
	totalKills: number;
	matches: number;
};

const PLAYER_COLUMNS = "id, name, color, created_at AS createdAt";
const MATCH_COLUMNS =
	"id, player_id AS playerId, arena_id AS arenaId, score, kills, duration_ms AS durationMs, ended_at AS endedAt";

const selectPlayerById = db.query<Player, { id: number }>(
	`SELECT ${PLAYER_COLUMNS} FROM players WHERE id = $id`,
);
const upsertPlayer = db.query<
	Player,
	{ name: string; key: string; color: string }
>(
	`INSERT INTO players (name, name_key, color) VALUES ($name, $key, $color)
	 ON CONFLICT (name_key) DO UPDATE SET name = excluded.name, color = excluded.color
	 RETURNING ${PLAYER_COLUMNS}`,
);
const selectStats = db.query<PlayerStats, { id: number }>(
	`SELECT COUNT(*) AS matches,
	        COALESCE(MAX(score), 0) AS bestScore,
	        COALESCE(SUM(kills), 0) AS totalKills
	 FROM matches WHERE player_id = $id`,
);
const insertMatch = db.query<
	Match,
	{
		playerId: number;
		arenaId: string;
		score: number;
		kills: number;
		durationMs: number;
	}
>(
	`INSERT INTO matches (player_id, arena_id, score, kills, duration_ms)
	 VALUES ($playerId, $arenaId, $score, $kills, $durationMs)
	 RETURNING ${MATCH_COLUMNS}`,
);
const selectMatches = db.query<Match, { id: number; limit: number }>(
	`SELECT ${MATCH_COLUMNS} FROM matches
	 WHERE player_id = $id ORDER BY ended_at DESC, id DESC LIMIT $limit`,
);
const selectLeaderboard = db.query<LeaderboardEntry, { limit: number }>(
	`SELECT p.id AS playerId, p.name, p.color,
	        MAX(m.score) AS bestScore,
	        SUM(m.kills) AS totalKills,
	        COUNT(*) AS matches
	 FROM matches m JOIN players p ON p.id = m.player_id
	 GROUP BY p.id
	 ORDER BY bestScore DESC, totalKills DESC, p.id ASC
	 LIMIT $limit`,
);

/** Como não há senha, o mesmo nome sempre resolve para o mesmo jogador. */
export function findOrCreatePlayer(name: string, color: string): Player {
	const player = upsertPlayer.get({ name, key: nameKey(name), color });
	if (!player) throw new Error("upsert de jogador não retornou linha");
	return player;
}

export function getPlayer(id: number): Player | null {
	return selectPlayerById.get({ id });
}

export function getStats(id: number): PlayerStats {
	return selectStats.get({ id }) ?? { matches: 0, bestScore: 0, totalKills: 0 };
}

export function addMatch(match: Omit<Match, "id" | "endedAt">): Match {
	const row = insertMatch.get(match);
	if (!row) throw new Error("insert de partida não retornou linha");
	return row;
}

export function listMatches(playerId: number, limit: number): Match[] {
	return selectMatches.all({ id: playerId, limit });
}

export function leaderboard(limit: number): LeaderboardEntry[] {
	return selectLeaderboard.all({ limit });
}
