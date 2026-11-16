import type { Accessories } from "@snake/shared";
import { useEffect, useRef } from "react";
import { drawHeadDetails } from "./head.ts";

type Props = {
	color: string;
	accessories: Accessories;
	width: number;
	height: number;
	cell: number;
	length: number;
	dir: readonly [number, number];
	animated?: boolean;
	label: string;
};

export function Portrait({
	color,
	accessories,
	width,
	height,
	cell,
	length,
	dir,
	animated = false,
	label,
}: Props) {
	const canvasRef = useRef<HTMLCanvasElement>(null);

	useEffect(() => {
		const canvas = canvasRef.current;
		const ctx = canvas?.getContext("2d");
		if (!canvas || !ctx) return;

		const ratio = window.devicePixelRatio || 1;
		canvas.width = Math.round(width * ratio);
		canvas.height = Math.round(height * ratio);
		ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

		const gap = Math.max(1, cell * 0.08);
		const side = cell - gap * 2;
		const offset = ((length - 1) / 2) * cell;
		const headX = width / 2 + dir[0] * offset;
		const headY = height / 2 + dir[1] * offset;

		const draw = (now: number) => {
			ctx.clearRect(0, 0, width, height);
			ctx.fillStyle = color;
			for (let i = length - 1; i >= 0; i--) {
				const x = headX - dir[0] * i * cell;
				const y = headY - dir[1] * i * cell;
				ctx.beginPath();
				ctx.roundRect(x - side / 2, y - side / 2, side, side, cell * 0.25);
				ctx.fill();
			}
			drawHeadDetails(ctx, {
				cx: headX,
				cy: headY,
				size: cell,
				dir,
				accessories,
				now,
			});
		};

		if (!animated) {
			draw(0);
			return;
		}
		let frame = requestAnimationFrame(function loop(now) {
			frame = requestAnimationFrame(loop);
			draw(now);
		});
		return () => cancelAnimationFrame(frame);
	}, [color, accessories, width, height, cell, length, dir, animated]);

	return (
		<canvas
			ref={canvasRef}
			role="img"
			aria-label={label}
			style={{ width, height }}
		/>
	);
}
