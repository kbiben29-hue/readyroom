#!/usr/bin/env bash
# Generates card art for the prompt kit with Codex image generation (your
# ChatGPT login), one card at a time, into vendor/custom/<pack>/override/.
#
#   tools/custom/codex-art.sh 01 02 03        # card folders by number
#
# Needs `npm run custom-cards:kit` first. Afterwards run `npm run custom-cards`.
set -euo pipefail
shopt -s nullglob

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PACK="${PACK:-firefly}"
WORK="$ROOT/vendor/custom/$PACK"
KIT="$WORK/prompt-kit"
CODEX="${CODEX:-/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex}"
mkdir -p "$WORK/override" "$WORK/codex-logs"

for num in "$@"; do
	dir=$(ls -d "$KIT/cards/$num-"* | head -1)
	key=$(sed -n 's/^Save the art as `vendor\/custom\/[^/]*\/override\/\(.*\)\.png`\./\1/p' "$dir/prompt.md")
	prompt=$(awk '/^## A\. Art only/{a=1;next} /^## B\./{a=0} a' "$dir/prompt.md")
	out="$WORK/override/$key.png"
	images=()
	for f in "$KIT"/style/style-*.jpg "$dir"/likeness.*; do images+=(-i "$f"); done
	echo "== $num $key → $out"
	# the prompt goes in on stdin: `-i` takes several files and would swallow it
	refs="The attached images are references: style-1..4 are printed cards whose painted look you must match."
	likeness=("$dir"/likeness.*)
	[ ${#likeness[@]} -gt 0 ] && refs="$refs The last one (likeness) is a still from the series for the subject's likeness."
	printf '%s' "$refs

Use your image generation tool to create exactly one image for this brief:

$prompt

Then save that generated image as the PNG file override/$key.png (relative to the current directory), copying it from wherever the image tool stored it. Do not do anything else, and do not edit any other file." |
		"$CODEX" exec --skip-git-repo-check --cd "$WORK" -s workspace-write "${images[@]}" \
			> "$WORK/codex-logs/$key.log" 2>&1 || echo "   codex exited with $?"
	if [ -f "$out" ]; then echo "   saved $(du -h "$out" | cut -f1)"; else echo "   NO IMAGE — see codex-logs/$key.log"; fi
done
