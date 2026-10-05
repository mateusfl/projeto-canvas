import { NAME_MAX_LENGTH, NAME_MIN_LENGTH } from "@snake/shared";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { type FormEvent, useState } from "react";
import { ApiError, createSession, type Session } from "./api.ts";
import { Game, PRESSABLE } from "./Game.tsx";

const NAME_STORAGE_KEY = "snake-arena:name";

function savedName(): string {
	try {
		return localStorage.getItem(NAME_STORAGE_KEY) ?? "";
	} catch {
		return "";
	}
}

export function App() {
	const [session, setSession] = useState<Session | null>(null);
	const [name, setName] = useState(savedName);
	const [error, setError] = useState<string | null>(null);
	const [joining, setJoining] = useState(false);
	const [attempt, setAttempt] = useState(0);

	async function join(event: FormEvent) {
		event.preventDefault();
		setJoining(true);
		setError(null);
		setAttempt((count) => count + 1);
		try {
			const created = await createSession(name.trim());
			try {
				localStorage.setItem(NAME_STORAGE_KEY, created.player.name);
			} catch {
				// Sem armazenamento local o nome só não fica lembrado.
			}
			setSession(created);
		} catch (err) {
			setError(err instanceof ApiError ? err.message : "Erro inesperado.");
		} finally {
			setJoining(false);
		}
	}

	return (
		// Respeita a preferência do sistema por menos movimento.
		<MotionConfig reducedMotion="user">
			<AnimatePresence mode="wait">
				{session ? (
					<motion.div
						key="game"
						className="screen"
						initial={{ opacity: 0 }}
						animate={{ opacity: 1 }}
						exit={{ opacity: 0 }}
						transition={{ duration: 0.25 }}
					>
						<Game
							session={session}
							onExit={(reason) => {
								setSession(null);
								setError(reason ?? null);
							}}
						/>
					</motion.div>
				) : (
					<motion.main
						key="join"
						className="join"
						initial={{ opacity: 0 }}
						animate={{ opacity: 1 }}
						exit={{ opacity: 0 }}
						transition={{ duration: 0.2 }}
					>
						<motion.form
							className="join-card"
							onSubmit={join}
							initial={{ opacity: 0, y: 24, scale: 0.96 }}
							animate={{ opacity: 1, y: 0, scale: 1 }}
							transition={{ type: "spring", stiffness: 300, damping: 26 }}
						>
							<h1>Snake Arena</h1>
							<p>Coma, cresça e faça os outros baterem em você.</p>
							<label htmlFor="name">Nome de exibição</label>
							<input
								id="name"
								value={name}
								onChange={(event) => setName(event.target.value)}
								minLength={NAME_MIN_LENGTH}
								maxLength={NAME_MAX_LENGTH}
								placeholder="Seu nome"
								autoComplete="off"
								// biome-ignore lint/a11y/noAutofocus: a tela só tem este campo.
								autoFocus
								required
							/>
							{error && (
								// A chave refaz o tremor a cada nova tentativa com erro.
								<motion.p
									key={attempt}
									className="error"
									initial={{ opacity: 0 }}
									animate={{ opacity: 1, x: [0, -8, 8, -5, 5, 0] }}
									transition={{ duration: 0.35 }}
								>
									{error}
								</motion.p>
							)}
							<motion.button type="submit" disabled={joining} {...PRESSABLE}>
								{joining ? "Entrando..." : "Jogar"}
							</motion.button>
						</motion.form>
					</motion.main>
				)}
			</AnimatePresence>
		</MotionConfig>
	);
}
