# Dockerfile
FROM rust:1.80-slim

# 1) 필수 빌드 도구/헤더
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential pkg-config libssl-dev ca-certificates curl git python3 \
    && rm -rf /var/lib/apt/lists/*

# 2) 전역 설치 경로
ENV RUSTUP_HOME=/usr/local/rustup \
    CARGO_HOME=/usr/local/cargo \
    PATH=/usr/local/cargo/bin:$PATH

# 3) Rust WASM toolchain
RUN rustup target add wasm32-unknown-unknown \
 && cargo install --locked -j 1 wasm-bindgen-cli --version 0.2.95 \
 && cargo install --locked -j 1 wasm-pack --version 0.13.1

# 4) 작업 유저/디렉터리
RUN useradd -m builder && mkdir -p /work && chown -R builder:builder /work \
    && chown -R builder:builder /usr/local/rustup /usr/local/cargo
USER builder
WORKDIR /work

# 5) 빌드 스크립트
COPY --chown=builder:builder build.sh /usr/local/bin/build-wasm
# 윈도우 CRLF 방지
RUN sed -i 's/\r$//' /usr/local/bin/build-wasm && chmod +x /usr/local/bin/build-wasm

CMD ["/usr/local/bin/build-wasm"]
