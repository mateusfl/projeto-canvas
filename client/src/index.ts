import index from "./index.html";

const PORT = Number(process.env.CLIENT_PORT ?? 5173);
const HOST = process.env.CLIENT_HOST ?? "0.0.0.0";

const server = Bun.serve({
	hostname: HOST,
	port: PORT,
	routes: { "/": index },
	development: process.env.NODE_ENV !== "production" && {
		hmr: true,
		console: true,
	},
	fetch() {
		return new Response("Not Found", { status: 404 });
	},
});

console.log(`Cliente em http://localhost:${server.port}`);
