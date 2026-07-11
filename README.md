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
- Beads never drop automatically in this prototype. Take as long as you need to aim.
- Tap `?` at any time for the four-rule field manual; the simulation pauses while it is open.
- `+` and `−` attract and form permanent bonds.
- Matching poles push apart before contact.
- Bright connectors show real bonds; pulsing pearls mark the two open ends of each chain.
- Build an alternating chain, then drop one opposite bead into a glowing bridge that touches both open ends.
- Closing that even loop clears it and scores.
- Larger rings and cascade waves are worth more.
- Let the field remain above the coral danger line and the run ends.
- Keyboard: left/right arrows aim; Space or Enter drops.

The opening demonstrates a six-piece closure. The next lesson pauses on a pinned three-bead U-chain and waits indefinitely for the player to bridge its two glowing ends with a fourth bead. A missed attempt is returned for another try. Free play then keeps real bonds, endpoints, and any immediately closable bridge visible.

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
