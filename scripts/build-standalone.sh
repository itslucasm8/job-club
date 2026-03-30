#!/bin/bash
# Build and prepare standalone Next.js server
# Use this instead of just "npm run build" when running Node directly (not Docker)

set -e

echo "Building Next.js app..."
npm run build

echo "Copying static files to standalone output..."
cp -r .next/static .next/standalone/.next/static

echo "Copying public folder to standalone output..."
cp -r public .next/standalone/public 2>/dev/null || true

echo "Build complete! Start with: node .next/standalone/server.js"
