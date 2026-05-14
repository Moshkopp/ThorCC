#!/bin/bash

# ThorCC Startup Script
# This script builds the frontend and starts the high-performance Rust backend.

echo "🚀 Initializing ThorCC Rebuild Environment..."

# 1. Build Frontend
echo "📦 Building Frontend (Solid.js + Vite)..."
cd frontend

# Force install missing tailwindcss if it fails
echo "  Installing/Synchronizing dependencies..."
npm install tailwindcss postcss autoprefixer --save-dev
npm install

echo "  Running build..."
npm run build
if [ $? -ne 0 ]; then
    echo "❌ Frontend build failed. Aborting."
    exit 1
fi
cd ..

# 2. Run Backend
echo "🦀 Starting Rust Backend (Axum)..."
cd crates/thor_server
cargo run
