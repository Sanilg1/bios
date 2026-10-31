// In-memory state with a JSON snapshot on disk (decision D5).
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { emptyState } from "./policy/engine.js";
import { PERSONAS, PERSONA_OWNER, seedResources } from "./policy/catalog.js";

export function seedState({ withPersonas }) {
  const state = emptyState(seedResources(withPersonas ? [PERSONA_OWNER] : []));
  if (withPersonas) {
    for (const persona of PERSONAS) state.users[persona.sub] = { sub: persona.sub, name: persona.name, roles: [...persona.roles] };
  }
  return state;
}

export function loadState(file, { withPersonas }) {
  if (file && existsSync(file)) return JSON.parse(readFileSync(file, "utf8"));
  return seedState({ withPersonas });
}

export function snapshotter(file) {
  if (!file) return () => {};
  let timer = null;
  return (state) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      // A failed snapshot (full disk, permissions) must not crash the gate; the next change retries.
      try {
        mkdirSync(dirname(file), { recursive: true });
        const tmp = `${file}.tmp`;
        writeFileSync(tmp, JSON.stringify(state, null, 2));
        renameSync(tmp, file);
      } catch (error) {
        console.error(`State snapshot to ${file} failed: ${error.message}`);
      }
    }, 200);
  };
}
