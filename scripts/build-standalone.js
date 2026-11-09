import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const bundle = await build({
  entryPoints: ["js/main.js"],
  bundle: true,
  minify: true,
  format: "iife",
  target: "es2020",
  write: false,
  legalComments: "none",
});
const script = bundle.outputFiles[0].text.replaceAll("</script", "<\\/script");
const css = await readFile("css/style.css", "utf8");
const html = await readFile("index.html", "utf8");

const standalone = html
  .replace('<link rel="stylesheet" href="css/style.css" />', () => `<style>${css}</style>`)
  .replace('<script type="module" src="js/main.js"></script>', "")
  .replace("</body>", () => `<script>${script}</script>\n  </body>`);

await mkdir("dist", { recursive: true });
await writeFile("dist/frontlines.html", standalone);
console.log(`dist/frontlines.html (${(standalone.length / 1024).toFixed(1)} KB)`);
