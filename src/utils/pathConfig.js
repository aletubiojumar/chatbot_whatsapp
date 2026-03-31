const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

function resolveFromProject(rawPath, fallbackAbsPath) {
  if (!rawPath) return fallbackAbsPath;
  return path.isAbsolute(rawPath)
    ? rawPath
    : path.resolve(PROJECT_ROOT, rawPath);
}

const EXCEL_PATH = resolveFromProject(
  process.env.EXCEL_PATH,
  path.join(PROJECT_ROOT, 'data', 'allianz_latest.xlsx')
);

const CONV_STATE_FILE = resolveFromProject(
  process.env.CONV_STATE_FILE,
  path.join(path.dirname(EXCEL_PATH), 'bot_state.xlsx')
);

module.exports = {
  PROJECT_ROOT,
  EXCEL_PATH,
  CONV_STATE_FILE,
  resolveFromProject,
};
