import { APP_CONFIG } from './config.js';

function read(key, fallback) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key));
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

export function getContexts() { return read(APP_CONFIG.storageKeys.contexts, {}); }
export function setContext(id, context) {
  const all = getContexts();
  all[id] = context;
  write(APP_CONFIG.storageKeys.contexts, all);
  return all;
}
export function clearContexts() { localStorage.removeItem(APP_CONFIG.storageKeys.contexts); }

export function getExperiments() { return read(APP_CONFIG.storageKeys.experiments, []); }
export function addExperiment(experiment) {
  const all = getExperiments();
  all.push(experiment);
  write(APP_CONFIG.storageKeys.experiments, all);
  return all;
}
export function removeExperiment(id) {
  const next = getExperiments().filter((item) => item.id !== id);
  write(APP_CONFIG.storageKeys.experiments, next);
  return next;
}
export function clearExperiments() { localStorage.removeItem(APP_CONFIG.storageKeys.experiments); }

export function getGoal() { return localStorage.getItem(APP_CONFIG.storageKeys.goal) || 'overall'; }
export function setGoal(goal) { localStorage.setItem(APP_CONFIG.storageKeys.goal, goal); }
