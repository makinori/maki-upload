import { crc32, hexToUint8Array } from "crc32";
import { getFreePort } from "free_port";
import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { getMimeType } from "hono/mime";
import * as path from "path";
import { base } from "./base-x.js";

const __dirname = path.dirname(path.fromFileUrl(import.meta.url));

const port = parseInt(Deno.env.get("PORT") ?? "8080");
const token = Deno.env.get("TOKEN") ?? "cuteshoes";

const publicPath =
	Deno.env.get("PUBLIC_PATH") ?? path.resolve(__dirname, "public");

await Deno.mkdir(publicPath, { recursive: true });

const router = new Hono();

const bgNames = [
	"boat.gif",
	"busy_train.gif",
	"calm_train.gif",
	"deer.gif",
	"fish_pond.gif",
	"fish_shop.gif",
	"girls.gif",
	"girls_waiting.gif",
	"home.gif",
	"pets.gif",
	"rainbow_dog.gif",
	"river.gif",
	"sakura.gif",
	"shore.gif",
	"take_away.gif",
];

router.get("/bg/:filename", async c => {
	try {
		const { filename } = c.req.param();
		const file = await Deno.readFile(
			path.resolve(__dirname, "bg-gifs", filename),
		);
		c.header("Content-Type", getMimeType(filename));
		return c.body(file);
	} catch (error) {
		console.error(error);
		c.status(404);
		return c.json({ error: "Background not found" });
	}
});

function renderText(text: string, variables: { [key: string]: string }) {
	for (const [key, value] of Object.entries(variables)) {
		text = text.replaceAll(`[${key}]`, value);
	}
	return text;
}

async function getConfig(
	name: string,
	variables: { [key: string]: string } = {},
) {
	return renderText(
		await Deno.readTextFile(path.resolve(__dirname, "./config/", name)),
		variables,
	);
}

/*
function getNextBg(lastBg: string | undefined): [string, number] {
	const maxImages = 8;

	let bgIndex = 0;

	if (lastBg == null) {
		bgIndex = Math.floor(Math.random() * maxImages) + 1;
	} else {
		bgIndex = parseInt(lastBg) + 1;
		if (bgIndex <= 0 || bgIndex > maxImages) bgIndex = 1;
	}

	return ["/u/bg/complete-" + bgIndex + ".jpg", bgIndex];
}
*/

function getNextBg(lastBg: string | undefined): [string, number] {
	let bgIndex = 0;

	if (lastBg == null) {
		bgIndex = Math.floor(Math.random() * bgNames.length);
	} else {
		bgIndex = parseInt(lastBg) + 1;
		if (bgIndex < 0 || bgIndex >= bgNames.length) bgIndex = 1;
	}

	return ["/u/bg/" + bgNames[bgIndex], bgIndex];
}

router.get("/", async c => {
	const [backgroundUrl, bgIndex] = getNextBg(getCookie(c, "lastbg"));
	setCookie(c, "lastbg", String(bgIndex));

	const page = await Deno.readTextFile(path.resolve(__dirname, "page.html"));

	const vars = {
		siteDomain: new URL(c.req.url).hostname,
	};

	return c.html(
		renderText(page, {
			backgroundUrl,
			bashScript: await getConfig("maki-upload.sh", vars),
			nautilusConfig: await getConfig(
				"actions-for-nautilus-config.json",
				vars,
			),
			dolphinConfig: await getConfig("maki-upload.desktop", vars),
			sharexConfig: await getConfig("sharex.json", vars),
		}),
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

	const siteUrl = new URL(c.req.url).origin + "/u/";

	for (const file of files) {
		const ext = file.name.split(".").pop();
		const content = new Uint8Array(await file.arrayBuffer());

		const filename = getName(content) + "." + ext;

		await Deno.writeFile(path.resolve(publicPath, filename), content);

		out.push(siteUrl + filename);
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
