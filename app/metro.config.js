// Metro config for an Expo app inside an npm-workspaces monorepo.
// Watches the repo root so `@expense/shared` resolves, and forces a single
// copy of node_modules to avoid duplicate-React "invalid hook call" errors.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '..');

const config = getDefaultConfig(projectRoot);

// 1. Watch all files in the monorepo.
config.watchFolders = [workspaceRoot];

// 2. Resolve modules from the app first, then the workspace root.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// 3. Do not walk further up than the workspace root.
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
