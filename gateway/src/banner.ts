import { networkInterfaces } from "node:os";
import { COSMETICS_PATH } from "./cosmetics.ts";

const VIRTUAL =
	/^(lo|docker|br-|veth|virbr|vmnet|vboxnet|tailscale|tun|tap|wg|zt)/;

const CLIENT_PORT = Number(process.env.CLIENT_PORT ?? 5173);

type LanAddress = { name: string; kind: string; address: string };

function kindOf(name: string): string {
	if (/^(wl|wlan|wi-?fi)/i.test(name)) return "Wi-Fi";
	if (/^(en|eth|ethernet)/i.test(name)) return "cabo";
	return "rede";
}

function lanAddresses(): LanAddress[] {
	return Object.entries(networkInterfaces()).flatMap(([name, entries]) =>
		VIRTUAL.test(name)
			? []
			: (entries ?? [])
					.filter((entry) => entry.family === "IPv4" && !entry.internal)
					.map((entry) => ({
						name,
						kind: kindOf(name),
						address: entry.address,
					})),
	);
}

function links(host: string, gatewayPort: number): [string, string][] {
	const gateway = `http://${host}:${gatewayPort}`;
	return [
		["Jogo", `http://${host}:${CLIENT_PORT}`],
		["Swagger", `${gateway}/docs`],
		["WSDL", `${gateway}${COSMETICS_PATH}?wsdl`],
	];
}

export function printAccessBanner(gatewayPort: number): void {
	const addresses = lanAddresses();
	if (addresses.length === 0) {
		console.log("Sem rede: só esta máquina consegue acessar.");
		return;
	}

	const lines = [
		`Acesso pela rede (libere as portas ${CLIENT_PORT} e ${gatewayPort} no firewall):`,
	];
	for (const { name, kind, address } of addresses) {
		lines.push(`  ${address} (${name}, ${kind})`);
		for (const [label, url] of links(address, gatewayPort)) {
			lines.push(`    ${label.padEnd(8)}${url}`);
		}
	}
	console.log(lines.join("\n"));
}
