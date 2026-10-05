import { describe, expect, test } from "bun:test";
import type { Cell, PlayerIdentity } from "@snake/shared";
import { Arena } from "./arena.ts";

function player(id: number, name = `p${id}`): PlayerIdentity {
	return { id, name, color: "#fff", sessionId: `s${id}` };
}

/** Arena sem comida, para os testes controlarem tudo o que está no grid. */
function emptyArena(width = 10, height = 10): Arena {
	return new Arena("t", { width, height, tickMs: 100, foodTarget: 0 });
}

function cellsOf(arena: Arena, id: number): Cell[] | undefined {
	return arena.snakeViews().find((snake) => snake.id === id)?.cells;
}

describe("Arena", () => {
	test("move a cobrinha uma célula por tick na direção atual", () => {
		const arena = emptyArena();
		arena.place(
			player(1),
			[
				[2, 5],
				[1, 5],
				[0, 5],
			],
			"right",
		);
		arena.step();
		expect(cellsOf(arena, 1)).toEqual([
			[3, 5],
			[2, 5],
			[1, 5],
		]);
	});

	test("atravessa a borda e reaparece no lado oposto", () => {
		const arena = emptyArena();
		arena.place(
			player(1),
			[
				[9, 0],
				[8, 0],
				[7, 0],
			],
			"right",
		);
		arena.step();
		expect(cellsOf(arena, 1)?.[0]).toEqual([0, 0]);

		arena.turn(1, "up");
		arena.step();
		expect(cellsOf(arena, 1)?.[0]).toEqual([0, 9]);
	});

	test("ignora a virada para a direção oposta", () => {
		const arena = emptyArena();
		arena.place(
			player(1),
			[
				[2, 5],
				[1, 5],
				[0, 5],
			],
			"right",
		);
		arena.turn(1, "left");
		arena.step();
		expect(cellsOf(arena, 1)?.[0]).toEqual([3, 5]);
		expect(arena.isAlive(1)).toBe(true);
	});

	test("cresce ao comer", () => {
		const arena = emptyArena();
		arena.place(
			player(1),
			[
				[2, 5],
				[1, 5],
				[0, 5],
			],
			"right",
		);
		// A cobrinha que sai da partida deixa comida em (4,5), no caminho da outra.
		arena.place(player(2), [[4, 5]], "up");
		arena.leave(2);
		expect(arena.foodCells()).toEqual([[4, 5]]);

		arena.step();
		expect(cellsOf(arena, 1)).toHaveLength(3);
		arena.step();
		expect(cellsOf(arena, 1)).toHaveLength(4);
		expect(arena.foodCells()).toEqual([]);
	});

	test("bater no corpo de outro jogador elimina e dá o abate a ele", () => {
		const arena = emptyArena();
		arena.place(
			player(1, "ana"),
			[
				[2, 5],
				[1, 5],
				[0, 5],
			],
			"right",
		);
		arena.place(
			player(2, "bia"),
			[
				[3, 3],
				[3, 4],
				[3, 5],
				[3, 6],
			],
			"up",
		);

		const deaths = arena.step();
		expect(deaths).toHaveLength(1);
		expect(deaths[0]).toMatchObject({ score: 3, killedBy: "bia" });
		expect(deaths[0]?.player.id).toBe(1);
		expect(arena.isAlive(1)).toBe(false);
		expect(arena.isAlive(2)).toBe(true);
		expect(arena.snakeViews()[0]?.kills).toBe(1);
	});

	test("a cobrinha eliminada deixa comida fora das células ocupadas", () => {
		const arena = emptyArena();
		arena.place(
			player(1),
			[
				[2, 5],
				[1, 5],
				[0, 5],
			],
			"right",
		);
		arena.place(
			player(2),
			[
				[3, 3],
				[3, 4],
				[3, 5],
				[3, 6],
			],
			"up",
		);
		arena.step();
		// Cabeça (3,5) está sob o corpo do vencedor; sobra a comida da cauda.
		expect(arena.foodCells()).toEqual([[1, 5]]);
	});

	test("bater no próprio corpo elimina", () => {
		const arena = emptyArena();
		arena.place(
			player(1),
			[
				[5, 5],
				[4, 5],
				[4, 6],
				[5, 6],
				[6, 6],
				[6, 5],
				[6, 4],
			],
			"right",
		);
		const deaths = arena.step();
		expect(deaths).toHaveLength(1);
		expect(deaths[0]?.killedBy).toBeNull();
	});

	test("seguir a própria cauda não elimina", () => {
		const arena = emptyArena();
		arena.place(
			player(1),
			[
				[5, 5],
				[4, 5],
				[4, 6],
				[5, 6],
			],
			"down",
		);
		expect(arena.step()).toEqual([]);
		expect(arena.isAlive(1)).toBe(true);
	});

	test("cabeça contra cabeça elimina os dois", () => {
		const arena = emptyArena();
		arena.place(
			player(1),
			[
				[3, 5],
				[2, 5],
				[1, 5],
			],
			"right",
		);
		arena.place(
			player(2),
			[
				[5, 5],
				[6, 5],
				[7, 5],
			],
			"left",
		);
		expect(arena.step()).toHaveLength(2);

		// Cabeças vizinhas trocando de lugar também se chocam.
		arena.place(
			player(3),
			[
				[3, 2],
				[2, 2],
				[1, 2],
			],
			"right",
		);
		arena.place(
			player(4),
			[
				[4, 2],
				[5, 2],
				[6, 2],
			],
			"left",
		);
		expect(arena.step()).toHaveLength(2);
	});

	test("nasce longe do centro e mantém a comida no alvo", () => {
		const arena = new Arena("t", {
			width: 40,
			height: 40,
			tickMs: 100,
			foodTarget: 30,
		});
		expect(arena.foodCells()).toHaveLength(30);

		for (let id = 1; id <= 20; id++) arena.spawn(player(id));
		for (const snake of arena.snakeViews()) {
			const [x, y] = snake.cells[0] as Cell;
			const far = Math.abs(x - 20) >= 10 || Math.abs(y - 20) >= 10;
			expect(far).toBe(true);
			expect(snake.cells).toHaveLength(3);
		}
	});
});
