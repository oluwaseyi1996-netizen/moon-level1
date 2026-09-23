#!/usr/bin/env bash
# Install the official Compact toolchain at a pinned version.
#
#   ./scripts/install-compact.sh
#
# Downloads the `compact` toolchain manager from the official GitHub release,
# verifies its SHA-256 checksum, installs it to $HOME/.local/bin, and then asks
# it to fetch the pinned compiler version.
#
# Override with environment variables:
#   COMPACT_MANAGER_VERSION  (default: 0.5.2)  - the `compact` manager release
#   COMPACT_VERSION          (default: 0.31.1) - the compiler version to install
#   COMPACT_INSTALL_DIR      (default: $HOME/.local/bin)

set -euo pipefail

COMPACT_MANAGER_VERSION="${COMPACT_MANAGER_VERSION:-0.5.2}"
COMPACT_VERSION="${COMPACT_VERSION:-0.31.1}"
COMPACT_INSTALL_DIR="${COMPACT_INSTALL_DIR:-$HOME/.local/bin}"

REPO="midnightntwrk/compact"
TAG="compact-v${COMPACT_MANAGER_VERSION}"

case "$(uname -s)-$(uname -m)" in
  Linux-x86_64)   ASSET="compact-x86_64-unknown-linux-musl" ;;
  Linux-aarch64)  ASSET="compact-aarch64-unknown-linux-musl" ;;
  Darwin-x86_64)  ASSET="compact-x86_64-apple-darwin" ;;
  Darwin-arm64)   ASSET="compact-aarch64-apple-darwin" ;;
  *)
    echo "Unsupported platform: $(uname -s) $(uname -m)" >&2
    echo "Install the Compact toolchain manually from https://github.com/${REPO}/releases" >&2
    exit 1
    ;;
esac

BASE_URL="https://github.com/${REPO}/releases/download/${TAG}"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "${WORK_DIR}"' EXIT

echo "==> Downloading ${ASSET} (${TAG})"
# Keep the upstream asset filename: the published .sha256 file references it.
curl -sSLf -o "${WORK_DIR}/${ASSET}.tar.xz"      "${BASE_URL}/${ASSET}.tar.xz"
curl -sSLf -o "${WORK_DIR}/${ASSET}.tar.xz.sha256" "${BASE_URL}/${ASSET}.tar.xz.sha256"

echo "==> Verifying checksum"
( cd "${WORK_DIR}" && sha256sum -c "${ASSET}.tar.xz.sha256" ) || {
  echo "Checksum verification FAILED - refusing to install." >&2
  exit 1
}

echo "==> Extracting"
tar -xJf "${WORK_DIR}/${ASSET}.tar.xz" -C "${WORK_DIR}"

mkdir -p "${COMPACT_INSTALL_DIR}"
install -m 0755 "${WORK_DIR}/${ASSET}/compact" "${COMPACT_INSTALL_DIR}/compact"

echo "==> Installing compiler ${COMPACT_VERSION} via the manager"
# `compact update` writes into $COMPACT_DIRECTORY (default: $HOME/.compact).
"${COMPACT_INSTALL_DIR}/compact" update "${COMPACT_VERSION}"

echo
echo "Compact toolchain ready."
echo "  manager : ${COMPACT_INSTALL_DIR}/compact  ($("${COMPACT_INSTALL_DIR}/compact" --version))"
echo "  compiler: ${COMPACT_VERSION}  (language $( "$HOME/.compact/versions/${COMPACT_VERSION}"/*/compactc.bin --language-version 2>/dev/null || echo '?'), runtime $( "$HOME/.compact/versions/${COMPACT_VERSION}"/*/compactc.bin --runtime-version 2>/dev/null || echo '?'))"
echo
echo "Ensure ${COMPACT_INSTALL_DIR} is on your PATH, then run: npm run compact"
