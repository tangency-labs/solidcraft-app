#!/usr/bin/env bash
# Puts the web build of the current release of $CHANNEL (stable or rc) into <site>.
set -euo pipefail
site="${1:?site directory required}"

# Version order, newest last: 0.31.0-rc.2 sorts after 0.31.0-rc.1 and before 0.31.0.
version_sort() { sed 's/-/~/' | sort -V | sed 's/~/-/'; }

stable="$(gh api "repos/$SOURCE/releases?per_page=100" \
  --jq '[.[] | select(.draft == false and .prerelease == false)][0].tag_name // empty')"
test -n "$stable"
tag="$stable"
if [ "$CHANNEL" = rc ]; then
  tag="$(gh api "repos/$SOURCE/releases?per_page=100" \
    --jq '.[] | select(.draft == false and .prerelease == true) | .tag_name' \
    | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+-rc\.[0-9]+$' | version_sort | tail -n1 || true)"
  if [ -n "$tag" ] && [ "$(printf '%s\n%s\n' "${stable#v}" "${tag#v}" | version_sort | tail -n1)" = "${stable#v}" ]; then
    tag=""
  fi
fi
wanted="${tag:-none}"
echo "wanted: $wanted"

if [ -n "${PAGE_URL:-}" ] && [ "${FORCE:-false}" != true ]; then
  live="$(curl -fsSL --max-time 20 "$PAGE_URL/release-tag.txt" 2>/dev/null || true)"
  if [ "$live" = "$wanted" ]; then
    echo "$wanted is already live"
    echo "changed=false" >>"$GITHUB_OUTPUT"
    exit 0
  fi
fi

mkdir -p "$site"
if [ -n "$tag" ]; then
  tmp="$(mktemp -d)"
  gh release download "$tag" --repo "$SOURCE" --pattern "solidcraft-web-*.zip" --pattern SHA256SUMS.txt --dir "$tmp"
  zip="$(find "$tmp" -name 'solidcraft-web-*.zip' | head -n1)"
  test -n "$zip"
  (cd "$tmp" && grep -E "[ *]$(basename "$zip")\$" SHA256SUMS.txt | sha256sum --check --strict)
  unzip -q "$zip" -d "$tmp/unpacked"
  cp -R "$tmp"/unpacked/*/. "$site"/
  test -s "$site/index.html"
  test -s "$site/sw.js"
else
  cat >"$site/index.html" <<'HTML'
<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>SolidCraft release candidate</title><style>body{font:16px/1.5 system-ui,sans-serif;max-width:36rem;margin:15vh auto;padding:0 16px}</style></head><body><h1>No release candidate right now</h1><p><a href="https://app.solidcraft.io/">Open SolidCraft</a> or <a href="https://solidcraft.io/download/">see the downloads</a>.</p></body></html>
HTML
fi
if [ "$CHANNEL" = rc ]; then
  printf 'User-agent: *\nDisallow: /\n' >"$site/robots.txt"
fi
printf '%s' "$wanted" >"$site/release-tag.txt"
echo "changed=true" >>"$GITHUB_OUTPUT"
