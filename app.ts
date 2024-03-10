import * as path from "https://deno.land/std@0.134.0/path/mod.ts";
import {
	opine,
	Router,
	serveStatic,
} from "https://deno.land/x/opine@2.1.5/mod.ts";
import { MultipartReader } from "https://deno.land/std@0.134.0/mime/mod.ts";
import { Base64 } from "https://deno.land/x/bb64@1.1.0/mod.ts";

const __dirname = path.dirname(path.fromFileUrl(import.meta.url));

const port = parseInt(Deno.env.get("PORT") ?? "8080");
const token = Deno.env.get("TOKEN") ?? "cuteshoes";
const publicPath =
	Deno.env.get("PUBLIC_PATH") ?? path.resolve(__dirname, "public");

const app = opine();
const router = Router();

router.get("/bg/:n.jpg", async (req, res) => {
	try {
		const file = await Deno.readFile(
			path.resolve(__dirname, "bg", "complete-" + req.params.n + ".jpg"),
		);
		res.setHeader("Content-Type", "image/jpeg").send(file);
	} catch (error) {
		res.setStatus(404).send({ error: "Background not found" });
	}
});

const maxImages = 8;

router.get("/", async (req, res) => {
	const lastBackgroundMatches = (req.headers.get("Cookie") ?? "").match(
		/lastbg=([0-9]+)(?:;|$)/,
	);

	let backgroundIndex = 0;

	if (lastBackgroundMatches == null) {
		backgroundIndex = Math.floor(Math.random() * maxImages) + 1;
	} else {
		backgroundIndex = parseInt(lastBackgroundMatches[1]) + 1;
		if (backgroundIndex <= 0 || backgroundIndex > maxImages) {
			backgroundIndex = 1;
		}
	}

	const backgroundUrl = "/u/bg/" + backgroundIndex + ".jpg";

	let page = await Deno.readTextFile(path.resolve(__dirname, "page.html"));

	res.send(page.replace(/\[backgroundUrl\]/g, backgroundUrl));
});

const base62 =
	"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".split("");

const getName = (length: number) =>
	new Array(length)
		.fill(0)
		.map(() => base62[Math.floor(Math.random() * base62.length)])
		.join("");

router.post("/api/upload", async (req, res) => {
	const boundaryMatches = (req.headers.get("Content-Type") ?? "").match(
		/boundary=([^]+?)(?:$|;)/i,
	);

	if (boundaryMatches == null)
		return res
			.setStatus(400)
			.send({ error: "No boundary sent with multipart" });

	const boundary = boundaryMatches[1];
	const reader = new MultipartReader(req.body, boundary);
	const form = await reader.readForm();

	if (form.values("token")?.[0] != token) {
		return res.setStatus(400).send({ error: "Invalid token" });
	}

	const files = form.files("files");
	if (files == null) {
		return res.setStatus(400).send({ error: "No files sent" });
	}

	let out = [];

	for (const file of files) {
		const ext = file.filename.split(".").pop();
		const content = file.content ?? new Uint8Array();

		// const filename =
		// 	base(base62).encode(
		// 		new Uint8Array(new Md5().update(content).digest()),
		// 	) +
		// 	"." +
		// 	ext;

		const filename = getName(6) + "." + ext;

		await Deno.writeFile(path.resolve(publicPath, filename), content);

		out.push("https://makidoll.io/u/" + filename);
	}

	res.send(out);
});

app.use("/u/", router);
app.use("/u/", serveStatic(publicPath));

app.get("*", (req, res) => {
	res.redirect("/u/");
});

app.listen(port, () =>
	console.log("Server running on http://127.0.0.1:" + port),
);
