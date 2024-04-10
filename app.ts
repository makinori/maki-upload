import { crc32, hexToUint8Array } from "crc32";
import { getFreePort } from "free_port";
import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import * as path from "path";
import { base } from "./base-x.js";

const __dirname = path.dirname(path.fromFileUrl(import.meta.url));

const port = parseInt(Deno.env.get("PORT") ?? "8080");
const token = Deno.env.get("TOKEN") ?? "cuteshoes";

const publicPath =
	Deno.env.get("PUBLIC_PATH") ?? path.resolve(__dirname, "public");

let url = Deno.env.get("URL") ?? "http://127.0.0.1:" + port + "/u/";
if (!url.endsWith("/")) url += "/";

await Deno.mkdir(publicPath, { recursive: true });

const router = new Hono();

router.get("/bg/:n{[0-9]+\\.jpg$}", async c => {
	try {
		const { n } = c.req.param();
		const file = await Deno.readFile(
			path.resolve(
				__dirname,
				"bg",
				"complete-" + n.replace(/\.jpg$/, "") + ".jpg",
			),
		);
		c.header("Content-Type", "image/jpeg");
		return c.body(file);
	} catch (error) {
		console.error(error);
		c.status(404);
		return c.json({ error: "Background not found" });
	}
});

const maxImages = 8;

router.get("/", async c => {
	const lastBgCookie = getCookie(c, "lastbg");

	let bgIndex = 0;

	if (lastBgCookie == null) {
		bgIndex = Math.floor(Math.random() * maxImages) + 1;
	} else {
		bgIndex = parseInt(lastBgCookie) + 1;
		if (bgIndex <= 0 || bgIndex > maxImages) {
			bgIndex = 1;
		}
	}

	setCookie(c, "lastbg", String(bgIndex));

	const backgroundUrl = "/u/bg/" + bgIndex + ".jpg";

	let page = await Deno.readTextFile(path.resolve(__dirname, "page.html"));

	const bashScript = await Deno.readTextFile(
		path.resolve(__dirname, "./config/maki-upload.sh"),
	);

	const actionsForNautilusConfig = await Deno.readTextFile(
		path.resolve(__dirname, "./config/actions-for-nautilus-config.json"),
	);

	return c.html(
		page
			.replace(/\[backgroundUrl\]/g, backgroundUrl)
			.replace(/\[bashScript\]/g, bashScript)
			.replace(/\[actionsForNautilusConfig\]/g, actionsForNautilusConfig),
	);
});

// length was usually 6
// const getName = (length: number) =>
// 	new Array(length)
// 		.fill(0)
// 		.map(() => base62[Math.floor(Math.random() * base62.length)])
// 		.join("");

const base62 = base(
	"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
);

const getName = (content: Uint8Array) =>
	base62.encode(hexToUint8Array(crc32(content)));

const isFile = (any: any) =>
	any != null &&
	typeof any == "object" &&
	{}.toString.call(any) == "[object File]";

router.post("/api/upload", async c => {
	const body = await c.req.parseBody();

	if (body.token != token) {
		c.status(400);
		return c.json({ error: "Invalid token" });
	}

	let files: File[] = [];

	for (const key of ["files", "files[]"]) {
		const value: any = body[key];
		if (value == null) continue;

		if (Array.isArray(body[key])) {
			for (const file of value) {
				if (isFile(file)) files.push(file);
			}
		} else {
			if (isFile(value)) files.push(value);
		}
	}

	let out = [];

	for (const file of files) {
		const ext = file.name.split(".").pop();
		const content = new Uint8Array(await file.arrayBuffer());

		const filename = getName(content) + "." + ext;

		await Deno.writeFile(path.resolve(publicPath, filename), content);

		out.push(url + filename);
	}

	return c.json(out);
});

/*
router.get(":filename", async c => {
	const { filename } = c.req.param();

	const filePath = path.resolve(publicPath, filename);

	try {
		const file = await Deno.open(filePath);

		let mimeType = "";
		if (filePath.endsWith(".ts")) {
			mimeType = "text/plain";
		} else {
			mimeType = getMimeType(filePath);
		}
		
		if (mimeType) {
			c.header("Content-Type", mimeType);
		}

		return c.body(file.readable);
	} catch (error) {
		console.error(error);
		c.status(404);
		return c.json({ error: "File not found" });
	}
});
*/

const app = new Hono();

app.route("/u/", router);

app.get("/favicon.ico", c => {
	c.status(404);
	return c.body(null);
});

app.get("*", c => {
	return c.redirect("/u/");
});

const apiPort = await getFreePort(50000);

Deno.serve({ port: apiPort }, app.fetch);

// start caddy server

const apiPaths = ["/u", "/u/", "/u/bg/*", "/u/api/upload"];

const caddyConfig = `
:${port} {
	${apiPaths
		.map(
			path => `handle ${path} {
				reverse_proxy 127.0.0.1:${apiPort}
			}`,
		)
		.join("\n")}

	handle_path /u/* {
		root * "${publicPath}"
		file_server
	}

	# need error message if file doesnt exist
}
`.trim();

// console.log(caddyConfig);

console.log(`Starting Caddy server on http://localhost:${port}/u/\n`);

const command = new Deno.Command("caddy", {
	args: ["run", "--adapter", "caddyfile", "--config", "-"],
	stdin: "piped",
	stdout: "inherit",
});

const child = command.spawn();

const childStdin = child.stdin.getWriter();
await childStdin.write(new TextEncoder().encode(caddyConfig));
await childStdin.close();
