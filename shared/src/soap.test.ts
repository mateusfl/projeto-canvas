import { describe, expect, test } from "bun:test";
import {
	buildEnvelope,
	parseEnvelope,
	SOAP_ENV_NS,
	SoapFault,
} from "./soap.ts";
import { child, parseXml, XmlError } from "./xml.ts";

const TNS = "urn:teste";

const OK = `<?xml version='1.0' encoding='UTF-8'?>
<soap11env:Envelope xmlns:soap11env="${SOAP_ENV_NS}" xmlns:tns="${TNS}"><soap11env:Body><tns:GetCustomizationResponse><tns:customization><tns:playerId>7</tns:playerId><tns:head>crown</tns:head></tns:customization></tns:GetCustomizationResponse></soap11env:Body></soap11env:Envelope>`;

const FAULT = `<?xml version='1.0' encoding='UTF-8'?>
<soap11env:Envelope xmlns:soap11env="${SOAP_ENV_NS}"><soap11env:Body><soap11env:Fault><faultcode>soap11env:Client.WrongSlot</faultcode><faultstring>"Bigode" &#233; de rosto &amp; n&#227;o de cabe&#231;a.</faultstring><faultactor></faultactor></soap11env:Fault></soap11env:Body></soap11env:Envelope>`;

describe("parseXml", () => {
	test("resolve namespaces pelo prefixo e pelo xmlns padrão", () => {
		const root = parseXml(
			`<a:root xmlns:a="urn:a" xmlns="urn:padrao"><item id="1"/><a:item/></a:root>`,
		);
		expect(root).toMatchObject({ name: "root", ns: "urn:a" });
		expect(root.children.map((item) => [item.name, item.ns])).toEqual([
			["item", "urn:padrao"],
			["item", "urn:a"],
		]);
		expect(root.children[0]?.attrs).toEqual({ id: "1" });
	});

	test("decodifica entidades e CDATA e ignora comentários", () => {
		const root = parseXml(
			"<r><!-- nada --><t>a &lt; b &#x2014; &quot;c&quot;</t><c><![CDATA[<cru>]]></c></r>",
		);
		expect(child(root, "t")?.text).toBe('a < b — "c"');
		expect(child(root, "c")?.text).toBe("<cru>");
	});

	test("recusa XML malformado", () => {
		expect(() => parseXml("<a><b></a>")).toThrow(XmlError);
		expect(() => parseXml("<a>")).toThrow(XmlError);
		expect(() => parseXml("")).toThrow(XmlError);
	});
});

describe("buildEnvelope", () => {
	test("monta Header e Body no namespace do serviço, escapando valores", () => {
		const xml = buildEnvelope({
			ns: TNS,
			operation: "Set",
			params: [
				["head", "a<b"],
				["face", null],
			],
			header: [["Auth", [["token", "t&k"]]]],
		});
		const envelope = parseXml(xml);
		expect(envelope).toMatchObject({ name: "Envelope", ns: SOAP_ENV_NS });

		const auth = child(child(envelope, "Header", SOAP_ENV_NS), "Auth", TNS);
		expect(child(auth, "token", TNS)?.text).toBe("t&k");

		const operation = child(envelope, "Body", SOAP_ENV_NS)?.children[0];
		expect(operation).toMatchObject({ name: "Set", ns: TNS });
		expect(operation?.children.map((item) => item.name)).toEqual(["head"]);
		expect(child(operation, "head")?.text).toBe("a<b");
	});

	test("sem header não gera soap:Header", () => {
		expect(buildEnvelope({ ns: TNS, operation: "List" })).not.toContain(
			"Header",
		);
	});
});

describe("parseEnvelope", () => {
	test("devolve o elemento dentro do Body", () => {
		const payload = parseEnvelope(OK);
		expect(payload.name).toBe("GetCustomizationResponse");
		const customization = child(payload, "customization", TNS);
		expect(child(customization, "head", TNS)?.text).toBe("crown");
	});

	test("converte soap:Fault em SoapFault sem o prefixo do código", () => {
		try {
			parseEnvelope(FAULT);
			throw new Error("deveria ter lançado");
		} catch (err) {
			expect(err).toBeInstanceOf(SoapFault);
			const fault = err as SoapFault;
			expect(fault.code).toBe("Client.WrongSlot");
			expect(fault.isClient).toBe(true);
			expect(fault.message).toBe('"Bigode" é de rosto & não de cabeça.');
		}
	});

	test("recusa respostas que não são um Envelope SOAP", () => {
		expect(() => parseEnvelope("<html></html>")).toThrow(SoapFault);
		expect(() => parseEnvelope("Bad Gateway")).toThrow(SoapFault);
	});
});
