import type { Accessories } from "@snake/shared";

type Ctx = CanvasRenderingContext2D;

type Draw = (ctx: Ctx, t: number) => void;

const EYE_X = 0.18;
const EYE_Y = -0.14;
const EYE_R = 0.09;
const EYE_COLOR = "#0b1020";

function circle(ctx: Ctx, x: number, y: number, r: number): void {
	ctx.beginPath();
	ctx.arc(x, y, r, 0, Math.PI * 2);
}

const FACE: Record<string, Draw> = {
	sunglasses(ctx) {
		ctx.fillStyle = "#0f172a";
		ctx.strokeStyle = "#cbd5e1";
		ctx.lineWidth = 0.03;
		for (const side of [-1, 1]) {
			ctx.beginPath();
			ctx.roundRect(side * EYE_X - 0.13, EYE_Y - 0.09, 0.26, 0.18, 0.06);
			ctx.fill();
			ctx.stroke();
		}
		ctx.beginPath();
		ctx.moveTo(-EYE_X + 0.13, EYE_Y);
		ctx.lineTo(EYE_X - 0.13, EYE_Y);
		ctx.stroke();
	},
	mustache(ctx) {
		ctx.fillStyle = "#3f2a1d";
		for (const side of [-1, 1]) {
			ctx.beginPath();
			ctx.moveTo(0, -0.33);
			ctx.quadraticCurveTo(side * 0.2, -0.5, side * 0.36, -0.36);
			ctx.quadraticCurveTo(side * 0.38, -0.3, side * 0.3, -0.31);
			ctx.quadraticCurveTo(side * 0.16, -0.36, 0, -0.27);
			ctx.fill();
		}
	},
	monocle(ctx) {
		ctx.strokeStyle = "#fbbf24";
		ctx.lineWidth = 0.04;
		circle(ctx, EYE_X, EYE_Y, 0.14);
		ctx.stroke();
		ctx.lineWidth = 0.02;
		ctx.beginPath();
		ctx.moveTo(EYE_X + 0.1, EYE_Y + 0.1);
		ctx.quadraticCurveTo(0.42, 0.15, 0.3, 0.38);
		ctx.stroke();
	},
	eyepatch(ctx) {
		ctx.strokeStyle = "#020617";
		ctx.lineWidth = 0.04;
		ctx.beginPath();
		ctx.moveTo(-0.5, EYE_Y - 0.2);
		ctx.lineTo(0.5, EYE_Y + 0.22);
		ctx.stroke();
		ctx.fillStyle = "#020617";
		circle(ctx, -EYE_X, EYE_Y, 0.14);
		ctx.fill();
	},
	tongue(ctx, t) {
		const length = 0.25 + 0.15 * Math.max(0, Math.sin(t * 5));
		const tip = -0.48 - length;
		ctx.strokeStyle = "#f43f5e";
		ctx.lineWidth = 0.07;
		ctx.lineCap = "round";
		ctx.beginPath();
		ctx.moveTo(0, -0.45);
		ctx.lineTo(0, tip);
		ctx.moveTo(0, tip);
		ctx.lineTo(-0.08, tip - 0.1);
		ctx.moveTo(0, tip);
		ctx.lineTo(0.08, tip - 0.1);
		ctx.stroke();
		ctx.lineCap = "butt";
	},
};

const HEAD: Record<string, Draw> = {
	tophat(ctx) {
		ctx.fillStyle = "#111827";
		circle(ctx, 0, 0.18, 0.3);
		ctx.fill();
		ctx.fillStyle = "#1f2937";
		circle(ctx, 0, 0.18, 0.2);
		ctx.fill();
		ctx.strokeStyle = "#dc2626";
		ctx.lineWidth = 0.05;
		circle(ctx, 0, 0.18, 0.2);
		ctx.stroke();
	},
	crown(ctx) {
		ctx.fillStyle = "#fbbf24";
		ctx.strokeStyle = "#b45309";
		ctx.lineWidth = 0.025;
		ctx.beginPath();
		for (let i = 0; i < 10; i++) {
			const angle = (i / 10) * Math.PI * 2 - Math.PI / 2;
			const r = i % 2 === 0 ? 0.32 : 0.18;
			ctx.lineTo(Math.cos(angle) * r, 0.16 + Math.sin(angle) * r);
		}
		ctx.closePath();
		ctx.fill();
		ctx.stroke();
		ctx.fillStyle = "#e11d48";
		circle(ctx, 0, 0.16, 0.07);
		ctx.fill();
	},
	antennae(ctx, t) {
		const sway = Math.sin(t * 3) * 0.05;
		ctx.strokeStyle = "#1e293b";
		ctx.lineWidth = 0.04;
		ctx.fillStyle = "#a3e635";
		for (const side of [-1, 1]) {
			const tip = [side * 0.36 + sway, -0.62] as const;
			ctx.beginPath();
			ctx.moveTo(side * 0.1, 0.05);
			ctx.quadraticCurveTo(side * 0.12, -0.35, tip[0], tip[1]);
			ctx.stroke();
			circle(ctx, tip[0], tip[1], 0.08);
			ctx.fill();
		}
	},
	propeller(ctx, t) {
		ctx.save();
		ctx.translate(0, 0.16);
		ctx.rotate(t * 9);
		for (const [i, color] of ["#ef4444", "#3b82f6"].entries()) {
			ctx.fillStyle = color;
			ctx.beginPath();
			ctx.ellipse(0, (i === 0 ? -1 : 1) * 0.22, 0.07, 0.2, 0, 0, Math.PI * 2);
			ctx.fill();
		}
		ctx.restore();
		ctx.fillStyle = "#facc15";
		circle(ctx, 0, 0.16, 0.07);
		ctx.fill();
	},
	horns(ctx) {
		ctx.fillStyle = "#f5f5f4";
		ctx.strokeStyle = "#a8a29e";
		ctx.lineWidth = 0.025;
		for (const side of [-1, 1]) {
			ctx.beginPath();
			ctx.moveTo(side * 0.28, 0.0);
			ctx.quadraticCurveTo(side * 0.62, -0.02, side * 0.66, -0.42);
			ctx.quadraticCurveTo(side * 0.5, -0.12, side * 0.3, 0.2);
			ctx.closePath();
			ctx.fill();
			ctx.stroke();
		}
	},
};

export function canDraw(id: string): boolean {
	return id in FACE || id in HEAD;
}

export function drawHeadDetails(
	ctx: Ctx,
	options: {
		cx: number;
		cy: number;
		size: number;
		dir: readonly [number, number];
		accessories: Accessories;
		now: number;
	},
): void {
	const { cx, cy, size, dir, accessories, now } = options;
	const t = now / 1000;

	ctx.save();
	ctx.translate(cx, cy);
	ctx.rotate(Math.atan2(dir[0], -dir[1]));
	ctx.scale(size, size);

	ctx.fillStyle = EYE_COLOR;
	for (const side of [-1, 1]) {
		circle(ctx, side * EYE_X, EYE_Y, EYE_R);
		ctx.fill();
	}
	if (accessories.face) FACE[accessories.face]?.(ctx, t);
	if (accessories.head) HEAD[accessories.head]?.(ctx, t);

	ctx.restore();
}
