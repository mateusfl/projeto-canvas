import { type Accessories, NO_ACCESSORIES, type Slot } from "@snake/shared";
import {
	type Accessory,
	type SoapExchange,
	SoapFault,
} from "@snake/shared/cosmetics";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { cosmeticsClient, type Session } from "./api.ts";
import { PRESSABLE } from "./Game.tsx";
import { canDraw } from "./head.ts";
import { Portrait } from "./Portrait.tsx";

type Props = {
	session: Session;
	onPlay: () => void;
	onExit: () => void;
};

const SLOTS: { slot: Slot; label: string }[] = [
	{ slot: "head", label: "Cabeça" },
	{ slot: "face", label: "Rosto" },
];

const RIGHT = [1, 0] as const;
const UP = [0, -1] as const;
const MAX_EXCHANGES = 8;

type Logged = SoapExchange & { seq: number };

function describe(err: unknown): string {
	if (err instanceof SoapFault) return `${err.message} (${err.code})`;
	return "Erro inesperado.";
}

function formatXml(xml: string): string {
	let depth = 0;
	return xml
		.replace(/>\s*</g, ">\n<")
		.split("\n")
		.map((raw) => {
			const line = raw.trim();
			if (line.startsWith("</")) depth = Math.max(0, depth - 1);
			const indented = "  ".repeat(depth) + line;
			const opensOnly =
				/^<[^!?/]/.test(line) && !line.endsWith("/>") && !line.includes("</");
			if (opensOnly) depth++;
			return indented;
		})
		.join("\n");
}

export function Wardrobe({ session, onPlay, onExit }: Props) {
	const [catalog, setCatalog] = useState<Accessory[] | null>(null);
	const [chosen, setChosen] = useState<Accessories>(NO_ACCESSORIES);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [exchanges, setExchanges] = useState<Logged[]>([]);
	const [showXml, setShowXml] = useState(false);

	const seq = useRef(0);

	const client = useMemo(
		() =>
			cosmeticsClient(session, (exchange) =>
				setExchanges((list) =>
					[{ ...exchange, seq: ++seq.current }, ...list].slice(
						0,
						MAX_EXCHANGES,
					),
				),
			),
		[session],
	);

	useEffect(() => {
		let cancelled = false;
		Promise.all([
			client.listAccessories(),
			client.getCustomization(session.player.id),
		])
			.then(([items, current]) => {
				if (cancelled) return;
				setCatalog(items.filter((item) => canDraw(item.id)));
				setChosen({ head: current.head, face: current.face });
			})
			.catch((err) => {
				if (cancelled) return;
				setCatalog([]);
				setError(describe(err));
			});
		return () => {
			cancelled = true;
		};
	}, [client, session.player.id]);

	async function choose(slot: Slot, id: string | null) {
		if (chosen[slot] === id) return;
		const previous = chosen;
		const next = { ...chosen, [slot]: id };
		setChosen(next);
		setSaving(true);
		setError(null);
		try {
			const saved = await client.setCustomization(session.token, next);
			setChosen({ head: saved.head, face: saved.face });
		} catch (err) {
			setChosen(previous);
			setError(describe(err));
		} finally {
			setSaving(false);
		}
	}

	const { color, name } = session.player;

	return (
		<main className="wardrobe">
			<motion.section
				className="wardrobe-card"
				initial={{ opacity: 0, y: 24, scale: 0.96 }}
				animate={{ opacity: 1, y: 0, scale: 1 }}
				transition={{ type: "spring", stiffness: 300, damping: 26 }}
			>
				<header>
					<h1>Acessórios</h1>
					<p>
						Escolha o visual de <strong>{name}</strong>. Todo mundo na arena vai
						ver.
					</p>
				</header>

				<div className="preview">
					<Portrait
						color={color}
						accessories={chosen}
						width={280}
						height={130}
						cell={48}
						length={4}
						dir={RIGHT}
						animated
						label={`Prévia da cobrinha de ${name}`}
					/>
				</div>

				{catalog === null ? (
					<p className="hint">Carregando catálogo...</p>
				) : (
					SLOTS.map(({ slot, label }) => (
						<fieldset key={slot} className="slot" disabled={saving}>
							<legend>{label}</legend>
							<div className="tiles">
								<button
									type="button"
									className="tile"
									aria-pressed={chosen[slot] === null}
									onClick={() => choose(slot, null)}
								>
									<span className="tile-none" aria-hidden>
										∅
									</span>
									<span>Nenhum</span>
								</button>
								{catalog
									.filter((item) => item.slot === slot)
									.map((item) => (
										<button
											key={item.id}
											type="button"
											className="tile"
											aria-pressed={chosen[slot] === item.id}
											onClick={() => choose(slot, item.id)}
										>
											<Portrait
												color={color}
												accessories={{ ...NO_ACCESSORIES, [slot]: item.id }}
												width={56}
												height={56}
												cell={30}
												length={1}
												dir={UP}
												label=""
											/>
											<span>{item.name}</span>
										</button>
									))}
							</div>
						</fieldset>
					))
				)}

				{error && <p className="error">{error}</p>}

				<div className="actions">
					<motion.button type="button" onClick={onPlay} {...PRESSABLE}>
						Jogar
					</motion.button>
					<motion.button
						type="button"
						className="ghost"
						aria-expanded={showXml}
						onClick={() => setShowXml((open) => !open)}
						{...PRESSABLE}
					>
						{showXml ? "Esconder XML" : "Ver XML"}
					</motion.button>
					<motion.button
						type="button"
						className="ghost"
						onClick={onExit}
						{...PRESSABLE}
					>
						Sair
					</motion.button>
				</div>
			</motion.section>

			<AnimatePresence>
				{showXml && (
					<motion.aside
						className="xml-panel"
						initial={{ opacity: 0, x: 24 }}
						animate={{ opacity: 1, x: 0 }}
						exit={{ opacity: 0, x: 24 }}
					>
						<h2>Mensagens SOAP</h2>
						<p className="hint">
							Últimas idas e voltas com <code>/soap/cosmetics</code>.
						</p>
						{exchanges.map((exchange, index) => (
							<details key={exchange.seq} open={index === 0}>
								<summary>
									<strong>{exchange.operation}</strong>
									<span className={exchange.status < 400 ? "ok" : "fault"}>
										HTTP {exchange.status}
									</span>
									<span className="muted">{exchange.durationMs} ms</span>
								</summary>
								<h3>Requisição</h3>
								<pre>{formatXml(exchange.request)}</pre>
								<h3>Resposta</h3>
								<pre>{formatXml(exchange.response)}</pre>
							</details>
						))}
					</motion.aside>
				)}
			</AnimatePresence>
		</main>
	);
}
