import express from "express";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "url";
import os from "node:os";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const run = promisify(execFile);
const app = express();
app.use(express.json({ limit: "200kb" }));

const ROOT = path.join(os.tmpdir(), "editor-builds");
await fs.mkdir(ROOT, { recursive: true });

app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.post("/compile", async (req, res) => {
  try {
    const userSrc = String(req.body?.source || "");
    if (!userSrc.includes("#[wasm_bindgen]")) {
      return res
        .status(400)
        .json({ ok: false, error: "Add #[wasm_bindgen] exports." });
    }

    // 동일 소스 캐시
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
      if (st.isFile())
        return res.json({ ok: true, baseUrl: `/artifact/${key}/out` });
    } catch {}

    // 새 작업 디렉터리 구성
    await fs.rm(workDir, { recursive: true, force: true });
    await fs.mkdir(path.join(srcDir, "src"), { recursive: true });

    // Cargo.toml
    await fs.writeFile(
      path.join(srcDir, "Cargo.toml"),
      `[package]
name = "hello_wasm"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[dependencies]
wasm-bindgen = "0.2.95"
console_error_panic_hook = "0.1"
# web-sys 예: features = ["Window","Document"]
`,
      "utf8"
    );

    // src/lib.rs (사용자 코드)
    await fs.writeFile(path.join(srcDir, "src", "lib.rs"), userSrc, "utf8");

    // Windows 경로를 podman 볼륨 마운트용으로 슬래시 전환
    const hostWorkDir = workDir; // 그대로 Windows 경로 사용 (예: C:\Users\...\editor-builds\abcd...)

    // 도커 실행 (보안/리소스 제한 옵션 예시 포함)
    const args = [
      "--connection",
      "podman-machine-default-root",
      "run",
      "--rm",
      // 첫 빌드(의존성 받아올 때)는 네트워크 필요! none 제거
      "--cpus",
      "1",
      "--memory",
      "512m",
      "--pids-limit",
      "256",
      "-v",
      `${hostWorkDir}:/work`,
      // 로컬 이미지 강제 사용
      "--pull=never",
      "localhost/rust-wasm-builder:1",
      "/usr/local/bin/build-wasm",
    ];

    try {
      await run("podman", args, {
        timeout: 180_000,
        env: { ...process.env, PODMAN_HOST: process.env.PODMAN_HOST },
      });
    } catch (error) {
      console.error("STDERR:", error?.stderr?.toString?.() ?? error?.stderr);
      console.error("STDOUT:", error?.stdout?.toString?.() ?? error?.stdout);
      throw error;
    }

    // out/ 에 hello_wasm.js 가 있으면 성공
    const ok = await fs
      .stat(path.join(outDir, "hello_wasm.js"))
      .then(() => true)
      .catch(() => false);
    if (!ok) throw new Error("Build succeeded but hello_wasm.js not found.");

    return res.json({ ok: true, baseUrl: `/artifact/${key}/out` });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e) });
  }
});

app.post("/format", async (req, res) => {
  const code = req.body.code || "";
  const { stdout } = await run("rustfmt", ["--emit", "stdout"], {
    input: code,
  });
  res.json({ formatted: stdout });
});

// 정적 서빙: pkg 산출물
app.use("/artifact", express.static(ROOT, { fallthrough: false }));

app.listen(8787, () => console.log("compile server on :8787"));
