import { CloseCode, type PlayerIdentity } from "@snake/shared";
import { app } from "./app.ts";
import { verifyToken } from "./auth.ts";
import { GAME_API_URL, HOST, PORT } from "./config.ts";

type ProxyData = {
	arenaId: string;
	/** `null` quando o token da query string é inválido. */
	player: PlayerIdentity | null;
	upstream?: WebSocket;
	/** Mensagens do cliente recebidas antes de a API de jogo aceitar a conexão. */
	pending: string[];
};

const PLAY_PATH = /^\/arenas\/([^/]+)\/play$/;
const GAME_WS_URL = GAME_API_URL.replace(/^http/, "ws");

/** Códigos reservados não podem ser enviados em um frame de fechamento. */
function closeCode(code: number): number {
	return code === 1000 || (code >= 3000 && code <= 4999) ? code : 1011;
}

const server = Bun.serve({
	hostname: HOST,
	port: PORT,

	async fetch(req, server) {
		const url = new URL(req.url);
		const play = PLAY_PATH.exec(url.pathname);
		if (!play || req.headers.get("upgrade")?.toLowerCase() !== "websocket") {
			return app.fetch(req);
		}

		// O navegador não envia `Authorization` em WebSocket, então o JWT vem na
		// query string. Com token inválido a conexão é aceita e logo fechada com
		// um código que o cliente consegue ler.
		const token = url.searchParams.get("token") ?? "";
		const player = await verifyToken(token).catch(() => null);
		const data: ProxyData = {
			arenaId: decodeURIComponent(play[1] as string),
			player,
			pending: [],
		};
		if (server.upgrade(req, { data })) return;
		return new Response("Falha no upgrade para WebSocket.", { status: 400 });
	},

	websocket: {
		data: {} as ProxyData,

		open(ws) {
			const { arenaId, player, pending } = ws.data;
			if (!player) {
				ws.close(CloseCode.Unauthorized, "Token inválido ou expirado.");
				return;
			}

			const url = new URL(
				`${GAME_WS_URL}/arenas/${encodeURIComponent(arenaId)}/play`,
			);
			url.searchParams.set("playerId", String(player.id));
			url.searchParams.set("name", player.name);
			url.searchParams.set("color", player.color);
			url.searchParams.set("sessionId", player.sessionId);

			const upstream = new WebSocket(url);
			ws.data.upstream = upstream;

			upstream.addEventListener("open", () => {
				for (const message of pending) upstream.send(message);
				pending.length = 0;
			});
			upstream.addEventListener("message", (event) => {
				ws.send(event.data);
			});
			upstream.addEventListener("close", (event) => {
				ws.close(closeCode(event.code), event.reason);
			});
			upstream.addEventListener("error", () => {
				ws.close(1011, "Serviço de jogo indisponível.");
			});
		},

		message(ws, message) {
			const { upstream, pending } = ws.data;
			if (upstream?.readyState === WebSocket.OPEN) upstream.send(message);
			else pending.push(String(message));
		},

		close(ws) {
			ws.data.upstream?.close();
		},
	},
});

console.log(`Gateway em http://${server.hostname}:${server.port}`);
console.log(`Documentação em http://localhost:${server.port}/docs`);
