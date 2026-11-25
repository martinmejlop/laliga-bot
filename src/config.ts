import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const SETTINGS_PATH = new URL('../config/settings.json', import.meta.url);

export interface Settings {
  version: 1;
  competition: 'LaLiga';
  bookmaker: 'bet365';
  currency: 'EUR';
  timezone: 'Europe/Madrid';
  initialBudgetEur: number;
  mode: 'recommendations-only';
  execution: 'manual';
  ollama: { baseUrl: string; model: 'qwen3:8b'; timeoutMs: number };
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Configuración inválida: se esperaba un objeto.');
  return value as Record<string, unknown>;
}

function keys(value: Record<string, unknown>, expected: string[]) {
  if (Object.keys(value).length !== expected.length || Object.keys(value).some(key => !expected.includes(key))) {
    throw new Error('Configuración inválida: campos ausentes o desconocidos.');
  }
}

export function validateSettings(input: unknown): Settings {
  const value = object(input);
  keys(value, ['version', 'competition', 'bookmaker', 'currency', 'timezone', 'initialBudgetEur', 'mode', 'execution', 'ollama']);
  const fixed = { version: 1, competition: 'LaLiga', bookmaker: 'bet365', currency: 'EUR', timezone: 'Europe/Madrid', mode: 'recommendations-only', execution: 'manual' };
  for (const [key, expected] of Object.entries(fixed)) {
    if (value[key] !== expected) throw new Error(`Configuración no admitida: ${key}.`);
  }
  if (typeof value.initialBudgetEur !== 'number' || !Number.isFinite(value.initialBudgetEur) || value.initialBudgetEur <= 0 ||
      Math.abs(value.initialBudgetEur * 100 - Math.round(value.initialBudgetEur * 100)) > 0.000001) {
    throw new Error('El presupuesto debe ser positivo y tener como máximo dos decimales.');
  }
  const ollama = object(value.ollama);
  keys(ollama, ['baseUrl', 'model', 'timeoutMs']);
  // Esta primera entrega solo admite el servidor local ya instalado.
  if (ollama.baseUrl !== 'http://127.0.0.1:11434' || ollama.model !== 'qwen3:8b') {
    throw new Error('Solo se admite Qwen3 8B en el servidor local de Ollama.');
  }
  if (!Number.isInteger(ollama.timeoutMs) || Number(ollama.timeoutMs) < 1000 || Number(ollama.timeoutMs) > 60000) {
    throw new Error('El tiempo de espera de Ollama debe estar entre 1000 y 60000 ms.');
  }
  return structuredClone(value) as unknown as Settings;
}

export function loadSettings(): Settings {
  try { return validateSettings(JSON.parse(readFileSync(SETTINGS_PATH, 'utf8'))); }
  catch (error) { throw new Error(`No se pudo cargar settings.json: ${error instanceof Error ? error.message : String(error)}`); }
}

export function assertRuntime(version = process.versions.node): void {
  if (Number(version.split('.')[0]) !== 24) throw new Error('Este proyecto requiere Node.js 24.');
}
