#!/usr/bin/env bash
# Generate one raw image with Codex's imagegen skill (built-in image_gen tool).
# Usage: tools/codex-image.sh <asset-name> [reference.png ...]
# Reads art/prompts/_style.txt + art/prompts/<asset-name>.txt, writes art/raw/<asset-name>.png.
set -euo pipefail

asset_name="$1"
shift

project_dir="$(cd "$(dirname "$0")/.." && pwd)"
output_path="art/raw/${asset_name}.png"
log_path="art/raw/${asset_name}.log"
image_args=()
for reference in "$@"; do image_args+=(-i "$reference"); done

prompt="Use the \$imagegen skill with the built-in image_gen tool to create exactly one image from this spec.
$( [[ $# -gt 0 ]] && echo "Input image 1 is a style reference only: match its pixel size, palette, outline weight and lighting. Do not copy its subject or composition." )

$(cat "$project_dir/art/prompts/_style.txt")

$(cat "$project_dir/art/prompts/${asset_name}.txt")

After generating, copy the PNG to ${output_path} (relative to ${project_dir}). Do not write code and do not edit any other file."

cd "$project_dir"
codex exec -s workspace-write -C "$project_dir" --skip-git-repo-check "${image_args[@]}" -- "$prompt" >"$log_path" 2>&1

if [[ ! -f "$output_path" ]]; then
  # Codex stores each session's images under generated_images/<session id>/. Use this run's newest one.
  session_id="$(grep -m1 -oE 'session id: [0-9a-f-]+' "$log_path" | cut -d' ' -f3)"
  newest="$(ls -t "$HOME/.codex/generated_images/$session_id"/*.png 2>/dev/null | head -n 1)"
  if [[ -z "$newest" ]]; then
    echo "no image produced for $asset_name; see $log_path" >&2
    exit 1
  fi
  cp "$newest" "$output_path"
fi
echo "wrote $output_path"
