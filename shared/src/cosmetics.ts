import type { Accessories, Slot } from "./index.ts";
import { type SoapExchange, type SoapParams, soapCall } from "./soap.ts";
import { child, children, type XmlElement } from "./xml.ts";

export const COSMETICS_NS = "urn:snake-arena:cosmetics";

export type Accessory = { id: string; slot: Slot; name: string };

export type Customization = Accessories & { playerId: number };

const text = (element: XmlElement | undefined, name: string) =>
	child(element, name, COSMETICS_NS)?.text.trim() || null;

function toCustomization(response: XmlElement): Customization {
	const customization = child(response, "customization", COSMETICS_NS);
	return {
		playerId: Number(text(customization, "playerId")),
		head: text(customization, "head"),
		face: text(customization, "face"),
	};
}

export class CosmeticsClient {
	constructor(
		private readonly endpoint: string,
		private readonly onExchange?: (exchange: SoapExchange) => void,
	) {}

	private call(operation: string, params?: SoapParams, header?: SoapParams) {
		return soapCall({
			endpoint: this.endpoint,
			ns: COSMETICS_NS,
			operation,
			params,
			header,
			onExchange: this.onExchange,
		});
	}

	async listAccessories(slot?: Slot): Promise<Accessory[]> {
		const response = await this.call("ListAccessories", [["slot", slot]]);
		return children(child(response, "accessories", COSMETICS_NS), "Accessory")
			.map((item) => ({
				id: text(item, "id") ?? "",
				slot: text(item, "slot") as Slot,
				name: text(item, "name") ?? "",
			}))
			.filter((item) => item.id);
	}

	async getCustomization(playerId: number): Promise<Customization> {
		const response = await this.call("GetCustomization", [
			["playerId", playerId],
		]);
		return toCustomization(response);
	}

	async setCustomization(
		token: string,
		accessories: Accessories,
	): Promise<Customization> {
		const response = await this.call(
			"SetCustomization",
			[
				["head", accessories.head],
				["face", accessories.face],
			],
			[["AuthHeader", [["token", token]]]],
		);
		return toCustomization(response);
	}
}

export { type SoapExchange, SoapFault } from "./soap.ts";
