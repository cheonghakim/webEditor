#!/usr/bin/env bash
set -euo pipefail

WORK_DIR="${WORK_DIR:-/work}"
# CRATE_DIR을 넘기면 그걸 우선, 안 넘기면 자동 탐색
CRATE_DIR="${CRATE_DIR:-}"

if [ -z "${CRATE_DIR}" ]; then
  if [ -f "${WORK_DIR}/Cargo.toml" ]; then
    CRATE_DIR="${WORK_DIR}"
  elif [ -f "${WORK_DIR}/crate/Cargo.toml" ]; then
    CRATE_DIR="${WORK_DIR}/crate"
  else
    # 깊이 2까지 첫 번째 Cargo.toml 탐색
    CANDIDATE="$(find "${WORK_DIR}" -maxdepth 2 -type f -name Cargo.toml | head -n1 || true)"
    if [ -n "${CANDIDATE}" ]; then
      CRATE_DIR="$(dirname "${CANDIDATE}")"
    else
      echo "❌ Cargo.toml을 /work 하위에서 찾지 못했습니다." >&2
      exit 1
    fi
  fi
fi

echo "🔨 Building crate at: ${CRATE_DIR}"
which wasm-pack
rustup target list --installed | grep -q wasm32-unknown-unknown || rustup target add wasm32-unknown-unknown

# 바로 out 디렉토리로 내보내기
OUT_DIR="${WORK_DIR}/out"
rm -rf "${OUT_DIR}"
wasm-pack build "${CRATE_DIR}" --release --target web --out-dir "${OUT_DIR}"

ls -al "${OUT_DIR}"
echo "✅ Done"
