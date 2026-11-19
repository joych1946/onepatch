/**
 * 빌드 전에 public/sw.js를 만든다 (npm run build의 prebuild).
 * 버전 = Vercel 커밋 SHA → git 커밋 → 시각. 버전이 바뀌면 브라우저가 새 서비스 워커를 받아 "새 버전" 안내를 띄운다.
 */
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const git = () => {
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "";
  }
};
const sha = (process.env.VERCEL_GIT_COMMIT_SHA ?? "").slice(0, 7) || git();
const version = `${sha || "local"}-${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12)}`;
const routes = readFileSync(new URL("../src/lib/routes.ts", import.meta.url), "utf8");
const pages = JSON.parse(routes.match(/APP_PAGES = (\[[^\]]*\])/)[1].replace(/'/g, '"'));
const out = readFileSync(new URL("./sw.template.js", import.meta.url), "utf8")
  .replace("__VERSION__", version)
  .replace("__PAGES__", JSON.stringify(pages));
writeFileSync(new URL("../public/sw.js", import.meta.url), out);
console.log(`sw.js ${version} (${pages.join(", ")})`);
