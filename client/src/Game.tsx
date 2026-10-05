import {
	type ClientMessage,
	CloseCode,
	type Direction,
	type ServerMessage,
} from "@snake/shared";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	follow,
	type Leaderboard,
	playUrl,
	request,
	type Session,
} from "./api.ts";
import { burnSeconds, Scene } from "./scene.ts";

type Props = {
	session: Session;
	/** Volta para a tela de entrada, opcionalmente com o motivo. */
	onExit: (reason?: string) => void;
};

type Hud = {
	score: number;
	kills: number;
	alive: number;
	top: { id: number; name: string; color: string; score: number }[];
};

type DeadInfo = { score: number; kills: number; killedBy: string | null };

const KEYS: Record<string, Direction> = {
	ArrowUp: "up",
	ArrowDown: "down",
	ArrowLeft: "left",
	ArrowRight: "right",
	w: "up",
	s: "down",
	a: "left",
	d: "right",
};

const CLOSE_REASONS: Record<number, string> = {
	[CloseCode.NameInUse]: "Já existe um jogador com esse nome na arena.",
	[CloseCode.Unauthorized]: "Sessão expirada. Entre novamente.",
	[CloseCode.Replaced]: "Você conectou em outra aba.",
	[CloseCode.ArenaNotFound]: "Arena não encontrada.",
};

const SWIPE_MIN_PX = 24;
const SPRING = { type: "spring", stiffness: 420, damping: 30 } as const;
export const PRESSABLE = {
	whileHover: { scale: 1.03 },
	whileTap: { scale: 0.96 },
} as const;
// A API de jogo registra a partida em paralelo ao aviso de eliminação.
const RANKING_DELAY_MS = 300;

export function Game({ session, onExit }: Props) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const socketRef = useRef<WebSocket | null>(null);
	const onExitRef = useRef(onExit);
	onExitRef.current = onExit;

	const [hud, setHud] = useState<Hud | null>(null);
	const [dead, setDead] = useState<DeadInfo | null>(null);
	const [ranking, setRanking] = useState<Leaderboard | null>(null);

	const send = useCallback((message: ClientMessage) => {
		const socket = socketRef.current;
		if (socket?.readyState === WebSocket.OPEN) {
			socket.send(JSON.stringify(message));
		}
	}, []);

	const respawn = useCallback(() => {
		send({ type: "respawn" });
		setDead(null);
		setRanking(null);
	}, [send]);

	// Conexão com a partida e loop de renderização.
	useEffect(() => {
		const canvas = canvasRef.current;
		const ctx = canvas?.getContext("2d");
		if (!canvas || !ctx) return;

		const myId = session.player.id;
		let scene: Scene | null = null;
		let disposed = false;

		const socket = new WebSocket(playUrl(session));
		socketRef.current = socket;

		socket.onmessage = (event) => {
			const message: ServerMessage = JSON.parse(event.data);
			if (message.type === "welcome") {
				scene = new Scene(message.arena, myId);
			} else if (message.type === "state") {
				scene?.push(message, performance.now());
				const mine = message.snakes.find((snake) => snake.id === myId);
				setHud({
					score: mine?.cells.length ?? 0,
					kills: mine?.kills ?? 0,
					alive: message.snakes.length,
					top: message.snakes
						.map(({ id, name, color, cells }) => ({
							id,
							name,
							color,
							score: cells.length,
						}))
						.sort((a, b) => b.score - a.score)
						.slice(0, 5),
				});
			} else if (message.type === "dead") {
				setDead(message);
				setTimeout(() => {
					if (disposed) return;
					request<Leaderboard>(follow(session._links, "leaderboard"), {
						token: session.token,
					})
						.then(setRanking)
						.catch(() => setRanking(null));
				}, RANKING_DELAY_MS);
			}
		};

		socket.onclose = (event) => {
			if (disposed) return;
			onExitRef.current(
				CLOSE_REASONS[event.code] ?? "Conexão com o servidor perdida.",
			);
		};

		const resize = () => {
			const ratio = window.devicePixelRatio || 1;
			canvas.width = Math.floor(window.innerWidth * ratio);
			canvas.height = Math.floor(window.innerHeight * ratio);
			ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
		};
		resize();
		window.addEventListener("resize", resize);

		let animation = requestAnimationFrame(function loop(now) {
			animation = requestAnimationFrame(loop);
			scene?.draw(ctx, window.innerWidth, window.innerHeight, now);
		});

		return () => {
			disposed = true;
			cancelAnimationFrame(animation);
			scene?.dispose();
			window.removeEventListener("resize", resize);
			socket.close();
		};
	}, [session]);

	// Teclado (setas ou WASD) e gesto de arrastar no toque.
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			const dir =
				KEYS[event.key.length === 1 ? event.key.toLowerCase() : event.key];
			if (dir) {
				event.preventDefault();
				send({ type: "dir", dir });
			} else if (dead && (event.key === " " || event.key === "Enter")) {
				event.preventDefault();
				respawn();
			}
		};

		let start: Touch | null = null;
		const onTouchStart = (event: TouchEvent) => {
			start = event.touches[0] ?? null;
		};
		const onTouchEnd = (event: TouchEvent) => {
			const end = event.changedTouches[0];
			if (!start || !end) return;
			const dx = end.clientX - start.clientX;
			const dy = end.clientY - start.clientY;
			if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_MIN_PX) return;
			if (Math.abs(dx) > Math.abs(dy)) {
				send({ type: "dir", dir: dx > 0 ? "right" : "left" });
			} else {
				send({ type: "dir", dir: dy > 0 ? "down" : "up" });
			}
		};

		window.addEventListener("keydown", onKeyDown);
		window.addEventListener("touchstart", onTouchStart);
		window.addEventListener("touchend", onTouchEnd);
		return () => {
			window.removeEventListener("keydown", onKeyDown);
			window.removeEventListener("touchstart", onTouchStart);
			window.removeEventListener("touchend", onTouchEnd);
		};
	}, [dead, respawn, send]);

	return (
		<div className="game">
			<canvas ref={canvasRef} />

			<div className="hud hud-me">
				<span className="swatch" style={{ background: session.player.color }} />
				<strong>{session.player.name}</strong>
				<span>
					Tamanho <Counter value={hud?.score ?? 0} />
				</span>
				<span>
					Abates <Counter value={hud?.kills ?? 0} />
				</span>
			</div>

			<div className="hud hud-top">
				<h2>Na arena ({hud?.alive ?? 0})</h2>
				<ol>
					<AnimatePresence initial={false}>
						{hud?.top.map((entry) => (
							// `layout` faz as posições deslizarem quando a ordem muda.
							<motion.li
								key={entry.id}
								layout
								initial={{ opacity: 0, x: 12 }}
								animate={{ opacity: 1, x: 0 }}
								exit={{ opacity: 0, x: 12 }}
								transition={SPRING}
							>
								<span className="swatch" style={{ background: entry.color }} />
								<span className="name">{entry.name}</span>
								<span>{entry.score}</span>
							</motion.li>
						))}
					</AnimatePresence>
				</ol>
			</div>

			<AnimatePresence>
				{dead && (
					<motion.div
						className="overlay"
						initial={{ opacity: 0 }}
						animate={{ opacity: 1 }}
						exit={{ opacity: 0, transition: { duration: 0.15 } }}
						// Espera o pavio da própria cobrinha queimar antes de cobrir a arena.
						transition={{ delay: burnSeconds(dead.score), duration: 0.25 }}
					>
						<motion.div
							className="dead-card"
							initial={{ opacity: 0, scale: 0.9, y: 24 }}
							animate={{ opacity: 1, scale: 1, y: 0 }}
							exit={{ opacity: 0, scale: 0.95 }}
							transition={{ ...SPRING, delay: burnSeconds(dead.score) }}
						>
							<h1>Você foi eliminado</h1>
							<p>
								{dead.killedBy
									? `Bateu em ${dead.killedBy}.`
									: "Bateu no próprio corpo."}
							</p>
							<p className="result">
								Tamanho <strong>{dead.score}</strong> · Abates{" "}
								<strong>{dead.kills}</strong>
							</p>

							{ranking && ranking.entries.length > 0 && (
								<table>
									<caption>Ranking geral</caption>
									<tbody>
										{ranking.entries.map((entry, index) => (
											<motion.tr
												key={entry.playerId}
												className={
													entry.playerId === session.player.id
														? "me"
														: undefined
												}
												initial={{ opacity: 0, x: -10 }}
												animate={{ opacity: 1, x: 0 }}
												transition={{ delay: index * 0.04 }}
											>
												<td>{entry.rank}</td>
												<td className="name">{entry.name}</td>
												<td>{entry.bestScore}</td>
											</motion.tr>
										))}
									</tbody>
								</table>
							)}

							<motion.button type="button" onClick={respawn} {...PRESSABLE}>
								Jogar de novo
							</motion.button>
							<motion.button
								type="button"
								className="ghost"
								onClick={() => onExit()}
								{...PRESSABLE}
							>
								Sair
							</motion.button>
						</motion.div>
					</motion.div>
				)}
			</AnimatePresence>
		</div>
	);
}

/** Número que dá um pulinho sempre que muda. */
function Counter({ value }: { value: number }) {
	return (
		<motion.strong
			key={value}
			className="counter"
			initial={{ scale: 1.6, color: "#22c55e" }}
			animate={{ scale: 1, color: "#e2e8f0" }}
			transition={SPRING}
		>
			{value}
		</motion.strong>
	);
}
