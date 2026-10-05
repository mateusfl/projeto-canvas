import type { PlayerIdentity } from "@snake/shared";
import { createMiddleware } from "hono/factory";
import { verify } from "hono/jwt";
import { JWT_SECRET } from "./config.ts";
import { ApiError } from "./http.ts";

export type Env = { Variables: { player: PlayerIdentity } };

export async function verifyToken(token: string): Promise<PlayerIdentity> {
	try {
		const payload = await verify(token, JWT_SECRET, "HS256");
		const id = Number(payload.sub);
		const { name, color, sid } = payload;
		if (
			!Number.isInteger(id) ||
			typeof name !== "string" ||
			typeof color !== "string" ||
			typeof sid !== "string"
		) {
			throw new Error("payload incompleto");
		}
		return { id, name, color, sessionId: sid };
	} catch {
		throw new ApiError(401, "invalid_token", "Token inválido ou expirado.");
	}
}

/** Exige `Authorization: Bearer <jwt>` e disponibiliza o jogador em `c.var.player`. */
export const requireAuth = createMiddleware<Env>(async (c, next) => {
	const token = c.req.header("Authorization")?.match(/^Bearer (.+)$/)?.[1];
	if (!token) {
		throw new ApiError(401, "missing_token", "Token de acesso ausente.");
	}
	c.set("player", await verifyToken(token));
	await next();
});
