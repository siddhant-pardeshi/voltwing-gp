# Nova — the mascot guide

Nova is the game's living guide: a chibi kid in a pale-blue fox hoodie with a gold star charm, rebuilt from the studio's character reference sheet as a layered SVG rig. She is not a video, a GIF, or a single bouncing image — every part of her (ears, eyes, mouth, arms, tail, head) is a separate vector group animated by a state machine.

## Character invariants

Whatever reskins or sizes happen later, these stay fixed:

- **Silhouette:** big head, small body, wide-set angled fox ears, large cream-tipped tail on her left.
- **Palette:** pale-blue hoodie (`#BCD7F6`), cream lining and belly (`#F7F1E4`), medium-brown skin (`#C1814E`), swept black hair (`#242832`), brown eyes (`#5C3A26`), navy shorts (`#33405F`), gold four-point star charm (`#F4C64F`).
- **Charm:** the star on her chest always reads at a glance; it is her signature.
- **Reference image wins** over any written description if they ever conflict.

## Animation states

| State | Performance | Used for |
| --- | --- | --- |
| `idle` | Breathing, soft blinks, gentle ear twitches, tail sway, occasional glances | Default between events |
| `wave` | Right arm up, three swings, head tilt | Greetings, resume |
| `cheer` | Both arms up, hop, star sparkle pulse | Gates threaded, laps, victory |
| `alert` | Jump + raised arm + widened eyes | Warnings |
| `think` | Hand to chin, head tilt | (reserved for hint flows) |
| `sad` | Head down, brows tilted, small frown | Crashes, off-track, losing |
| `sleep` | Eyes closed, slouch, floating z's | Pause, long idle |
| `point` | Arm extended | Directional hints |
| `enter` / `hide` | Bounce in / fade out | First visit / user hides her |

One-shot states automatically return to `idle`; higher-priority states interrupt lower ones (sleep > cheer > alert > wave > think), and per-event **cooldowns** stop her from spamming during rapid gameplay.

## Event wiring in this game

| Game event | Line pool (rotates, never repeats back-to-back) | Animation |
| --- | --- | --- |
| First visit / return | "Nova here, pit chief…" / "Back for another lap?" | `wave` |
| Race start | "Eyes up — grid drops in three!" | `alert` |
| Orbit gate threaded | "Gate threaded — cell is climbing." | `cheer` |
| Collision / off-track | "Easy! That drone dented my paintwork." | `sad` |
| Lap complete | "Lap down. The field is sweating." | `cheer` |
| Boost cell low | "Boost cell is nearly dry — hunt a gate!" | `alert` |
| Race won | "Chequered light! What a lap sheet." | `cheer` |
| Race lost | "They took this one. Rematch, pilot?" | `sad` |
| Pause / resume | — / "She is charged and waiting." | `sleep` / `wave` |

Speech bubbles use a typewriter reveal, tap to dismiss, and the mouth flaps while a line is up. All mascot dialogue is authored in `js/game.js` under `window.GAME.mascot.lines` — no network calls, no AI backend.

## Controls

- Settings → **Show Nova** hides/shows her.
- Reduced-motion (OS setting or in-game toggle) disables bounces and loops, keeping only slow blinks.
- She never covers the crosshair area, touch controls, or HUD chips: the dock sits bottom-right on desktop, bottom-left on touch, and shrinks on small screens.

## Replacing the art safely

The whole character is one SVG string in `js/mascot.js` (const `SVG`) plus one stylesheet (const `CSS`). To re-skin:

1. Keep every `id` (`m-armR`, `m-earL`, `m-eyeL`, `m-mouth`, `m-tail`, `m-charm`, …) — the state machine targets them.
2. Keep the layer order (tail → body → head) or overlaps will break.
3. Swap palette hexes in the `P` object; animations reference colors only through it.
4. Test every state with `?mascot=gallery` appended to any game URL — it renders all states side by side.
