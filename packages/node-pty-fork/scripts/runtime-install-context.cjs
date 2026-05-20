"use strict";

const path = require("node:path");

function normalizeSegments(targetPath) {
  return path
    .resolve(targetPath)
    .split(/[\\/]+/u)
    .filter(Boolean)
    .map((segment) => segment.toLowerCase());
}

function isInstalledUnderNodeModules(targetPath) {
  return normalizeSegments(targetPath).includes("node_modules");
}

function isWorkspaceSourceInstall(targetPath) {
  return !isInstalledUnderNodeModules(targetPath);
}

module.exports = {
  isInstalledUnderNodeModules,
  isWorkspaceSourceInstall
};
