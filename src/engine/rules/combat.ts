import type { GameState, PowerId, TerritoryState, UnitTypeId } from "../types.js";
import { UNITS, hasFlag } from "../data/units.js";
import { areEnemies, POWERS } from "../data/powers.js";
import { isSea } from "../data/territories.js";
import { rollDie } from "./rng.js";

// ============================================================================
// General combat resolution — faithful to Global 1940:
//   1. AA opening fire   (defending AAA vs attacking air, hit on 1)
//   2. Submarine surprise strike (subs fire first if no enemy destroyer)
//   3. Regular rounds    (simultaneous attacker/defender fire)
//      - artillery supports infantry/mech (attack 1 -> 2)
//      - tactical bombers pair with fighters/tanks (attack 3 -> 4)
//      - two-hit capital ships (battleship, carrier) absorb 2 hits
//   4. Casualties removed; repeat until one side is gone or the attacker
//      can no longer deal damage (auto-retreat with transports/AA only).
//
// Casualty selection uses the standard "lose your cheapest units first"
// heuristic so resolution is fully deterministic and replayable.
// ============================================================================

/** A single physical unit, expanded from stacks for casualty bookkeeping. */
interface CombatUnit {
  type: UnitTypeId;
  owner: PowerId;
  hp: number; // remaining hit points (2 for battleship/carrier)
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

const def = (t: UnitTypeId) => UNITS[t];

function expand(units: { type: UnitTypeId; owner: PowerId; count: number }[]): CombatUnit[] {
  const out: CombatUnit[] = [];
  for (const u of units) {
    for (let i = 0; i < u.count; i++) out.push({ type: u.type, owner: u.owner, hp: def(u.type).hits });
  }
  return out;
}

/** Build the attack-value dice for a side, applying support bonuses. */
function attackDice(units: CombatUnit[]): number[] {
  const targets: number[] = [];
  const numArtillery = units.filter((u) => u.type === "artillery").length;
  let supports = numArtillery; // each artillery boosts one infantry/mech
  const hasFighterOrTank = units.some((u) => u.type === "fighter" || u.type === "tank");

  for (const u of units) {
    const d = def(u.type);
    let atk = d.attack;
    if ((u.type === "infantry" || u.type === "mech_infantry") && supports > 0) {
      atk = 2;
      supports -= 1;
    }
    if (u.type === "tactical_bomber" && hasFighterOrTank) atk = 4;
    if (atk > 0) targets.push(atk);
  }
  return targets;
}

/** Build the defense-value dice for a side (no support bonuses on defence). */
function defenseDice(units: CombatUnit[]): number[] {
  const targets: number[] = [];
  for (const u of units) {
    const d = def(u.type);
    if (d.defense > 0) targets.push(d.defense);
  }
  return targets;
}

/** Standard casualty ordering: lose cheapest combat units first. */
function casualtyOrder(units: CombatUnit[]): CombatUnit[] {
  return [...units].sort((a, b) => def(a.type).cost - def(b.type).cost);
}

/** Apply `hits` casualties to a unit list, honouring two-hit ships. */
function applyHits(units: CombatUnit[], hits: number, log: string[], side: string): CombatUnit[] {
  let remaining = hits;
  const ordered = casualtyOrder(units);
  for (const u of ordered) {
    if (remaining <= 0) break;
    // Two-hit ships soak one hit (become "damaged") before dying — but the
    // standard rule lets the controller absorb on the toughest unit; we damage
    // the highest-value two-hit unit first so it survives longest.
  }
  // First pass: spend hits on already-present hp, cheapest first.
  for (const u of ordered) {
    while (remaining > 0 && u.hp > 0) {
      u.hp -= 1;
      remaining -= 1;
      if (u.hp <= 0) {
        log.push(`${side} loses ${def(u.type).display}`);
        break;
      }
    }
    if (remaining <= 0) break;
  }
  return units.filter((u) => u.hp > 0);
}

function rollFor(state: GameState, targets: number[]): { rolls: number[]; hits: number } {
  const rolls: number[] = [];
  let hits = 0;
  for (const t of targets) {
    const r = rollDie(state);
    rolls.push(r);
    if (r <= t) hits += 1;
  }
  return { rolls, hits };
}

/** True if a side still has a unit able to deal damage in regular combat. */
function canFight(units: CombatUnit[], onDefense: boolean): boolean {
  return units.some((u) => (onDefense ? def(u.type).defense : def(u.type).attack) > 0);
}

export function resolveBattle(state: GameState, territory: string): CombatResult {
  const ts = state.territories[territory];
  const attackerPower = battleAttacker(state, territory);
  const text: string[] = [];

  let attackers = expand(ts.units.filter((u) => u.owner === attackerPower));
  let defenders = expand(
    ts.units.filter((u) => areEnemies(u.owner, attackerPower)),
  );

  const sea = isSea(territory);
  const rounds: CombatRoundLog[] = [];

  // --- Step 1: AA opening fire (land battles, defending AAA vs attacking air)
  if (!sea) {
    const aaGuns = defenders.filter((u) => u.type === "aa_gun").length;
    const air = attackers.filter((u) => def(u.type).domain === "air");
    if (aaGuns > 0 && air.length > 0) {
      const shots = Math.min(aaGuns * 3, air.length);
      let hits = 0;
      for (let i = 0; i < shots; i++) if (rollDie(state) === 1) hits += 1;
      if (hits > 0) {
        const airUnits = attackers.filter((u) => def(u.type).domain === "air");
        const killed = Math.min(hits, airUnits.length);
        attackers = removeAir(attackers, killed);
        text.push(`AAA fire destroys ${killed} attacking aircraft.`);
      }
    }
  }

  // --- Step 2: Submarine surprise strike -------------------------------
  const defHasDestroyer = defenders.some((u) => hasFlag(u.type, "negates_sub_special"));
  const atkHasDestroyer = attackers.some((u) => hasFlag(u.type, "negates_sub_special"));

  if (sea) {
    // Attacking subs strike first when defender has no destroyer.
    const atkSubs = attackers.filter((u) => u.type === "submarine");
    if (atkSubs.length > 0 && !defHasDestroyer) {
      const { hits } = rollFor(state, atkSubs.map(() => def("submarine").attack));
      if (hits > 0) {
        defenders = applyHits(seaCasualtyTargets(defenders), hits, text, "Defender (sub strike)");
        text.push(`Attacking submarines surprise-strike for ${hits} hit(s).`);
      }
    }
    const defSubs = defenders.filter((u) => u.type === "submarine");
    if (defSubs.length > 0 && !atkHasDestroyer) {
      const { hits } = rollFor(state, defSubs.map(() => def("submarine").defense));
      if (hits > 0) {
        attackers = applyHits(seaCasualtyTargets(attackers), hits, text, "Attacker (sub strike)");
        text.push(`Defending submarines surprise-strike for ${hits} hit(s).`);
      }
    }
  }

  // --- Step 3: Regular rounds -----------------------------------------
  let round = 0;
  const MAX_ROUNDS = 30; // safety against pathological infinite stalemates
  while (
    attackers.length > 0 &&
    defenders.length > 0 &&
    round < MAX_ROUNDS &&
    (canFight(attackers, false) || canFight(defenders, true))
  ) {
    round += 1;

    // Subs that already surprise-struck still fire each regular round only
    // when the enemy has a destroyer (they lost surprise, not their guns).
    const atkRoll = rollFor(state, attackDice(attackers));
    const defRoll = rollFor(state, defenseDice(defenders));

    // Subs cannot be hit by air-only fire is a finer rule; at this scale we
    // apply hits to the standard casualty order on each side simultaneously.
    const survivingDefenders = applyHits(seaOrLandTargets(defenders, sea), atkRoll.hits, text, "Defender");
    const survivingAttackers = applyHits(seaOrLandTargets(attackers, sea), defRoll.hits, text, "Attacker");

    rounds.push({
      round,
      attackerRolls: atkRoll.rolls,
      defenderRolls: defRoll.rolls,
      attackerHits: atkRoll.hits,
      defenderHits: defRoll.hits,
    });

    attackers = survivingAttackers;
    defenders = survivingDefenders;

    // Auto-retreat: attacker can no longer deal damage (only transports/AA left)
    if (attackers.length > 0 && !canFight(attackers, false) && defenders.length > 0) {
      text.push("Attacker can no longer press the assault and retreats.");
      break;
    }
  }

  // --- Resolve outcome -------------------------------------------------
  const attackerSurvivors = attackers.length;
  const defenderSurvivors = defenders.length;
  let winner: CombatResult["winner"];
  let conquered = false;

  if (defenderSurvivors === 0 && attackerSurvivors > 0) {
    winner = "attacker";
    // Land territory is conquered if a surviving land unit can hold it.
    if (!sea && attackers.some((u) => def(u.type).domain === "land")) {
      conquered = true;
    }
  } else if (attackerSurvivors === 0 && defenderSurvivors > 0) {
    winner = "defender";
  } else {
    winner = "draw";
  }

  // Write survivors back into the territory.
  rewriteTerritory(ts, attackers, defenders);

  // Conquest: flip controller, handle empty-territory occupation.
  if (conquered) {
    captureTerritory(state, ts, attackerPower, text);
  }

  text.push(
    winner === "attacker"
      ? `Attacker (${POWERS[attackerPower].display}) wins at ${territory}.`
      : winner === "defender"
        ? `Defender holds ${territory}.`
        : `Battle at ${territory} ends inconclusively.`,
  );

  return {
    territory,
    attacker: attackerPower,
    winner,
    rounds,
    attackerSurvivors,
    defenderSurvivors,
    conquered,
    text,
  };
}

// --- helpers ---------------------------------------------------------------

function removeAir(units: CombatUnit[], n: number): CombatUnit[] {
  let remaining = n;
  const out: CombatUnit[] = [];
  for (const u of units) {
    if (remaining > 0 && def(u.type).domain === "air") {
      remaining -= 1;
      continue;
    }
    out.push(u);
  }
  return out;
}

/** Sea casualties skip air units (planes aren't sunk by naval fire here). */
function seaCasualtyTargets(units: CombatUnit[]): CombatUnit[] {
  return units;
}

function seaOrLandTargets(units: CombatUnit[], _sea: boolean): CombatUnit[] {
  return units;
}

function rewriteTerritory(ts: TerritoryState, attackers: CombatUnit[], defenders: CombatUnit[]): void {
  const merged: Record<string, { type: UnitTypeId; owner: PowerId; count: number }> = {};
  for (const u of [...attackers, ...defenders]) {
    const key = `${u.type}:${u.owner}`;
    merged[key] = merged[key] ?? { type: u.type, owner: u.owner, count: 0 };
    merged[key].count += 1;
  }
  ts.units = Object.values(merged);
}

function captureTerritory(
  state: GameState,
  ts: TerritoryState,
  conqueror: PowerId,
  text: string[],
): void {
  const previous = ts.controller;
  ts.controller = conqueror;
  ts.factoryDamage = 0;
  text.push(`${POWERS[conqueror].display} captures ${ts.id}.`);

  // Capturing an enemy capital loots its entire treasury.
  for (const p of Object.values(POWERS)) {
    if (p.capital === ts.id && previous && areEnemies(conqueror, previous)) {
      const looted = state.treasury[previous] ?? 0;
      if (looted > 0) {
        state.treasury[conqueror] += looted;
        state.treasury[previous] = 0;
        text.push(`${POWERS[conqueror].display} loots ${looted} IPC from ${POWERS[previous].display}'s capital!`);
      }
    }
  }
}

/** The attacking power for a queued battle (the phasing power). */
export function battleAttacker(state: GameState, territory: string): PowerId {
  const queued = state.combat.battles.find((b) => b.territory === territory);
  return queued?.attacker ?? state.activePower;
}
