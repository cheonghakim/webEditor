// app.js
import express from "express";
import crypto from "node:crypto";
import { execFile, execSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "url";
import os from "node:os";
import rateLimit from "express-rate-limit";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const run = promisify(execFile);
const app = express();
app.use(express.json({ limit: "200kb" }));

// ---- 환경 설정 ----
const ROOT = path.join(os.tmpdir(), "editor-builds"); // Win에서 실제 존재하는 경로
await fs.mkdir(ROOT, { recursive: true });

const BUILD_TIMEOUT = Number(process.env.BUILD_TIMEOUT_MS || 300_000); // 5분

// Podman 실행 파일 경로 자동 탐색 (서비스/다른 셸에서도 안전)
function resolveBin(name) {
  try {
    const cmd = process.platform === "win32" ? "where" : "which";
    return execSync(`${cmd} ${name}`)
      .toString()
      .split(/\r?\n/)
      .find(Boolean)
      ?.trim();
  } catch {
    return null;
  }
}
const PODMAN = process.env.PODMAN_PATH || resolveBin("podman") || "podman";
const PODMAN_CONNECTION =
  process.env.PODMAN_CONNECTION || "podman-machine-default-root";
// 필요 시 환경변수로 고정: setx PODMAN_HOST "ssh://root@127.0.0.1:PORT/run/podman/podman.sock"

// ---- 정적 리소스 ----
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// 산출물 서빙 (/artifact/<key>/out/*)
// 서버에 남겨두세요 (이미지/wasm/js 서빙)
app.use(
  "/artifact",
  express.static(ROOT, {
    fallthrough: false,
    setHeaders(res, filePath) {
      // CORS 열 필요는 없지만 열어두어도 무방
      res.setHeader("Access-Control-Allow-Origin", "*");
      if (filePath.endsWith(".wasm")) res.type("application/wasm");
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    },
  })
);

// 서버 쪽 (임시 메모리 저장소)
const previews = new Map();

app.post("/preview", express.text({ type: "*/*" }), (req, res) => {
  const id = crypto.randomBytes(8).toString("hex");
  previews.set(id, req.body);
  res.json({ id });
});

app.get("/preview/:id", (req, res) => {
  const html = previews.get(req.params.id);
  if (!html) return res.sendStatus(404);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(html);
});

// 간단 요청 제한 (폭주 방지)
app.use(
  "/compile",
  rateLimit({
    windowMs: 10_000,
    max: 8,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

// 주기적 청소 (24시간 지난 작업물 제거)
const TTL_MS = 24 * 60 * 60 * 1000;
setInterval(async () => {
  try {
    const entries = await fs.readdir(ROOT, { withFileTypes: true });
    const now = Date.now();
    await Promise.all(
      entries.map(async (e) => {
        if (!e.isDirectory()) return;
        const full = path.join(ROOT, e.name);
        const st = await fs.stat(full);
        if (now - st.mtimeMs > TTL_MS) {
          await fs.rm(full, { recursive: true, force: true });
        }
      })
    );
  } catch {}
}, 60_000).unref();

// rustfmt (없으면 원문 반환)
app.post("/format", async (req, res) => {
  const code = req.body.code || "";
  try {
    const { stdout } = await run("rustfmt", ["--emit", "stdout"], {
      input: code,
    });
    res.json({ formatted: stdout });
  } catch {
    res.json({ formatted: code });
  }
});

// 컴파일 엔드포인트
app.post("/compile", async (req, res) => {
  try {
    // 1) 사용자 코드 수신 + 최소 검증/보정
    let userSrc = String(req.body?.source || "").trim();
    if (!userSrc.includes("#[wasm_bindgen]")) {
      return res
        .status(400)
        .json({ ok: false, error: "Add #[wasm_bindgen] exports." });
    }
    if (
      userSrc.includes("#[wasm_bindgen]") &&
      !/use\s+wasm_bindgen::prelude/.test(userSrc)
    ) {
      userSrc = `use wasm_bindgen::prelude::*;\n\n${userSrc}`;
    }

    // 2) 동일 소스 캐시 키
    const key = crypto
      .createHash("sha256")
      .update(userSrc)
      .digest("hex")
      .slice(0, 16);

    const workDir = path.join(ROOT, key);
    const srcDir = path.join(workDir, "crate");
    const outDir = path.join(workDir, "out");

    // 캐시 히트
    try {
      const st = await fs.stat(path.join(outDir, "hello_wasm.js"));
      if (st.isFile()) {
        return res.json({ ok: true, baseUrl: `/artifact/${key}/out` });
      }
    } catch {}

    // 3) 원자적 빌드 (경합 방지)
    const tmpDir = path.join(
      ROOT,
      `${key}.tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`
    );
    const tmpSrc = path.join(tmpDir, "crate");
    const tmpOut = path.join(tmpDir, "out");
    await fs.rm(tmpDir, { recursive: true, force: true });
    await fs.mkdir(path.join(tmpSrc, "src"), { recursive: true });

    // Cargo.toml
    await fs.writeFile(
      path.join(tmpSrc, "Cargo.toml"),
      `[package]
name = "hello_wasm"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[dependencies]
wasm-bindgen = "0.2.95"
console_error_panic_hook = "0.1"
`,
      "utf8"
    );

    // src/lib.rs (사용자 코드)
    await fs.writeFile(path.join(tmpSrc, "src", "lib.rs"), userSrc, "utf8");

    // 4) Podman 실행 준비
    const hostWorkDir = tmpDir; // Windows 경로 그대로 사용
    const cargoReg = path.join(ROOT, "_cargoRegistry");
    const cargoGit = path.join(ROOT, "_cargoGit");
    await fs.mkdir(cargoReg, { recursive: true });
    await fs.mkdir(cargoGit, { recursive: true });

    const args = [
      "--connection",
      PODMAN_CONNECTION,
      "run",
      "--rm",
      "--cpus",
      "1",
      "--memory",
      "512m",
      "--pids-limit",
      "256",
      "-v",
      `${hostWorkDir}:/work`,
      "-v",
      `${cargoReg}:/usr/local/cargo/registry`,
      "-v",
      `${cargoGit}:/usr/local/cargo/git`,
      "--pull=never",
      "localhost/rust-wasm-builder:1",
      "/usr/local/bin/build-wasm",
    ];

    // 5) 실행
    try {
      console.log("podman bin:", PODMAN);
      console.log("podman args:", args.join(" "));
      await run(PODMAN, args, {
        timeout: BUILD_TIMEOUT,
        env: { ...process.env }, // 필요 시 PODMAN_HOST 고정 가능
      });
    } catch (error) {
      console.error("STDERR:", error?.stderr?.toString?.() ?? error?.stderr);
      console.error("STDOUT:", error?.stdout?.toString?.() ?? error?.stdout);
      throw new Error(
        "Compile failed:\n" +
          (
            error?.stderr?.toString?.() ||
            error?.stdout?.toString?.() ||
            String(error)
          ).slice(0, 12000)
      );
    }

    // 6) 산출물 확인
    const built = await fs
      .stat(path.join(tmpOut, "hello_wasm.js"))
      .then(() => true)
      .catch(() => false);
    if (!built) throw new Error("Build succeeded but hello_wasm.js not found.");

    // 7) 원자적 승격
    await fs.rm(workDir, { recursive: true, force: true });
    await fs.mkdir(path.dirname(workDir), { recursive: true });
    await fs.rename(tmpDir, workDir);

    return res.json({ ok: true, baseUrl: `/artifact/${key}/out` });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: "Compile failed",
      detail: String(e).slice(0, 12000),
    });
  }
});

app.listen(8787, () => console.log("compile server on :8787"));
