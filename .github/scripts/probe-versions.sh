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
    raw="$(curl -fsSL --max-time 30 "$url" 2>&1)" || raw=""
    if [ -z "$raw" ] || ! printf '%s' "$raw" | grep -q '<version>'; then
      echo "unreachable or not a maven-metadata document"
      printf '%s\n' "$raw" | head -5
      echo ""
      return 0
    fi
    local versions
    versions="$(printf '%s\n' "$raw" | grep -o '<version>[^<]*</version>' | sed 's/<[^>]*>//g' | grep -E "$filter" | tail -30)"
    if [ -z "$versions" ]; then
      echo "no version matched /$filter/"
      printf '%s\n' "$raw" | grep -o '<version>[^<]*</version>' | sed 's/<[^>]*>//g' | tail -10
    else
      printf '%s\n' "$versions"
    fi
    echo ""
  } >>"$OUT"
}

: >"$OUT"
{
  echo "## Loader versions available on the public mavens"
  echo ""
  echo "generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo ""
} >>"$OUT"

probe "fabric-loader" "https://maven.fabricmc.net/net/fabricmc/fabric-loader/maven-metadata.xml" '^0\.[0-9]+\.[0-9]+$'
probe "fabric-api for 1.21.1" "https://maven.fabricmc.net/net/fabricmc/fabric-api/maven-metadata.xml" '\+1\.21\.1$'
probe "fabric-api for 1.20.1" "https://maven.fabricmc.net/net/fabricmc/fabric-api/maven-metadata.xml" '\+1\.20\.1$'
probe "fabric-loom (fabric maven)" "https://maven.fabricmc.net/fabric-loom/fabric-loom.gradle.plugin/maven-metadata.xml" '^1\.[0-9]+'
probe "fabric-loom (plugin portal)" "https://plugins.gradle.org/m2/fabric-loom/fabric-loom.gradle.plugin/maven-metadata.xml" '^1\.[0-9]+'
probe "neoforge 21.1.x" "https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml" '^21\.1\.[0-9]+$'
probe "moddev-gradle (plugin portal)" "https://plugins.gradle.org/m2/net/neoforged/moddev/moddev-gradle/maven-metadata.xml" '^[0-9]+\.[0-9]+'
probe "moddev-gradle (neoforged maven)" "https://maven.neoforged.net/releases/net/neoforged/moddev-gradle/maven-metadata.xml" '^[0-9]+\.[0-9]+'
probe "forge for 1.20.1" "https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml" '^1\.20\.1-4[0-9]\.'
probe "forge for 1.21.1" "https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml" '^1\.21\.1-5[0-9]\.'
probe "ForgeGradle (plugin portal)" "https://plugins.gradle.org/m2/net/minecraftforge/gradle/ForgeGradle/maven-metadata.xml" '^[0-9]\.[0-9]'
probe "ForgeGradle (forge maven)" "https://maven.minecraftforge.net/net/minecraftforge/gradle/ForgeGradle/maven-metadata.xml" '^[0-9]\.[0-9]'
probe "gradle 8 distributions" "https://services.gradle.org/distributions/" 'gradle-8\.[0-9.]+-bin\.zip'

echo "--- probe finished, report at $OUT ---"
cat "$OUT"
