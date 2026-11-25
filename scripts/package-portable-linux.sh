#!/usr/bin/env bash
set -euo pipefail

if [[ $(uname -s) != Linux || $(uname -m) != x86_64 ]]; then
  printf 'The Linux portable package must be built on Linux x86-64.\n' >&2
  exit 1
fi

repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd -- "$repo_root"

output="$repo_root/out/linux-latest"
archive="Tandnevis-linux-x64.tar.gz"
package_dir="Tandnevis-linux-x64"
marker="portable-data-v1"

export CARGO_TARGET_DIR="$repo_root/src-tauri/target"
npm run desktop:build -- --no-bundle -- --locked

binary="$CARGO_TARGET_DIR/release/shorthand-writer"
if [[ ! -x "$binary" ]] || ! LC_ALL=C grep -aFq -- "$marker" "$binary"; then
  printf 'The release binary is missing or lacks the portable-data-v1 runtime contract.\n' >&2
  exit 1
fi

mkdir -p -- "$output"
stage=$(mktemp -d "$output/.stage.XXXXXXXX")
trap 'rm -rf -- "$stage"' EXIT
mkdir -- "$stage/$package_dir"
install -m 755 -- "$binary" "$stage/$package_dir/tandnevis"
printf '%s\n' "$marker" > "$stage/$package_dir/portable.mode"
cat > "$stage/$package_dir/README.txt" <<'EOF'
Tandnevis for Linux x86-64

Extract the archive to a writable folder and run ./tandnevis inside it.
Keep portable.mode beside the executable.

The app uses your system's GTK 3 and WebKitGTK 4.1 libraries. On Ubuntu 22.04
or Debian 12, install libwebkit2gtk-4.1-0 if it is missing. Other distributions
provide WebKitGTK 4.1 through their package managers.
GitHub release builds use Ubuntu 22.04 as the baseline. Local builds can
require newer system libraries.

Tandnevis stores portable settings and recovery data in the data folder beside
the executable. Back up your separately saved .shorthand project files as well.
To update, save and close the app, then keep data and your project files.

ChatGPT generation is available in supported Windows builds.
EOF

tar -czf "$stage/$archive" -C "$stage" -- "$package_dir"
(cd -- "$stage" && sha256sum -- "$archive" > "$archive.sha256")

for name in tandnevis portable.mode README.txt; do
  mv -fT -- "$stage/$package_dir/$name" "$output/$name"
done
mv -fT -- "$stage/$archive" "$output/$archive"
mv -fT -- "$stage/$archive.sha256" "$output/$archive.sha256"

printf 'Latest app: %s\nPortable archive: %s\nSHA-256: %s\n' \
  "$output/tandnevis" "$output/$archive" "$output/$archive.sha256"
