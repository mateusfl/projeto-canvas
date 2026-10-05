export const PORT = Number(process.env.GATEWAY_PORT ?? 3000);
// O gateway é a única peça do backend exposta na rede.
export const HOST = process.env.GATEWAY_HOST ?? "0.0.0.0";
export const JWT_SECRET =
	process.env.JWT_SECRET ?? "dev-secret-troque-em-producao";
export const PLAYERS_API_URL =
	process.env.PLAYERS_API_URL ?? "http://127.0.0.1:3001";
export const GAME_API_URL = process.env.GAME_API_URL ?? "http://127.0.0.1:3002";
export const DEFAULT_ARENA_ID = "1";
