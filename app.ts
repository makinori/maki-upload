import * as path from "https://deno.land/std@0.134.0/path/mod.ts";
import {
	getCookie,
	setCookie,
} from "https://deno.land/x/hono@v3.10.0/helper/cookie/index.ts";
import { serveStatic } from "https://deno.land/x/hono@v3.10.0/middleware.ts";
import { Hono } from "https://deno.land/x/hono@v3.10.0/mod.ts";
import { getMimeType } from "https://deno.land/x/hono@v3.10.0/utils/mime.ts";

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

	return c.html(page.replace(/\[backgroundUrl\]/g, backgroundUrl));
});

const base62 =
	"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".split("");

const getName = (length: number) =>
	new Array(length)
		.fill(0)
		.map(() => base62[Math.floor(Math.random() * base62.length)])
		.join("");

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
		const content = await file.arrayBuffer();

		const filename = getName(6) + "." + ext;

		await Deno.writeFile(
			path.resolve(publicPath, filename),
			new Uint8Array(content),
		);

		out.push(url + filename);
	}

	return c.json(out);
});

router.get(":filename", async c => {
	const { filename } = c.req.param();

	const filePath = path.resolve(publicPath, filename);

	try {
		const file = await Deno.open(filePath);

		const mimeType = getMimeType(filePath);
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

const app = new Hono();

app.route("/u/", router);

app.get("/favicon.ico", c => {
	c.status(404);
	return c.body(null);
});

app.get("*", c => {
	return c.redirect("/u/");
});

Deno.serve({ port }, app.fetch);
