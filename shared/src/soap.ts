import {
	child,
	escapeXml,
	parseXml,
	type XmlElement,
	XmlError,
} from "./xml.ts";

export const SOAP_ENV_NS = "http://schemas.xmlsoap.org/soap/envelope/";

export type SoapValue = string | number | SoapParams | null | undefined;
export type SoapParams = [name: string, value: SoapValue][];

export class SoapFault extends Error {
	constructor(
		readonly code: string,
		message: string,
	) {
		super(message);
	}

	get isClient(): boolean {
		return this.code === "Client" || this.code.startsWith("Client.");
	}
}

export type SoapExchange = {
	operation: string;
	request: string;
	response: string;
	status: number;
	durationMs: number;
};

function serialize(params: SoapParams, prefix: string): string {
	return params
		.filter(([, value]) => value !== null && value !== undefined)
		.map(([name, value]) => {
			const tag = `${prefix}:${name}`;
			const content = Array.isArray(value)
				? serialize(value, prefix)
				: escapeXml(String(value));
			return `<${tag}>${content}</${tag}>`;
		})
		.join("");
}

export function buildEnvelope(options: {
	ns: string;
	operation: string;
	params?: SoapParams;
	header?: SoapParams;
}): string {
	const { ns, operation, params = [], header } = options;
	const lines = [
		'<?xml version="1.0" encoding="UTF-8"?>',
		`<soap:Envelope xmlns:soap="${SOAP_ENV_NS}" xmlns:tns="${escapeXml(ns)}">`,
	];
	if (header?.length) {
		lines.push(`  <soap:Header>${serialize(header, "tns")}</soap:Header>`);
	}
	lines.push(
		"  <soap:Body>",
		`    <tns:${operation}>${serialize(params, "tns")}</tns:${operation}>`,
		"  </soap:Body>",
		"</soap:Envelope>",
	);
	return lines.join("\n");
}

export function buildFault(code: "Client" | "Server", message: string): string {
	return [
		'<?xml version="1.0" encoding="UTF-8"?>',
		`<soap:Envelope xmlns:soap="${SOAP_ENV_NS}">`,
		"  <soap:Body>",
		"    <soap:Fault>",
		`      <faultcode>soap:${code}</faultcode>`,
		`      <faultstring>${escapeXml(message)}</faultstring>`,
		"    </soap:Fault>",
		"  </soap:Body>",
		"</soap:Envelope>",
	].join("\n");
}

export function parseEnvelope(xml: string): XmlElement {
	let envelope: XmlElement;
	try {
		envelope = parseXml(xml);
	} catch (err) {
		const detail = err instanceof XmlError ? ` ${err.message}` : "";
		throw new SoapFault(
			"Client.InvalidResponse",
			`Resposta não é XML.${detail}`,
		);
	}
	if (envelope.name !== "Envelope" || envelope.ns !== SOAP_ENV_NS) {
		throw new SoapFault(
			"Client.InvalidResponse",
			"Resposta sem Envelope SOAP.",
		);
	}
	const payload = child(envelope, "Body", SOAP_ENV_NS)?.children[0];
	if (!payload) {
		throw new SoapFault("Client.InvalidResponse", "Body SOAP vazio.");
	}
	if (payload.name === "Fault" && payload.ns === SOAP_ENV_NS) {
		const code = child(payload, "faultcode")?.text.trim() ?? "Server";
		const message = child(payload, "faultstring")?.text.trim() ?? "";
		throw new SoapFault(code.replace(/^[^:]*:/, ""), message || code);
	}
	return payload;
}

export async function soapCall(options: {
	endpoint: string;
	ns: string;
	operation: string;
	params?: SoapParams;
	header?: SoapParams;
	onExchange?: (exchange: SoapExchange) => void;
}): Promise<XmlElement> {
	const { endpoint, operation, onExchange } = options;
	const request = buildEnvelope(options);
	const startedAt = performance.now();

	let res: Response;
	try {
		res = await fetch(endpoint, {
			method: "POST",
			headers: {
				"Content-Type": "text/xml; charset=utf-8",
				SOAPAction: `"${operation}"`,
			},
			body: request,
		});
	} catch {
		throw new SoapFault(
			"Client.Unreachable",
			"Não foi possível falar com o serviço SOAP.",
		);
	}

	const response = await res.text();
	onExchange?.({
		operation,
		request,
		response,
		status: res.status,
		durationMs: Math.round(performance.now() - startedAt),
	});
	return parseEnvelope(response);
}
