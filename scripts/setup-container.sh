#!/bin/sh
set -e

sudo chown node:node node_modules client/node_modules server/node_modules
npm install
