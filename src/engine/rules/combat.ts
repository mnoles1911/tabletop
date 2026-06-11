import type { GameState, PendingBattle, PowerId, TerritoryState, UnitStack, UnitTypeId } from "../types.js";
import { UNITS, hasFlag } from "../data/units.js";
import { areAllied, areEnemies, POWERS } from "../data/powers.js";
import { isSea } from "../data/territories.js";
import { rollDie, resolveSalvo } from "./rng.js";
import { neighbours, addUnits, removeUnits } from "./setup.js";
import { hasTech } from "./research.js";
import { resolveSBR } from "./sbr.js";
import { captureTerritory } from "./control.js";

// ============================================================================
// General combat — faithful to Global 1940, supporting one-click auto-resolve
// and interactive round-by-round play (fight / retreat / pick casualties):
//   1. Opening fire  — shore bombardment (amphibious), defending AAA vs air,
//                      submarine surprise strike (negated by an enemy destroyer)
//   2. Regular rounds — simultaneous fire with artillery->infantry support,
//                      tactical-bomber pairing, tech effects (Jet Fighters,
//                      Super Subs), and two-hit capital ships whose damage
//                      persists between rounds and heals after the battle
//   3. Conclusion     — conquest of land, capital looting
// Strategic-bombing battles are resolved separately (see sbr.ts).
// ============================================================================

const def = (t: UnitTypeId) => UNITS[t];

const WARSHIPS = new Set<UnitTypeId>(["destroyer", "cruiser", "battleship", "aircraft_carrier"]);

// Japanese Pacific islands from which kamikaze pilots strike adjacent sea zones.
export const KAMIKAZE_ISLANDS = new Set<string>([
  "okinawa", "iwo_jima", "formosa", "marianas", "caroline_islands",
  "paulau_island", "marshall_islands", "guam", "wake_island",
]);

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

// --- dice (tech-aware) -----------------------------------------------------

function attackDice(state: GameState, units: CombatUnit[], attacker: PowerId): number[] {
  const targets: number[] = [];
  let supports = units.filter((u) => u.type === "artillery").length;
  const hasFighterOrTank = units.some((u) => u.type === "fighter" || u.type === "tank");
  const superSubs = hasTech(state, attacker, "super_subs");
  for (const u of units) {
    let atk = def(u.type).attack;
    if ((u.type === "infantry" || u.type === "mech_infantry") && supports > 0) {
      atk = 2;
      supports -= 1;
    }
    if (u.type === "tactical_bomber" && hasFighterOrTank) atk = 4;
    if (u.type === "submarine" && superSubs) atk = 3;
    if (atk > 0) targets.push(atk);
  }
  return targets;
}

function defenseDice(state: GameState, units: CombatUnit[]): number[] {
  const targets: number[] = [];
  for (const u of units) {
    let d = def(u.type).defense;
    if (u.type === "fighter" && hasTech(state, u.owner, "jet_fighters")) d = 5;
    if (d > 0) targets.push(d);
  }
  return targets;
}

function casualtyOrder(units: CombatUnit[]): CombatUnit[] {
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

// --- scramble & kamikaze (sea-battle reactions) ----------------------------

/** Defenders scramble up to 3 fighters/tac from each adjacent enemy air base. */
function scrambleDefenders(state: GameState, battle: PendingBattle, notes: string[]): void {
  const sz = battle.territory;
  const attacker = battle.attacker;
  battle.scrambled = battle.scrambled ?? [];
  for (const land of neighbours(sz)) {
    if (isSea(land)) continue;
    const lt = state.territories[land];
    const c = lt.controller;
    if (!c || !areEnemies(c, attacker)) continue;
    if (!lt.units.some((u) => u.type === "air_base" && (u.owner === c || areAllied(u.owner, c)))) continue;
    let budget = 3;
    for (const type of ["fighter", "tactical_bomber"] as UnitTypeId[]) {
      if (budget <= 0) break;
      const stack = lt.units.find((u) => u.type === type && u.owner === c);
      const n = Math.min(stack?.count ?? 0, budget);
      if (n <= 0) continue;
      removeUnits(lt, type, n, c);
      addUnits(state.territories[sz], type, n, c);
      battle.scrambled.push({ from: land, type, count: n, owner: c });
      budget -= n;
      notes.push(`${POWERS[c].display} scrambles ${n}× ${def(type).display} to defend.`);
    }
  }
}

/** Surviving scrambled aircraft fly home to their air base after the battle. */
function returnScrambled(state: GameState, battle: PendingBattle, notes: string[]): void {
  if (!battle.scrambled?.length) return;
  const sz = state.territories[battle.territory];
  for (const s of battle.scrambled) {
    const here = sz.units.find((u) => u.type === s.type && u.owner === s.owner)?.count ?? 0;
    const home = state.territories[s.from];
    const homeFriendly = !!home?.controller && !areEnemies(home.controller, s.owner);
    const n = Math.min(here, s.count);
    if (n > 0 && homeFriendly) {
      removeUnits(sz, s.type, n, s.owner);
      addUnits(home, s.type, n, s.owner);
      notes.push(`${POWERS[s.owner].display} lands ${n}× ${def(s.type).display} back at base.`);
    }
  }
  battle.scrambled = [];
}

/** Japanese kamikaze strike on an attacking fleet near a held Pacific island. */
function kamikazeHits(state: GameState, territory: string, attacker: PowerId): { hits: number; note: string } | null {
  if ((state.kamikaze ?? 0) <= 0 || !areEnemies("Japan", attacker)) return null;
  const near = neighbours(territory).some(
    (n) => KAMIKAZE_ISLANDS.has(n) && state.territories[n]?.controller === "Japan",
  );
  if (!near) return null;
  const ts = state.territories[territory];
  const warships = ts.units.filter((u) => u.owner === attacker && WARSHIPS.has(u.type)).reduce((s, u) => s + u.count, 0);
  if (warships === 0) return null;
  const tokens = Math.min(state.kamikaze ?? 0, warships);
  const { hits, rolls } = resolveSalvo(state, new Array(tokens).fill(2), state.options.lowLuck);
  state.kamikaze = (state.kamikaze ?? 0) - tokens;
  return { hits, note: `Japanese kamikaze (${tokens} token${tokens > 1 ? "s" : ""}, rolls ${rolls.join(",") || "—"}) score ${hits} hit(s).` };
}

// --- opening fire ----------------------------------------------------------

function openingFire(state: GameState, battle: PendingBattle, notes: string[]): void {
  const territory = battle.territory;
  const attacker = battle.attacker;
  const sea = isSea(territory);
  if (sea) scrambleDefenders(state, battle, notes); // add defenders before reading sides
  let { ts, attackers, defenders } = readSides(state, territory, attacker);
  const lowLuck = state.options.lowLuck;

  // Kamikaze: Japanese island defence fires on the attacking surface fleet.
  if (sea) {
    const k = kamikazeHits(state, territory, attacker);
    if (k) {
      if (k.hits > 0) {
        const ships = attackers.filter((u) => WARSHIPS.has(u.type));
        const rest = attackers.filter((u) => !WARSHIPS.has(u.type));
        attackers = [...applyHits(ships, k.hits, notes, "Attacker (kamikaze)"), ...rest];
      }
      notes.push(k.note);
    }
  }

  // Shore bombardment: warships in the staging sea zone fire one salvo.
  if (battle.amphibious && battle.bombardFrom) {
    const zone = state.territories[battle.bombardFrom];
    const ships = zone?.units.filter((u) => u.owner === attacker && hasFlag(u.type, "bombard")) ?? [];
    const dice: number[] = [];
    for (const s of ships) for (let i = 0; i < s.count; i++) dice.push(def(s.type).attack);
    if (dice.length) {
      const { hits } = resolveSalvo(state, dice, lowLuck);
      if (hits > 0) {
        defenders = applyHits(defenders, hits, notes, "Defender");
        notes.push(`Shore bombardment scores ${hits} hit(s).`);
      }
    }
    battle.bombardFrom = undefined; // bombard only once
  }

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
      const { hits } = resolveSalvo(state, attackDice(state, atkSubs, attacker), lowLuck);
      if (hits > 0) {
        defenders = applyHits(defenders, hits, notes, "Defender");
        notes.push(`Attacking submarines surprise-strike for ${hits} hit(s).`);
      }
    }
    const defSubs = defenders.filter((u) => u.type === "submarine");
    if (defSubs.length > 0 && !atkHasDD) {
      const { hits } = resolveSalvo(state, defenseDice(state, defSubs), lowLuck);
      if (hits > 0) {
        attackers = applyHits(attackers, hits, notes, "Attacker");
        notes.push(`Defending submarines surprise-strike for ${hits} hit(s).`);
      }
    }
  }

  writeSides(ts, attackers, defenders);
}

// --- one regular round -----------------------------------------------------

/** Roll a round and apply defender casualties; return attacker hits owed. */
function fireRound(
  state: GameState,
  territory: string,
  attacker: PowerId,
): { log: CombatRoundLog; attackerHitsOwed: number; notes: string[] } {
  const notes: string[] = [];
  let { ts, attackers, defenders } = readSides(state, territory, attacker);
  const lowLuck = state.options.lowLuck;

  const atk = resolveSalvo(state, attackDice(state, attackers, attacker), lowLuck);
  const dfn = resolveSalvo(state, defenseDice(state, defenders), lowLuck);

  defenders = applyHits(defenders, atk.hits, notes, "Defender");
  writeSides(ts, attackers, defenders);

  return {
    log: { round: 0, attackerRolls: atk.rolls, defenderRolls: dfn.rolls, attackerHits: atk.hits, defenderHits: dfn.hits },
    attackerHitsOwed: dfn.hits,
    notes,
  };
}

function applyAttackerHits(state: GameState, territory: string, attacker: PowerId, hits: number, notes: string[]): void {
  const { ts, attackers, defenders } = readSides(state, territory, attacker);
  const survivors = applyHits(attackers, hits, notes, "Attacker");
  writeSides(ts, survivors, defenders);
}

// --- conclusion ------------------------------------------------------------

function settle(state: GameState, territory: string, attacker: PowerId, notes: string[]): "attacker" | "defender" | "draw" | null {
  const { ts, attackers, defenders } = readSides(state, territory, attacker);
  const sea = isSea(territory);
  const attackerCanFight = canFight(attackers, false);
  const defenderCanFight = canFight(defenders, true);

  let winner: "attacker" | "defender" | "draw" | null = null;
  if (defenders.length === 0 && attackers.length > 0) winner = "attacker";
  else if (attackers.length === 0 && defenders.length > 0) winner = "defender";
  else if (attackers.length === 0 && defenders.length === 0) winner = "draw";
  else if (!attackerCanFight && !defenderCanFight) winner = "draw";
  else if (!attackerCanFight) winner = "defender";

  if (winner === null) return null;

  healTwoHit(ts);
  // Battle decided: any scrambled aircraft that survived now fly home.
  const battle = state.combat.battles.find((b) => b.territory === territory);
  if (battle) returnScrambled(state, battle, notes);
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

// --- public API ------------------------------------------------------------

export function battleAttacker(state: GameState, territory: string): PowerId {
  return state.combat.battles.find((b) => b.territory === territory)?.attacker ?? state.activePower;
}

/** Auto-resolve a battle to its conclusion (one-click), casualties cheapest-first. */
export function resolveBattle(state: GameState, territory: string): CombatResult {
  const battle = state.combat.battles.find((b) => b.territory === territory);
  const attacker = battle?.attacker ?? state.activePower;
  const text: string[] = [];

  if (battle?.sbr) {
    const r = resolveSBR(state, territory, battle.bombardFrom ?? "");
    battle.resolved = true;
    return { territory, attacker, winner: "attacker", rounds: [], attackerSurvivors: 0, defenderSurvivors: 0, conquered: false, text: r.text };
  }

  if (battle && !battle.started) {
    openingFire(state, battle, text);
    battle.started = true;
  }

  const rounds: CombatRoundLog[] = [];
  let winner = settle(state, territory, attacker, text);
  let n = 0;
  while (winner === null && n < 50) {
    n += 1;
    const { log, attackerHitsOwed, notes } = fireRound(state, territory, attacker);
    applyAttackerHits(state, territory, attacker, attackerHitsOwed, notes);
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
  if (battle) battle.resolved = true;
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

/** Fight a single round (interactive). May pause for attacker casualty choice. */
export function stepBattle(state: GameState, territory: string): { concluded: boolean; awaitingCasualties: boolean; notes: string[] } {
  const battle = state.combat.battles.find((b) => b.territory === territory);
  if (!battle) return { concluded: true, awaitingCasualties: false, notes: ["No such battle."] };
  if ((battle.pendingAttackerHits ?? 0) > 0) {
    return { concluded: false, awaitingCasualties: true, notes: ["Choose your casualties first."] };
  }
  const attacker = battle.attacker;
  const notes: string[] = [];

  if (battle.sbr) {
    const r = resolveSBR(state, territory, battle.bombardFrom ?? "");
    battle.resolved = true;
    battle.lastRound = { attackerRolls: [], defenderRolls: [], attackerHits: 0, defenderHits: 0, notes: r.text };
    return { concluded: true, awaitingCasualties: false, notes: r.text };
  }

  if (!battle.started) {
    openingFire(state, battle, notes);
    battle.started = true;
    battle.roundsFought = 0;
    const early = settle(state, territory, attacker, notes);
    if (early !== null) {
      battle.resolved = true;
      battle.lastRound = { attackerRolls: [], defenderRolls: [], attackerHits: 0, defenderHits: 0, notes };
      return { concluded: true, awaitingCasualties: false, notes };
    }
  }

  const { log, attackerHitsOwed, notes: roundNotes } = fireRound(state, territory, attacker);
  notes.push(...roundNotes);
  battle.roundsFought = (battle.roundsFought ?? 0) + 1;
  battle.lastRound = {
    attackerRolls: log.attackerRolls,
    defenderRolls: log.defenderRolls,
    attackerHits: log.attackerHits,
    defenderHits: log.defenderHits,
    notes,
  };

  // Decide if the attacker's losses need a manual choice.
  const { attackers } = readSides(state, territory, attacker);
  const distinctTypes = new Set(attackers.map((u) => u.type)).size;
  if (attackerHitsOwed > 0 && distinctTypes > 1 && attackerHitsOwed < attackers.length) {
    battle.pendingAttackerHits = attackerHitsOwed;
    return { concluded: false, awaitingCasualties: true, notes };
  }

  applyAttackerHits(state, territory, attacker, attackerHitsOwed, notes);
  const winner = settle(state, territory, attacker, notes);
  if (winner !== null) {
    battle.resolved = true;
    return { concluded: true, awaitingCasualties: false, notes };
  }
  return { concluded: false, awaitingCasualties: false, notes };
}

/** Apply the attacker's chosen casualties for a paused battle. */
export function assignCasualties(
  state: GameState,
  territory: string,
  losses: { type: UnitTypeId; count: number }[],
): { ok: boolean; concluded: boolean; notes: string[] } {
  const battle = state.combat.battles.find((b) => b.territory === territory);
  if (!battle || !battle.pendingAttackerHits) return { ok: false, concluded: false, notes: ["No casualties to assign."] };
  const attacker = battle.attacker;
  const ts = state.territories[territory];
  const total = losses.reduce((n, l) => n + l.count, 0);
  if (total !== battle.pendingAttackerHits) {
    return { ok: false, concluded: false, notes: [`Assign exactly ${battle.pendingAttackerHits} casualties.`] };
  }
  for (const l of losses) {
    const have = ts.units.find((u) => u.type === l.type && u.owner === attacker)?.count ?? 0;
    if (have < l.count) return { ok: false, concluded: false, notes: ["You don't have those units to lose."] };
  }
  const notes: string[] = [];
  for (const l of losses) {
    const stack = ts.units.find((u) => u.type === l.type && u.owner === attacker);
    if (stack) {
      stack.count -= l.count;
      notes.push(`Attacker loses ${l.count}× ${def(l.type).display}`);
    }
  }
  ts.units = ts.units.filter((u) => u.count > 0);
  battle.pendingAttackerHits = 0;
  const winner = settle(state, territory, attacker, notes);
  if (winner !== null) battle.resolved = true;
  return { ok: true, concluded: winner !== null, notes };
}

/** Auto-assign the cheapest casualties for a paused battle. */
export function autoCasualties(state: GameState, territory: string): { ok: boolean; concluded: boolean; notes: string[] } {
  const battle = state.combat.battles.find((b) => b.territory === territory);
  if (!battle || !battle.pendingAttackerHits) return { ok: false, concluded: false, notes: ["No casualties to assign."] };
  const attacker = battle.attacker;
  const hits = battle.pendingAttackerHits;
  const notes: string[] = [];
  applyAttackerHits(state, territory, attacker, hits, notes);
  battle.pendingAttackerHits = 0;
  const winner = settle(state, territory, attacker, notes);
  if (winner !== null) battle.resolved = true;
  return { ok: true, concluded: winner !== null, notes };
}

/** Attacker withdraws survivors to one friendly adjacent territory. */
export function retreatBattle(state: GameState, territory: string): { ok: boolean; notes: string[] } {
  const battle = state.combat.battles.find((b) => b.territory === territory);
  if (!battle) return { ok: false, notes: ["No such battle."] };
  if (battle.amphibious) return { ok: false, notes: ["Amphibious assaults cannot retreat."] };
  if ((battle.pendingAttackerHits ?? 0) > 0) return { ok: false, notes: ["Assign casualties before retreating."] };
  const attacker = battle.attacker;
  const ts = state.territories[territory];
  const notes: string[] = [];

  const attackerStacks = ts.units.filter((u) => u.owner === attacker);
  if (attackerStacks.length === 0) return { ok: false, notes: ["Nothing to retreat."] };

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
  returnScrambled(state, battle, notes);
  battle.resolved = true;
  notes.push(`${POWERS[attacker].display} retreats ${moved} unit(s) from ${territory}.`);
  return { ok: true, notes };
}
