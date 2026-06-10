import type { GameState, PowerId, TerritoryState, UnitStack, UnitTypeId } from "../types.js";
import { UNITS, hasFlag } from "../data/units.js";
import { areAllied, areEnemies, POWERS } from "../data/powers.js";
import { isSea } from "../data/territories.js";
import { rollDie, resolveSalvo } from "./rng.js";
import { neighbours } from "./setup.js";

// ============================================================================
// General combat — faithful to Global 1940 and supporting BOTH a one-click
// auto-resolution and interactive round-by-round play (fight on / retreat):
//   1. Opening fire     — defending AAA vs attacking air; submarine surprise
//                         strike (negated by an enemy destroyer)
//   2. Regular rounds    — simultaneous attacker/defender fire, with
//                         artillery->infantry support, tactical-bomber pairing,
//                         and two-hit capital ships whose damage persists
//                         between rounds and heals when the battle ends
//   3. Conclusion        — conquest of land, capital looting
//
// Dice honour the Low Luck house rule when enabled. Casualties use the standard
// "lose your cheapest units first" ordering so results are deterministic.
// ============================================================================

const def = (t: UnitTypeId) => UNITS[t];

interface CombatUnit {
  type: UnitTypeId;
  owner: PowerId;
  hp: number;
  maxHp: number;
}

export interface CombatRoundLog {
  round: number;
  attackerRolls: number[];
  defenderRolls: number[];
  attackerHits: number;
  defenderHits: number;
}

export interface CombatResult {
  territory: string;
  attacker: PowerId;
  winner: "attacker" | "defender" | "draw";
  rounds: CombatRoundLog[];
  attackerSurvivors: number;
  defenderSurvivors: number;
  conquered: boolean;
  text: string[];
}

// --- side bookkeeping ------------------------------------------------------

function expand(stacks: UnitStack[]): CombatUnit[] {
  const out: CombatUnit[] = [];
  for (const s of stacks) {
    const maxHp = def(s.type).hits;
    const hp = maxHp - (s.damage ?? 0);
    for (let i = 0; i < s.count; i++) out.push({ type: s.type, owner: s.owner, hp, maxHp });
  }
  return out;
}

function readSides(state: GameState, territory: string, attacker: PowerId) {
  const ts = state.territories[territory];
  const attackers = expand(ts.units.filter((u) => u.owner === attacker));
  const defenders = expand(ts.units.filter((u) => areEnemies(u.owner, attacker)));
  return { ts, attackers, defenders };
}

/** Write both sides back into the territory, preserving two-hit damage. */
function writeSides(ts: TerritoryState, attackers: CombatUnit[], defenders: CombatUnit[]): void {
  const merged: Record<string, UnitStack> = {};
  for (const u of [...attackers, ...defenders]) {
    const dmg = u.maxHp - u.hp;
    const key = `${u.type}:${u.owner}:${dmg}`;
    merged[key] = merged[key] ?? { type: u.type, owner: u.owner, count: 0, ...(dmg > 0 ? { damage: dmg } : {}) };
    merged[key].count += 1;
  }
  ts.units = Object.values(merged);
}

// --- dice ------------------------------------------------------------------

function attackDice(units: CombatUnit[]): number[] {
  const targets: number[] = [];
  let supports = units.filter((u) => u.type === "artillery").length;
  const hasFighterOrTank = units.some((u) => u.type === "fighter" || u.type === "tank");
  for (const u of units) {
    let atk = def(u.type).attack;
    if ((u.type === "infantry" || u.type === "mech_infantry") && supports > 0) {
      atk = 2;
      supports -= 1;
    }
    if (u.type === "tactical_bomber" && hasFighterOrTank) atk = 4;
    if (atk > 0) targets.push(atk);
  }
  return targets;
}

function defenseDice(units: CombatUnit[]): number[] {
  return units.map((u) => def(u.type).defense).filter((d) => d > 0);
}

function casualtyOrder(units: CombatUnit[]): CombatUnit[] {
  // Cheapest combat value first; among equals, take the more-damaged unit so a
  // two-hit ship soaks before dying.
  return [...units].sort((a, b) => def(a.type).cost - def(b.type).cost || a.hp - b.hp);
}

function applyHits(units: CombatUnit[], hits: number, notes: string[], side: string): CombatUnit[] {
  let remaining = hits;
  for (const u of casualtyOrder(units)) {
    while (remaining > 0 && u.hp > 0) {
      u.hp -= 1;
      remaining -= 1;
    }
    if (u.hp <= 0) notes.push(`${side} loses ${def(u.type).display}`);
    if (remaining <= 0) break;
  }
  return units.filter((u) => u.hp > 0);
}

const canFight = (units: CombatUnit[], onDefense: boolean): boolean =>
  units.some((u) => (onDefense ? def(u.type).defense : def(u.type).attack) > 0);

// --- opening fire ----------------------------------------------------------

function openingFire(
  state: GameState,
  territory: string,
  attacker: PowerId,
  notes: string[],
): void {
  const sea = isSea(territory);
  let { ts, attackers, defenders } = readSides(state, territory, attacker);
  const lowLuck = state.options.lowLuck;

  // AAA: defending anti-air fire on attacking aircraft (land battles).
  if (!sea) {
    const aaGuns = defenders.filter((u) => u.type === "aa_gun").length;
    const air = attackers.filter((u) => def(u.type).domain === "air");
    if (aaGuns > 0 && air.length > 0) {
      const shots = Math.min(aaGuns * 3, air.length);
      let hits = 0;
      if (lowLuck) hits = Math.min(Math.floor(shots / 6), air.length);
      else for (let i = 0; i < shots; i++) if (rollDie(state) === 1) hits += 1;
      if (hits > 0) {
        let killed = 0;
        attackers = attackers.filter((u) => {
          if (def(u.type).domain === "air" && killed < hits) {
            killed += 1;
            return false;
          }
          return true;
        });
        notes.push(`AAA fire destroys ${killed} attacking aircraft.`);
      }
    }
  }

  // Submarine surprise strike (sea battles, negated by an enemy destroyer).
  if (sea) {
    const defHasDD = defenders.some((u) => hasFlag(u.type, "negates_sub_special"));
    const atkHasDD = attackers.some((u) => hasFlag(u.type, "negates_sub_special"));
    const atkSubs = attackers.filter((u) => u.type === "submarine");
    if (atkSubs.length > 0 && !defHasDD) {
      const { hits } = resolveSalvo(state, atkSubs.map(() => def("submarine").attack), lowLuck);
      if (hits > 0) {
        defenders = applyHits(defenders, hits, notes, "Defender");
        notes.push(`Attacking submarines surprise-strike for ${hits} hit(s).`);
      }
    }
    const defSubs = defenders.filter((u) => u.type === "submarine");
    if (defSubs.length > 0 && !atkHasDD) {
      const { hits } = resolveSalvo(state, defSubs.map(() => def("submarine").defense), lowLuck);
      if (hits > 0) {
        attackers = applyHits(attackers, hits, notes, "Attacker");
        notes.push(`Defending submarines surprise-strike for ${hits} hit(s).`);
      }
    }
  }

  writeSides(ts, attackers, defenders);
}

// --- one regular round -----------------------------------------------------

function regularRound(
  state: GameState,
  territory: string,
  attacker: PowerId,
): { log: CombatRoundLog; notes: string[] } {
  const notes: string[] = [];
  let { ts, attackers, defenders } = readSides(state, territory, attacker);
  const lowLuck = state.options.lowLuck;

  const atk = resolveSalvo(state, attackDice(attackers), lowLuck);
  const dfn = resolveSalvo(state, defenseDice(defenders), lowLuck);

  // Simultaneous fire: compute both before removing casualties.
  defenders = applyHits(defenders, atk.hits, notes, "Defender");
  attackers = applyHits(attackers, dfn.hits, notes, "Attacker");
  writeSides(ts, attackers, defenders);

  return {
    log: {
      round: 0,
      attackerRolls: atk.rolls,
      defenderRolls: dfn.rolls,
      attackerHits: atk.hits,
      defenderHits: dfn.hits,
    },
    notes,
  };
}

// --- conclusion ------------------------------------------------------------

/** Decide if the battle is over and, if so, settle conquest. Returns winner or null. */
function settle(
  state: GameState,
  territory: string,
  attacker: PowerId,
  notes: string[],
): "attacker" | "defender" | "draw" | null {
  const { ts, attackers, defenders } = readSides(state, territory, attacker);
  const sea = isSea(territory);

  const attackerCanFight = canFight(attackers, false);
  const defenderCanFight = canFight(defenders, true);

  let winner: "attacker" | "defender" | "draw" | null = null;
  if (defenders.length === 0 && attackers.length > 0) winner = "attacker";
  else if (attackers.length === 0 && defenders.length > 0) winner = "defender";
  else if (attackers.length === 0 && defenders.length === 0) winner = "draw";
  else if (!attackerCanFight && !defenderCanFight) winner = "draw";
  else if (!attackerCanFight) winner = "defender"; // attacker only has transports/AA

  if (winner === null) return null;

  // Heal surviving two-hit ships (battleship damage is repaired after combat).
  healTwoHit(ts);

  if (winner === "attacker" && !sea && attackers.some((u) => def(u.type).domain === "land")) {
    captureTerritory(state, ts, attacker, notes);
  }
  return winner;
}

function healTwoHit(ts: TerritoryState): void {
  const merged: Record<string, UnitStack> = {};
  for (const s of ts.units) {
    const key = `${s.type}:${s.owner}`;
    merged[key] = merged[key] ?? { type: s.type, owner: s.owner, count: 0 };
    merged[key].count += s.count;
  }
  ts.units = Object.values(merged);
}

function captureTerritory(state: GameState, ts: TerritoryState, conqueror: PowerId, notes: string[]): void {
  const previous = ts.controller;
  ts.controller = conqueror;
  ts.factoryDamage = 0;
  notes.push(`${POWERS[conqueror].display} captures ${ts.id}.`);
  for (const p of Object.values(POWERS)) {
    if (p.capital === ts.id && previous && areEnemies(conqueror, previous)) {
      const looted = state.treasury[previous] ?? 0;
      if (looted > 0) {
        state.treasury[conqueror] += looted;
        state.treasury[previous] = 0;
        notes.push(`${POWERS[conqueror].display} loots ${looted} IPC from ${POWERS[previous].display}'s capital!`);
      }
    }
  }
}

// --- public API ------------------------------------------------------------

export function battleAttacker(state: GameState, territory: string): PowerId {
  return state.combat.battles.find((b) => b.territory === territory)?.attacker ?? state.activePower;
}

/** Auto-resolve a battle to its conclusion (the one-click option). */
export function resolveBattle(state: GameState, territory: string): CombatResult {
  const attacker = battleAttacker(state, territory);
  const text: string[] = [];
  openingFire(state, territory, attacker, text);

  const rounds: CombatRoundLog[] = [];
  let winner = settle(state, territory, attacker, text);
  let n = 0;
  while (winner === null && n < 50) {
    n += 1;
    const { log, notes } = regularRound(state, territory, attacker);
    log.round = n;
    rounds.push(log);
    text.push(...notes);
    winner = settle(state, territory, attacker, text);
  }

  const { attackers, defenders } = readSides(state, territory, attacker);
  text.push(
    winner === "attacker"
      ? `Attacker (${POWERS[attacker].display}) wins at ${territory}.`
      : winner === "defender"
        ? `Defender holds ${territory}.`
        : `Battle at ${territory} ends inconclusively.`,
  );
  return {
    territory,
    attacker,
    winner: winner ?? "draw",
    rounds,
    attackerSurvivors: attackers.length,
    defenderSurvivors: defenders.length,
    conquered: winner === "attacker" && !isSea(territory),
    text,
  };
}

/**
 * Fight a single round of an ongoing battle (interactive play). Applies opening
 * fire on the first step. Returns whether the battle is now concluded.
 */
export function stepBattle(state: GameState, territory: string): { concluded: boolean; notes: string[] } {
  const battle = state.combat.battles.find((b) => b.territory === territory);
  if (!battle) return { concluded: true, notes: ["No such battle."] };
  const attacker = battle.attacker;
  const notes: string[] = [];

  if (!battle.started) {
    openingFire(state, territory, attacker, notes);
    battle.started = true;
    battle.roundsFought = 0;
    // If opening fire already decided it, stop here.
    const early = settle(state, territory, attacker, notes);
    if (early !== null) {
      battle.resolved = true;
      battle.lastRound = { attackerRolls: [], defenderRolls: [], attackerHits: 0, defenderHits: 0, notes };
      return { concluded: true, notes };
    }
  }

  const { log, notes: roundNotes } = regularRound(state, territory, attacker);
  notes.push(...roundNotes);
  battle.roundsFought = (battle.roundsFought ?? 0) + 1;
  battle.lastRound = {
    attackerRolls: log.attackerRolls,
    defenderRolls: log.defenderRolls,
    attackerHits: log.attackerHits,
    defenderHits: log.defenderHits,
    notes,
  };

  const winner = settle(state, territory, attacker, notes);
  if (winner !== null) {
    battle.resolved = true;
    return { concluded: true, notes };
  }
  return { concluded: false, notes };
}

/** Attacker withdraws survivors to one friendly adjacent territory. */
export function retreatBattle(state: GameState, territory: string): { ok: boolean; notes: string[] } {
  const battle = state.combat.battles.find((b) => b.territory === territory);
  if (!battle) return { ok: false, notes: ["No such battle."] };
  const attacker = battle.attacker;
  const ts = state.territories[territory];
  const notes: string[] = [];

  const attackerStacks = ts.units.filter((u) => u.owner === attacker);
  if (attackerStacks.length === 0) return { ok: false, notes: ["Nothing to retreat."] };

  // Find a friendly adjacent destination per domain.
  const friendly = (id: string): boolean => {
    const c = state.territories[id].controller;
    const noEnemies = !state.territories[id].units.some((u) => areEnemies(u.owner, attacker));
    return noEnemies && (!c || areAllied(c, attacker));
  };
  const landDest = neighbours(territory).find((n) => !isSea(n) && friendly(n));
  const seaDest = neighbours(territory).find((n) => isSea(n) && friendly(n));

  let moved = 0;
  for (const s of attackerStacks) {
    const dest = def(s.type).domain === "sea" ? seaDest : landDest;
    if (!dest) continue;
    const d = state.territories[dest];
    const existing = d.units.find((u) => u.type === s.type && u.owner === s.owner && !u.damage);
    if (existing) existing.count += s.count;
    else d.units.push({ type: s.type, owner: s.owner, count: s.count });
    moved += s.count;
  }
  ts.units = ts.units.filter((u) => u.owner !== attacker);
  healTwoHit(ts);
  battle.resolved = true;
  notes.push(`${POWERS[attacker].display} retreats ${moved} unit(s) from ${territory}.`);
  return { ok: true, notes };
}
