#!/usr/bin/env bash
# Creates a variant of package.json, hard-coded to use the oldest version of each dependency in
# the supported range.
#
# package.json is taken from the current working directory. The script does not modify the file -
# the new version is instead printed to the standard output.
#
# Dependencies: npm, jq, semver

set -euo pipefail

function fail { >&2 echo "$@"; exit 1; }

function find_min_supported_versions {
    local packages_json min_versions packages supported_range available_versions min_version

    # The function expects a JSON dict with package names and versions, extracted from package.json by the caller.
    packages_json=$(cat -)

    # Use @tsv filter to get tab-separated package names. We assume that neither packages, nor
    # available versions contain spaces. Spaces in version range are fine though.
    packages=$(echo "$packages_json" | jq --raw-output 'keys | @tsv')
    min_versions=()
    for package in $packages; do
        available_versions=$(npm view "$package" versions --json | jq --raw-output @tsv)
        supported_range=$(echo "$packages_json" | jq --raw-output ".\"${package}\"")

        # shellcheck disable=SC2086
        # semver prints versions matching the range, one per line, in semver order, oldest first
        min_version=$(semver $available_versions --range "$supported_range" | head --lines 1)
        [[ $min_version != "" ]] || fail "No version matching ${supported_range} found for package ${package}."

        # Debug info. It goes to stderr not to interfere with actual output.
        >&2 echo "Package ${package}:"
        >&2 echo "    minimum version:    ${min_version}"
        >&2 echo "    supported range:    ${supported_range}"
        >&2 echo "    available versions: ${available_versions}"
        >&2 echo

        min_versions+=("{\"${package}\": \"${min_version}\"}")
    done

    # Actual output: min_versions merged into a single dict.
    echo "${min_versions[@]}" | jq --slurp add
}

dependencies=$(jq .dependencies package.json | find_min_supported_versions)
dev_dependencies=$(jq .devDependencies package.json | find_min_supported_versions)

# Print package.json with overwritten dependency versions
cat <<EOF | jq --slurp '.[0] * .[1]' package.json -
{
    "dependencies":    ${dependencies},
    "devDependencies": ${dev_dependencies}
}
EOF
