import type { GameState, PendingBattle, PowerId, TerritoryState, UnitStack, UnitTypeId } from "../types.js";
import { UNITS, hasFlag } from "../data/units.js";
import { areAllied, POWERS } from "../data/powers.js";
import { areEnemies } from "./politics.js";
import { isSea } from "../data/territories.js";
import { rollDie, resolveSalvo } from "./rng.js";
import { neighbours, addUnits, removeUnits } from "./setup.js";
import { hasTech } from "./research.js";
import { resolveSBR } from "./sbr.js";
import { captureTerritory } from "./control.js";

// ============================================================================
// General combat — faithful to Global 1940, supporting one-click auto-resolve
// and interactive round-by-round play in TripleA's step order:
//   1. Scramble decision — a human defender may scramble aircraft from
//      adjacent air bases into a sea battle (or decline)
//   2. Opening fire  — defending AAA vs air, shore bombardment (amphibious),
//                      submarine surprise strikes (negated by enemy destroyer),
//                      kamikaze strikes near held Japanese islands
//   3. Regular rounds — both salvos roll BEFORE any removals; then BOTH sides
//                      choose their casualties (auto-resolved when the choice
//                      is trivial or the side is the neutral garrison);
//                      artillery->infantry support, tactical-bomber pairing,
//                      tech effects, two-hit capital ships
//   4. Reactions      — attacker may retreat; either side's submarines may
//                      submerge out of the fight (no enemy destroyer present)
//   5. Conclusion     — conquest of land, capital looting, scrambled aircraft
//                      fly home, submerged subs resurface in the zone
// Strategic-bombing battles are resolved separately (see sbr.ts).
// ============================================================================

const def = (t: UnitTypeId) => UNITS[t];

const WARSHIPS = new Set<UnitTypeId>(["destroyer", "cruiser", "battleship", "aircraft_carrier"]);

// Japanese Pacific islands from which kamikaze pilots strike adjacent sea zones.
export const KAMIKAZE_ISLANDS = new Set<string>([
  "okinawa", "iwo_jima", "formosa", "marianas", "caroline_islands",
  "paulau_island", "marshall_islands", "guam", "wake_island",
]);

export type BattleSide = "attacker" | "defender";

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
  const defenders = expand(ts.units.filter((u) => areEnemies(state, u.owner, attacker)));
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

/** The power that answers prompts for the defending side of a battle. */
export function battleDefender(state: GameState, territory: string, attacker: PowerId): PowerId {
  const ts = state.territories[territory];
  const ctrl = ts.controller;
  if (ctrl && areEnemies(state, ctrl, attacker)) return ctrl;
  // Otherwise the enemy power with the most units present (e.g. a sea zone).
  const counts = new Map<PowerId, number>();
  for (const u of ts.units) {
    if (areEnemies(state, u.owner, attacker)) counts.set(u.owner, (counts.get(u.owner) ?? 0) + u.count);
  }
  let best: PowerId | undefined;
  for (const [p, n] of counts) if (!best || n > (counts.get(best) ?? 0)) best = p;
  return best ?? "Neutral";
}

/** Prompts for this side resolve automatically (neutral garrisons). */
const autoSide = (power: PowerId): boolean => power === "Neutral";

// --- dice (tech-aware) -----------------------------------------------------

export function attackDice(state: GameState, units: { type: UnitTypeId }[], attacker: PowerId): number[] {
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

export function defenseDice(state: GameState, units: { type: UnitTypeId; owner?: PowerId }[]): number[] {
  const targets: number[] = [];
  for (const u of units) {
    let d = def(u.type).defense;
    if (u.type === "fighter" && u.owner && hasTech(state, u.owner, "jet_fighters")) d = 5;
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

/** Adjacent enemy lands able to scramble aircraft into this sea battle. */
export function scrambleSources(state: GameState, territory: string, attacker: PowerId): string[] {
  if (!isSea(territory)) return [];
  const out: string[] = [];
  for (const land of neighbours(territory)) {
    if (isSea(land)) continue;
    const lt = state.territories[land];
    const c = lt.controller;
    if (!c || !areEnemies(state, c, attacker)) continue;
    if (!lt.units.some((u) => u.type === "air_base" && (u.owner === c || areAllied(u.owner, c)))) continue;
    if (!lt.units.some((u) => (u.type === "fighter" || u.type === "tactical_bomber") && u.owner === c)) continue;
    out.push(land);
  }
  return out;
}

/** Defenders scramble up to 3 fighters/tac from each adjacent enemy air base. */
function scrambleDefenders(state: GameState, battle: PendingBattle, notes: string[]): void {
  const sz = battle.territory;
  const attacker = battle.attacker;
  battle.scrambled = battle.scrambled ?? [];
  for (const land of scrambleSources(state, sz, attacker)) {
    const lt = state.territories[land];
    const c = lt.controller!;
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
    const homeFriendly = !!home?.controller && !areEnemies(state, home.controller, s.owner);
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
  if ((state.kamikaze ?? 0) <= 0 || !areEnemies(state, "Japan", attacker)) return null;
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

function openingFire(state: GameState, battle: PendingBattle, notes: string[], doScramble: boolean): void {
  const territory = battle.territory;
  const attacker = battle.attacker;
  const sea = isSea(territory);
  // Add scrambled defenders before reading sides (skipped when the defender
  // already made the scramble decision via the scramble/decline actions).
  if (sea && doScramble && !battle.scrambled) scrambleDefenders(state, battle, notes);
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

/** Roll one round's salvos for both sides WITHOUT removing anyone. */
function rollRound(
  state: GameState,
  territory: string,
  attacker: PowerId,
): { log: CombatRoundLog; hitsOnDefender: number; hitsOnAttacker: number } {
  const { attackers, defenders } = readSides(state, territory, attacker);
  const lowLuck = state.options.lowLuck;
  const atk = resolveSalvo(state, attackDice(state, attackers, attacker), lowLuck);
  const dfn = resolveSalvo(state, defenseDice(state, defenders), lowLuck);
  return {
    log: { round: 0, attackerRolls: atk.rolls, defenderRolls: dfn.rolls, attackerHits: atk.hits, defenderHits: dfn.hits },
    hitsOnDefender: Math.min(atk.hits, defenders.length ? defenders.reduce((n, u) => n + u.hp, 0) : 0),
    hitsOnAttacker: Math.min(dfn.hits, attackers.length ? attackers.reduce((n, u) => n + u.hp, 0) : 0),
  };
}

/** Remove `hits` from one side, cheapest-first. */
function applySideHits(state: GameState, territory: string, attacker: PowerId, side: BattleSide, hits: number, notes: string[]): void {
  if (hits <= 0) return;
  const { ts, attackers, defenders } = readSides(state, territory, attacker);
  if (side === "attacker") {
    writeSides(ts, applyHits(attackers, hits, notes, "Attacker"), defenders);
  } else {
    writeSides(ts, attackers, applyHits(defenders, hits, notes, "Defender"));
  }
}

/**
 * A side's pending hits resolve without a prompt when the choice is trivial
 * (no hits, a single unit type, or every unit dies) or the side is automated.
 */
function autoResolveTrivial(state: GameState, battle: PendingBattle, notes: string[]): void {
  const { attackers, defenders } = readSides(state, battle.territory, battle.attacker);
  const sides: Array<{ side: BattleSide; units: CombatUnit[]; pending: number; chooser: PowerId }> = [
    { side: "defender", units: defenders, pending: battle.pendingDefenderHits ?? 0, chooser: battle.defender ?? "Neutral" },
    { side: "attacker", units: attackers, pending: battle.pendingAttackerHits ?? 0, chooser: battle.attacker },
  ];
  for (const s of sides) {
    if (s.pending <= 0) {
      if (s.side === "defender") battle.pendingDefenderHits = 0;
      else battle.pendingAttackerHits = 0;
      continue;
    }
    const distinctTypes = new Set(s.units.map((u) => u.type)).size;
    const totalHp = s.units.reduce((n, u) => n + u.hp, 0);
    const trivial = distinctTypes <= 1 || s.pending >= totalHp;
    if (trivial || autoSide(s.chooser)) {
      applySideHits(state, battle.territory, battle.attacker, s.side, s.pending, notes);
      if (s.side === "defender") battle.pendingDefenderHits = 0;
      else battle.pendingAttackerHits = 0;
    }
  }
}

const battleAwaits = (battle: PendingBattle): boolean =>
  (battle.pendingAttackerHits ?? 0) > 0 || (battle.pendingDefenderHits ?? 0) > 0 || !!battle.awaitingScramble;

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
  const battle = state.combat.battles.find((b) => b.territory === territory);
  if (battle) {
    // Battle decided: scrambled aircraft fly home, submerged subs resurface.
    returnScrambled(state, battle, notes);
    resurfaceSubs(state, battle);
  }
  if (winner === "attacker" && !sea && attackers.some((u) => def(u.type).domain === "land")) {
    captureTerritory(state, ts, attacker, notes);
  }
  return winner;
}

function resurfaceSubs(state: GameState, battle: PendingBattle): void {
  if (!battle.submergedSubs?.length) return;
  const ts = state.territories[battle.territory];
  for (const s of battle.submergedSubs) addUnits(ts, "submarine", s.count, s.owner);
  battle.submergedSubs = [];
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

  if (battle) {
    battle.defender = battle.defender ?? battleDefender(state, territory, attacker);
    battle.awaitingScramble = false;
    // Clear any half-assigned interactive pools first (cheapest-first).
    applySideHits(state, territory, attacker, "defender", battle.pendingDefenderHits ?? 0, text);
    applySideHits(state, territory, attacker, "attacker", battle.pendingAttackerHits ?? 0, text);
    battle.pendingDefenderHits = 0;
    battle.pendingAttackerHits = 0;
    if (!battle.started) {
      openingFire(state, battle, text, true);
      battle.started = true;
    }
  }

  const rounds: CombatRoundLog[] = [];
  let winner = settle(state, territory, attacker, text);
  let n = 0;
  while (winner === null && n < 50) {
    n += 1;
    const { log, hitsOnDefender, hitsOnAttacker } = rollRound(state, territory, attacker);
    applySideHits(state, territory, attacker, "defender", hitsOnDefender, text);
    applySideHits(state, territory, attacker, "attacker", hitsOnAttacker, text);
    log.round = n;
    rounds.push(log);
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

export interface StepResult {
  concluded: boolean;
  awaitingCasualties: boolean;
  awaitingScramble?: boolean;
  notes: string[];
}

/**
 * Fight a single round (interactive). Pauses for the defender's scramble
 * decision when the battle opens, and for EITHER side's casualty choice
 * after the salvos (trivial choices and neutral garrisons auto-resolve).
 */
export function stepBattle(state: GameState, territory: string): StepResult {
  const battle = state.combat.battles.find((b) => b.territory === territory);
  if (!battle) return { concluded: true, awaitingCasualties: false, notes: ["No such battle."] };

  if (battle.sbr) {
    const r = resolveSBR(state, territory, battle.bombardFrom ?? "");
    battle.resolved = true;
    battle.lastRound = { attackerRolls: [], defenderRolls: [], attackerHits: 0, defenderHits: 0, notes: r.text };
    return { concluded: true, awaitingCasualties: false, notes: r.text };
  }

  const attacker = battle.attacker;
  battle.defender = battle.defender ?? battleDefender(state, territory, attacker);
  const notes: string[] = [];

  // Scramble interrupt: ask the defender before the battle opens.
  if (!battle.started && battle.scrambled === undefined && !battle.awaitingScramble) {
    const sources = scrambleSources(state, territory, attacker);
    if (sources.length > 0 && !autoSide(battle.defender)) {
      battle.awaitingScramble = true;
      notes.push(`${POWERS[battle.defender].display} may scramble aircraft to defend ${territory}.`);
      return { concluded: false, awaitingCasualties: false, awaitingScramble: true, notes };
    }
  }
  if (battle.awaitingScramble) {
    return { concluded: false, awaitingCasualties: false, awaitingScramble: true, notes: ["Waiting for the defender's scramble decision."] };
  }
  if (battleAwaits(battle)) {
    return { concluded: false, awaitingCasualties: true, notes: ["Choose casualties first."] };
  }

  if (!battle.started) {
    openingFire(state, battle, notes, true);
    battle.started = true;
    battle.roundsFought = 0;
    const early = settle(state, territory, attacker, notes);
    if (early !== null) {
      battle.resolved = true;
      battle.lastRound = { attackerRolls: [], defenderRolls: [], attackerHits: 0, defenderHits: 0, notes };
      return { concluded: true, awaitingCasualties: false, notes };
    }
  }

  const { log, hitsOnDefender, hitsOnAttacker } = rollRound(state, territory, attacker);
  battle.roundsFought = (battle.roundsFought ?? 0) + 1;
  battle.pendingDefenderHits = hitsOnDefender;
  battle.pendingAttackerHits = hitsOnAttacker;
  autoResolveTrivial(state, battle, notes);
  battle.lastRound = {
    attackerRolls: log.attackerRolls,
    defenderRolls: log.defenderRolls,
    attackerHits: log.attackerHits,
    defenderHits: log.defenderHits,
    notes,
  };

  if (battleAwaits(battle)) {
    return { concluded: false, awaitingCasualties: true, notes };
  }

  const winner = settle(state, territory, attacker, notes);
  if (winner !== null) {
    battle.resolved = true;
    return { concluded: true, awaitingCasualties: false, notes };
  }
  return { concluded: false, awaitingCasualties: false, notes };
}

/** Accept the scramble prompt: aircraft fly in from every eligible base. */
export function acceptScramble(state: GameState, territory: string): { ok: boolean; notes: string[] } {
  const battle = state.combat.battles.find((b) => b.territory === territory);
  if (!battle?.awaitingScramble) return { ok: false, notes: ["No scramble decision pending."] };
  const notes: string[] = [];
  scrambleDefenders(state, battle, notes);
  battle.awaitingScramble = false;
  return { ok: true, notes };
}

/** Decline the scramble prompt. */
export function declineScramble(state: GameState, territory: string): { ok: boolean; notes: string[] } {
  const battle = state.combat.battles.find((b) => b.territory === territory);
  if (!battle?.awaitingScramble) return { ok: false, notes: ["No scramble decision pending."] };
  battle.scrambled = []; // decided: nothing scrambles
  battle.awaitingScramble = false;
  return { ok: true, notes: [`${POWERS[battle.defender ?? "Neutral"].display} declines to scramble.`] };
}

/** Apply one side's chosen casualties for a paused battle. */
export function assignCasualties(
  state: GameState,
  territory: string,
  losses: { type: UnitTypeId; count: number }[],
  side: BattleSide = "attacker",
): { ok: boolean; concluded: boolean; notes: string[] } {
  const battle = state.combat.battles.find((b) => b.territory === territory);
  const pending = side === "attacker" ? battle?.pendingAttackerHits : battle?.pendingDefenderHits;
  if (!battle || !pending) return { ok: false, concluded: false, notes: ["No casualties to assign."] };
  const attacker = battle.attacker;
  const ts = state.territories[territory];
  const mine = (u: UnitStack) =>
    side === "attacker" ? u.owner === attacker : areEnemies(state, u.owner, attacker);
  const total = losses.reduce((n, l) => n + l.count, 0);
  if (total !== pending) {
    return { ok: false, concluded: false, notes: [`Assign exactly ${pending} casualties.`] };
  }
  for (const l of losses) {
    const have = ts.units.filter((u) => u.type === l.type && mine(u)).reduce((n, u) => n + u.count, 0);
    if (have < l.count) return { ok: false, concluded: false, notes: ["You don't have those units to lose."] };
  }
  const notes: string[] = [];
  const label = side === "attacker" ? "Attacker" : "Defender";
  for (const l of losses) {
    let left = l.count;
    for (const stack of ts.units) {
      if (left <= 0) break;
      if (stack.type !== l.type || !mine(stack)) continue;
      const take = Math.min(stack.count, left);
      stack.count -= take;
      left -= take;
    }
    notes.push(`${label} loses ${l.count}× ${def(l.type).display}`);
  }
  ts.units = ts.units.filter((u) => u.count > 0);
  if (side === "attacker") battle.pendingAttackerHits = 0;
  else battle.pendingDefenderHits = 0;

  if (battleAwaits(battle)) return { ok: true, concluded: false, notes };
  const winner = settle(state, territory, attacker, notes);
  if (winner !== null) battle.resolved = true;
  return { ok: true, concluded: winner !== null, notes };
}

/** Auto-assign the cheapest casualties for whichever pools are pending. */
export function autoCasualties(
  state: GameState,
  territory: string,
  side?: BattleSide,
): { ok: boolean; concluded: boolean; notes: string[] } {
  const battle = state.combat.battles.find((b) => b.territory === territory);
  if (!battle || !battleAwaits(battle) || battle.awaitingScramble) {
    return { ok: false, concluded: false, notes: ["No casualties to assign."] };
  }
  const attacker = battle.attacker;
  const notes: string[] = [];
  const doSide = (s: BattleSide) => {
    const pending = s === "attacker" ? battle.pendingAttackerHits ?? 0 : battle.pendingDefenderHits ?? 0;
    if (pending > 0) applySideHits(state, territory, attacker, s, pending, notes);
    if (s === "attacker") battle.pendingAttackerHits = 0;
    else battle.pendingDefenderHits = 0;
  };
  if (side) doSide(side);
  else {
    doSide("defender");
    doSide("attacker");
  }
  if (battleAwaits(battle)) return { ok: true, concluded: false, notes };
  const winner = settle(state, territory, attacker, notes);
  if (winner !== null) battle.resolved = true;
  return { ok: true, concluded: winner !== null, notes };
}

/** Submerge one side's submarines out of the battle (no enemy destroyer). */
export function submergeSubs(state: GameState, territory: string, side: BattleSide): { ok: boolean; notes: string[] } {
  const battle = state.combat.battles.find((b) => b.territory === territory);
  if (!battle || battle.resolved) return { ok: false, notes: ["No unresolved battle there."] };
  if (!isSea(territory)) return { ok: false, notes: ["Only naval submarines can submerge."] };
  if (battleAwaits(battle)) return { ok: false, notes: ["Resolve pending casualties first."] };
  const attacker = battle.attacker;
  const ts = state.territories[territory];
  const mine = (u: UnitStack) =>
    side === "attacker" ? u.owner === attacker : areEnemies(state, u.owner, attacker);
  const theirs = (u: UnitStack) => (side === "attacker" ? areEnemies(state, u.owner, attacker) : u.owner === attacker);
  if (ts.units.some((u) => theirs(u) && hasFlag(u.type, "negates_sub_special"))) {
    return { ok: false, notes: ["An enemy destroyer prevents your submarines from submerging."] };
  }
  const subs = ts.units.filter((u) => u.type === "submarine" && mine(u));
  if (subs.length === 0) return { ok: false, notes: ["No submarines to submerge."] };
  battle.submergedSubs = battle.submergedSubs ?? [];
  const notes: string[] = [];
  for (const s of subs) {
    battle.submergedSubs.push({ owner: s.owner, count: s.count });
    notes.push(`${POWERS[s.owner].display} submerges ${s.count}× submarine.`);
  }
  ts.units = ts.units.filter((u) => !(u.type === "submarine" && mine(u)));
  // Submerging may end the battle (e.g. subs were the last combatants).
  const winner = settle(state, territory, attacker, notes);
  if (winner !== null) battle.resolved = true;
  return { ok: true, notes };
}

/** Attacker withdraws survivors to one friendly adjacent territory. */
export function retreatBattle(state: GameState, territory: string): { ok: boolean; notes: string[] } {
  const battle = state.combat.battles.find((b) => b.territory === territory);
  if (!battle) return { ok: false, notes: ["No such battle."] };
  if (battle.amphibious) return { ok: false, notes: ["Amphibious assaults cannot retreat."] };
  if (battleAwaits(battle)) return { ok: false, notes: ["Assign casualties before retreating."] };
  const attacker = battle.attacker;
  const ts = state.territories[territory];
  const notes: string[] = [];

  const attackerStacks = ts.units.filter((u) => u.owner === attacker);
  if (attackerStacks.length === 0) return { ok: false, notes: ["Nothing to retreat."] };

  const friendly = (id: string): boolean => {
    const c = state.territories[id].controller;
    const noEnemies = !state.territories[id].units.some((u) => areEnemies(state, u.owner, attacker));
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
  resurfaceSubs(state, battle);
  battle.resolved = true;
  notes.push(`${POWERS[attacker].display} retreats ${moved} unit(s) from ${territory}.`);
  return { ok: true, notes };
}
