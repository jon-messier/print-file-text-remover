#!/bin/bash
# Double-click to run the Text Remover locally in Chrome. Close this window to stop.
cd "$(dirname "$0")"
exec python3 serve.py
