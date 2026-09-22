#!/usr/bin/env bash
# Prints the versions of every loader artifact the mod build needs. Runs on a CI
# runner because the public mavens are not reachable from the development sandbox.
set -uo pipefail

OUT="${1:-report/versions.md}"
mkdir -p "$(dirname "$OUT")"

probe() {
  local title="$1" url="$2" filter="$3"
  {
    echo "### $title"
    echo ""
    echo "source: $url"
    echo ""
    local raw
    raw="$(curl -fsSL --max-time 30 "$url" 2>/dev/null)"
    if [ -z "$raw" ]; then
      echo "unreachable"
      echo ""
      return 0
    fi
    echo '```'
    printf '%s\n' "$raw" | awk -v re="$filter" '
      {
        while (match($0, /<version>[^<]*<\/version>/)) {
          v = substr($0, RSTART + 9, RLENGTH - 19)
          if (v ~ re) print v
          $0 = substr($0, RSTART + RLENGTH)
        }
      }' | sort -V | uniq
    echo '```'
    echo ""
  } >>"$OUT"
}

: >"$OUT"
{
  echo "# Loader versions available on the public mavens"
  echo ""
  echo "generated: $(date -u +%Y-%m-%dT%H:%M:%SZ) on $(uname -s -m)"
  echo ""
} >>"$OUT"

probe "fabric-loader (all)" "https://maven.fabricmc.net/net/fabricmc/fabric-loader/maven-metadata.xml" '^0\.[0-9]+\.[0-9]+$'
probe "fabric-api for 1.21.1" "https://maven.fabricmc.net/net/fabricmc/fabric-api/fabric-api/maven-metadata.xml" '\+1\.21\.1$'
probe "fabric-api for 1.20.1" "https://maven.fabricmc.net/net/fabricmc/fabric-api/fabric-api/maven-metadata.xml" '\+1\.20\.1$'
probe "fabric-loom (all release versions)" "https://maven.fabricmc.net/fabric-loom/fabric-loom.gradle.plugin/maven-metadata.xml" '^1\.[0-9]+(\.[0-9]+)?$'
probe "neoforge 21.1.x" "https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml" '^21\.1\.[0-9]+$'
probe "moddev-gradle" "https://maven.neoforged.net/releases/net/neoforged/moddev-gradle/maven-metadata.xml" '^[0-9]+\.[0-9]+(\.[0-9]+)?$'
probe "forge for 1.20.1" "https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml" '^1\.20\.1-4[0-9]\.'
probe "forge for 1.21.1" "https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml" '^1\.21\.1-5[0-9]\.'
probe "ForgeGradle" "https://maven.minecraftforge.net/net/minecraftforge/gradle/ForgeGradle/maven-metadata.xml" '^[0-9]\.[0-9](\.[0-9]+)?$'
probe "parchment 1.21.1" "https://maven.parchmentmc.org/org/parchmentmc/data/parchment-1.21.1/maven-metadata.xml" '^[0-9]{4}\.'
probe "gradle 8 distributions" "https://services.gradle.org/distributions/" 'gradle-8\.[0-9.]+-bin\.zip'

echo "--- report written to $OUT ---"
