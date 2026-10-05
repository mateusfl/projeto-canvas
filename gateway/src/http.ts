import type { ContentfulStatusCode } from "hono/utils/http-status";

/** Erro com status HTTP, convertido em resposta JSON pelo `onError` do app. */
export class ApiError extends Error {
	constructor(
		readonly status: ContentfulStatusCode,
		readonly code: string,
		message: string,
	) {
		super(message);
	}
}

type UpstreamError = { error?: { code?: string; message?: string } };

/** Chama uma API interna e repassa o erro dela, se houver, como `ApiError`. */
export async function upstream<T>(
	baseUrl: string,
	path: string,
	init?: RequestInit,
): Promise<T> {
	let res: Response;
	try {
		res = await fetch(`${baseUrl}${path}`, init);
	} catch {
		throw new ApiError(
			502,
			"upstream_unavailable",
			"Serviço interno indisponível.",
		);
	}

	const body: unknown = await res.json().catch(() => null);
	if (!res.ok) {
		const { error } = (body ?? {}) as UpstreamError;
		throw new ApiError(
			res.status as ContentfulStatusCode,
			error?.code ?? "upstream_error",
			error?.message ?? "Erro no serviço interno.",
		);
	}
	return body as T;
}
