# Fluxfall — Stormglass prototype

Fluxfall is a one-thumb portrait puzzle game about charged ceramic beads in a living magnetic field. Opposite poles bond, matching poles repel, and alternating closed loops collapse into score.

This prototype deliberately begins in the playable jar. There is no landing page, account flow, currency, upgrade tree, or decorative menu between the player and the verb.

## Run it

From this directory:

```powershell
python -m http.server 8123 --bind 127.0.0.1
```

Then open `http://127.0.0.1:8123` on a portrait browser. It has no packages, build step, network calls, or external assets.

## Controls and rules

- Slide horizontally to aim; release to drop.
- Tap `?` at any time for the four-rule field manual; the simulation pauses while it is open.
- `+` and `−` attract and form permanent bonds.
- Matching poles push apart before contact.
- Each bead has two visible sockets and can hold at most two bonds.
- Close an even alternating loop to clear it and score.
- Larger rings and cascade waves are worth more.
- Let the field remain above the coral danger line and the run ends.
- Keyboard: left/right arrows aim; Space or Enter drops.

The opening is a guaranteed six-piece closure, but the bead now falls from the player's chosen x-position before visibly snapping into the highlighted gap. Event-driven coaching then teaches bonding, loop closure, and the danger line across the first few real drops.

## Premium bar

The presentation is a restrained stormglass instrument: smoked laboratory glass, blackened mineral cores, polarity-specific glyphs/rim language, fine animated field lines, an aurora membrane on closure, procedural glass audio, and reduced-motion support. Polarity is never communicated by color alone.

The physics loop is fixed-step and deterministic in its random sequence. Core graph, scoring, capture, and polarity logic live in `core.mjs` and run under Node's built-in test runner:

```powershell
node --test tests/*.test.mjs
```

The gameplay smoke test uses a minimal DOM/canvas harness to perform the opening gesture, advance the fixed-step simulation, and verify that the authored first loop awards exactly 100 points.

## Prototype success gates

- 80% of cold testers release the first bead within three seconds without a tutorial card.
- The opening closure succeeds from every legal horizontal release.
- A median tester makes an earned second ring by input eight.
- After three runs, players can name a tactic and a correctable mistake.
- Cold runs land near 45–75 seconds and players voluntarily restart without progression rewards.
- Players talk about bridging, curling, and charge separation—not only the visual effect.

## Current boundary

This is the high-fidelity verb prototype, not a content-complete game. Device feel-tuning, cold-user testing, native haptic mapping, store-safe naming, telemetry, and a performance pass on older phones come after the core loop earns them. `Fluxfall` remains a working title pending formal name clearance.
