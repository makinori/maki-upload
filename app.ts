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

router.get("/", async (req, res) => {
	const backgroundDataUri =
		"data:image/jpeg;base64," +
		Base64.fromUint8Array(
			await Deno.readFile(path.resolve(__dirname, "complete-7.jpg")),
		).toString();

	let page = await Deno.readTextFile(path.resolve(__dirname, "page.html"));

	res.send(page.replace(/\[backgroundDataUri\]/g, backgroundDataUri));
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

		out.push("https://maki.cafe/u/" + filename);
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
