#!/bin/bash
set -euo pipefail

bail="--bail"
runtarget="build+test"
while [[ "${1:-}" != "" ]]; do
    case $1 in
        -h|--help)
            echo "Usage: build.sh [--no-bail] [--force|-f] [--skip-test]"
            exit 1
            ;;
        --no-bail)
            bail="--no-bail"
            ;;
        --skip-test|--skip-tests)
            runtarget="build"
            ;;
        *)
            echo "Unrecognized parameter: $1"
            exit 1
            ;;
    esac
    shift
done

export PATH=$(npm bin):$PATH

export NODE_OPTIONS="--max-old-space-size=4096 ${NODE_OPTIONS:-}"

echo "============================================================================================="
echo "installing..."
yarn install --frozen-lockfile

fail() {
  echo "❌  Last command failed. Scroll up to see errors in log (search for '!!!!!!!!')."
  exit 1
}

# Speed up build by reusing calculated tree hashes
# On dev machine, this speeds up the TypeScript part of the build by ~30%.
export MERKLE_BUILD_CACHE=$(mktemp -d)
trap "rm -rf $MERKLE_BUILD_CACHE" EXIT

if ! [ -x "$(command -v yarn)" ]; then
  echo "yarn is not installed. Install it from here- https://yarnpkg.com/en/docs/install."
  exit 1
fi
