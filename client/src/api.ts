export type Link = { href: string; method?: string; templated?: boolean };
export type Links = Record<string, Link>;

export type Root = { name: string; _links: Links };

export type Session = {
	token: string;
	player: { id: number; name: string; color: string };
	_links: Links;
};

export type Leaderboard = {
	entries: {
		rank: number;
		playerId: number;
		name: string;
		color: string;
		bestScore: number;
		totalKills: number;
		matches: number;
	}[];
	_links: Links;
};

export class ApiError extends Error {
	constructor(
		readonly code: string,
		message: string,
	) {
		super(message);
	}
}

const GATEWAY_PORT = 3000;

/**
 * O gateway roda na mesma máquina que serve esta página, então o endereço
 * dele vem do host pelo qual a página foi aberta (nunca `localhost` fixo).
 */
export function gatewayUrl(): string {
	const override = new URLSearchParams(location.search).get("gateway");
	return (
		override ?? `${location.protocol}//${location.hostname}:${GATEWAY_PORT}`
	);
}

/** Busca o link de uma relação; o cliente só conhece a URL raiz do gateway. */
export function follow(links: Links, rel: string): Link {
	const link = links[rel];
	if (!link) throw new ApiError("missing_link", `Link "${rel}" ausente.`);
	return link;
}

export async function request<T>(
	link: Link,
	options: { token?: string; body?: unknown } = {},
): Promise<T> {
	const headers: Record<string, string> = {};
	if (options.token) headers.Authorization = `Bearer ${options.token}`;
	if (options.body !== undefined) headers["Content-Type"] = "application/json";

	let res: Response;
	try {
		res = await fetch(link.href, {
			method: link.method ?? "GET",
			headers,
			body:
				options.body === undefined ? undefined : JSON.stringify(options.body),
		});
	} catch {
		throw new ApiError("network", "Não foi possível falar com o servidor.");
	}

	const data = await res.json().catch(() => null);
	if (!res.ok) {
		throw new ApiError(
			data?.error?.code ?? "unknown",
			data?.error?.message ?? `Erro ${res.status}.`,
		);
	}
	return data as T;
}

/** Entra no jogo: lê a raiz do gateway e segue o link `sessions`. */
export async function createSession(name: string): Promise<Session> {
	const root = await request<Root>({ href: `${gatewayUrl()}/` });
	return request<Session>(follow(root._links, "sessions"), { body: { name } });
}

/** Preenche o link templado `play` com o JWT. */
export function playUrl(session: Session): string {
	const token = encodeURIComponent(session.token);
	return follow(session._links, "play").href.replace(
		"{?token}",
		`?token=${token}`,
	);
}
