import { COSMETICS_NS } from "@snake/shared/cosmetics";
import {
	buildEnvelope,
	buildFault,
	SOAP_ENV_NS,
	type SoapParams,
} from "@snake/shared/soap";
import type { Context } from "hono";
import { COSMETICS_API_URL } from "./config.ts";

export const COSMETICS_PATH = "/soap/cosmetics";

const XML = "text/xml; charset=utf-8";

function fault(code: "Client" | "Server", message: string, status: number) {
	return new Response(buildFault(code, message), {
		status,
		headers: { "Content-Type": XML },
	});
}

async function forward(init: RequestInit, query = ""): Promise<Response> {
	try {
		return await fetch(`${COSMETICS_API_URL}${query}`, init);
	} catch {
		return new Response(SOAP_UNAVAILABLE_EXAMPLE, {
			status: 502,
			headers: { "Content-Type": XML },
		});
	}
}

export async function proxySoap(c: Context): Promise<Response> {
	const type = c.req.header("Content-Type") ?? "";
	if (!type.includes("xml")) {
		return fault(
			"Client",
			"Envie um Envelope SOAP com Content-Type text/xml.",
			415,
		);
	}

	const res = await forward({
		method: "POST",
		headers: {
			"Content-Type": type,
			SOAPAction: c.req.header("SOAPAction") ?? '""',
		},
		body: await c.req.text(),
	});
	return new Response(res.body, {
		status: res.status,
		headers: { "Content-Type": res.headers.get("Content-Type") ?? XML },
	});
}

export async function proxyWsdl(c: Context): Promise<Response> {
	const url = new URL(c.req.url);
	if (!url.searchParams.has("wsdl") && !url.searchParams.has("WSDL")) {
		return fault(
			"Client",
			"Use GET ?wsdl para o contrato, ou POST com um Envelope.",
			400,
		);
	}

	const res = await forward({ method: "GET" }, "?wsdl");
	if (!res.ok) return res;

	const endpoint = `${url.origin}${COSMETICS_PATH}`;
	const wsdl = (await res.text()).replace(
		/(<[\w-]+:address\s+location=")[^"]*(")/g,
		`$1${endpoint}$2`,
	);
	return new Response(wsdl, { headers: { "Content-Type": XML } });
}

const example = (operation: string, params?: SoapParams, header?: SoapParams) =>
	buildEnvelope({ ns: COSMETICS_NS, operation, params, header });

export const SOAP_REQUEST_EXAMPLES = {
	ListAccessories: {
		summary: "Catálogo de acessórios de rosto",
		value: example("ListAccessories", [["slot", "face"]]),
	},
	GetCustomization: {
		summary: "Acessórios do jogador 1",
		value: example("GetCustomization", [["playerId", 1]]),
	},
	SetCustomization: {
		summary: "Troca os acessórios (troque o token pelo de POST /sessions)",
		value: example(
			"SetCustomization",
			[
				["head", "crown"],
				["face", "mustache"],
			],
			[["AuthHeader", [["token", "COLE_AQUI_O_JWT"]]]],
		),
	},
};

export const SOAP_RESPONSE_EXAMPLE = [
	'<?xml version="1.0" encoding="UTF-8"?>',
	`<soap:Envelope xmlns:soap="${SOAP_ENV_NS}" xmlns:tns="${COSMETICS_NS}">`,
	"  <soap:Body>",
	"    <tns:GetCustomizationResponse>",
	"      <tns:customization>",
	"        <tns:playerId>1</tns:playerId>",
	"        <tns:head>crown</tns:head>",
	"        <tns:face>mustache</tns:face>",
	"      </tns:customization>",
	"    </tns:GetCustomizationResponse>",
	"  </soap:Body>",
	"</soap:Envelope>",
].join("\n");

export const SOAP_FAULT_EXAMPLE = buildFault(
	"Client",
	'"Bigode" é um acessório de rosto, não de cabeça.',
).replace("soap:Client", "soap:Client.WrongSlot");

export const SOAP_UNAVAILABLE_EXAMPLE = buildFault(
	"Server",
	"Serviço de customização indisponível.",
);

export const WSDL_EXAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<wsdl:definitions xmlns:wsdl="http://schemas.xmlsoap.org/wsdl/" targetNamespace="${COSMETICS_NS}" name="CosmeticsService">
  <!-- tipos (XML Schema), mensagens, portType, binding e service -->
</wsdl:definitions>`;
