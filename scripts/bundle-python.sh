#!/bin/bash
# bundle-python.sh — Create a self-contained Python environment for Nuclei
#
# Uses conda-pack to bundle Python + Qiskit + Cirq into a tarball
# that ships inside the .dmg. Users don't need Python installed.
#
# Prerequisites:
#   - conda or miniconda installed
#   - conda-pack: conda install conda-pack
#
# Output: python-env.tar.gz (~300-500MB)
#
# Usage: ./scripts/bundle-python.sh

set -e

ENV_NAME="nuclei-python"
OUTPUT_DIR="src-tauri/resources"
OUTPUT_FILE="$OUTPUT_DIR/python-env.tar.gz"

echo "=== Nuclei Python Bundler ==="
echo ""

# Create conda environment
echo "[1/4] Creating conda environment: $ENV_NAME"
conda create -n "$ENV_NAME" python=3.12 -y --quiet

echo "[2/4] Installing quantum packages"
conda run -n "$ENV_NAME" pip install \
  qiskit \
  qiskit-aer \
  cirq-core \
  websockets \
  numpy \
  --quiet

echo "[3/4] Packing environment with conda-pack"
mkdir -p "$OUTPUT_DIR"
conda pack -n "$ENV_NAME" -o "$OUTPUT_FILE" --force

echo "[4/4] Cleaning up"
conda remove -n "$ENV_NAME" --all -y --quiet

SIZE=$(du -h "$OUTPUT_FILE" | cut -f1)
echo ""
echo "=== Done ==="
echo "Bundled Python environment: $OUTPUT_FILE ($SIZE)"
echo ""
echo "To use in Tauri:"
echo "  1. Extract on first launch to ~/Library/Application Support/nuclei/python-env/"
echo "  2. Run: python-env/bin/python3 kernel/server.py"
