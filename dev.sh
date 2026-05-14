#!/bin/bash

# ThorCC Development Mode Script
# Starts Vite Dev Server and Rust Backend in parallel.

echo "🚀 Starting ThorCC in Development Mode..."

# Function to kill all background processes on exit
cleanup() {
    echo "Stopping servers..."
    kill $(jobs -p)
    exit
}
trap cleanup SIGINT SIGTERM

# 1. Start Rust Backend
echo "🦀 Starting Rust Backend on port 3000..."
cd crates/thor_server
cargo run &
BACKEND_PID=$!
cd ../..

# 2. Start Vite Frontend
echo "📦 Starting Vite Dev Server on port 5173..."
cd frontend
npm run dev &
FRONTEND_PID=$!
cd ..

wait
