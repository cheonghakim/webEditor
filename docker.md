
# 이미지 생성
podman --connection podman-machine-default-root build -t localhost/rust-wasm-builder:1 -f Dockerfile .

# 컨테이너 실행 테스트
$pwdPath = (Get-Location).Path
podman --connection podman-machine-default-root run --rm --pull=never -v "${pwdPath}:/work" localhost/rust-wasm-builder:1 /usr/local/bin/build-wasm --help

# 컨테이너 진입
podman --connection podman-machine-default-root run --rm -it -v "$(pwd):/work" localhost/rust-wasm-builder:1 sh