export type XmlElement = {
	name: string;
	ns: string | null;
	attrs: Record<string, string>;
	children: XmlElement[];
	text: string;
};

export class XmlError extends Error {}

const ENTITIES: Record<string, string> = {
	lt: "<",
	gt: ">",
	amp: "&",
	quot: '"',
	apos: "'",
};

function decode(text: string): string {
	return text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (match, entity: string) => {
		if (entity[0] === "#") {
			const code =
				entity[1] === "x" || entity[1] === "X"
					? Number.parseInt(entity.slice(2), 16)
					: Number.parseInt(entity.slice(1), 10);
			return String.fromCodePoint(code);
		}
		return ENTITIES[entity] ?? match;
	});
}

export function escapeXml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}

const ATTR = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

type Open = {
	element: XmlElement;
	qname: string;
	scope: Map<string, string>;
};

export function parseXml(source: string): XmlElement {
	const stack: Open[] = [];
	let root: XmlElement | null = null;
	let pos = 0;

	const skipPast = (end: string) => {
		const at = source.indexOf(end, pos);
		if (at < 0) throw new XmlError(`"${end}" esperado.`);
		pos = at + end.length;
	};

	while (pos < source.length) {
		const lt = source.indexOf("<", pos);
		const text = source.slice(pos, lt < 0 ? source.length : lt);
		const top = stack.at(-1);
		if (top) top.element.text += decode(text);
		else if (text.trim()) throw new XmlError("Texto fora do elemento raiz.");
		if (lt < 0) break;
		pos = lt;

		if (source.startsWith("<?", pos)) {
			skipPast("?>");
		} else if (source.startsWith("<!--", pos)) {
			skipPast("-->");
		} else if (source.startsWith("<![CDATA[", pos)) {
			const start = pos + 9;
			skipPast("]]>");
			if (top) top.element.text += source.slice(start, pos - 3);
		} else if (source.startsWith("<!", pos)) {
			skipPast(">");
		} else if (source.startsWith("</", pos)) {
			const end = source.indexOf(">", pos);
			if (end < 0) throw new XmlError("Tag de fechamento incompleta.");
			const qname = source.slice(pos + 2, end).trim();
			const open = stack.pop();
			if (!open || open.qname !== qname) {
				throw new XmlError(`Fechamento inesperado de <${qname}>.`);
			}
			pos = end + 1;
		} else {
			const end = source.indexOf(">", pos);
			if (end < 0) throw new XmlError("Tag incompleta.");
			const selfClosing = source[end - 1] === "/";
			const inner = source.slice(pos + 1, selfClosing ? end - 1 : end);
			const qname = inner.match(/^[^\s/>]+/)?.[0];
			if (!qname) throw new XmlError("Tag sem nome.");

			const attrs: Record<string, string> = {};
			const scope = new Map(top?.scope);
			for (const [, key, double, single] of inner
				.slice(qname.length)
				.matchAll(ATTR)) {
				const value = decode(double ?? single ?? "");
				if (key === "xmlns") scope.set("", value);
				else if (key?.startsWith("xmlns:")) scope.set(key.slice(6), value);
				else if (key) attrs[key] = value;
			}

			const colon = qname.indexOf(":");
			const prefix = colon < 0 ? "" : qname.slice(0, colon);
			const element: XmlElement = {
				name: qname.slice(colon + 1),
				ns: scope.get(prefix) ?? null,
				attrs,
				children: [],
				text: "",
			};
			if (top) top.element.children.push(element);
			else if (root) throw new XmlError("Mais de um elemento raiz.");
			else root = element;

			if (!selfClosing) stack.push({ element, qname, scope });
			pos = end + 1;
		}
	}

	if (stack.length > 0) throw new XmlError("Documento terminou no meio.");
	if (!root) throw new XmlError("Documento vazio.");
	return root;
}

export function child(
	element: XmlElement | undefined,
	name: string,
	ns?: string,
): XmlElement | undefined {
	return element?.children.find(
		(item) => item.name === name && (ns === undefined || item.ns === ns),
	);
}

export function children(
	element: XmlElement | undefined,
	name: string,
): XmlElement[] {
	return element?.children.filter((item) => item.name === name) ?? [];
}
