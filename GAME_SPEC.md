# Ring Runner game specification

## Player goal

Complete one circuit of the fixed ring without touching a thorn demon.
The camera remains visible inside the ring throughout play.

## Track and progress

- The ring is fixed to the screen and never rotates.
- It begins red.
- As the player demon travels, the completed arc becomes pink and remains pink.
- The coverage begins at the player spawn point and grows in the player's direction.
- The completed arc is a thin outline directly on the player track, so it visibly records where the player has travelled.
- A full pink ring completes the round.

## Actors

- One player demon moves around the track.
- Three thorn demons rotate together around the fixed ring, spaced 120 degrees apart.
- Every demon remains small enough to read as a sprite, never as a full-screen square.
- The player sprite and thorn sprites rotate tangentially with the track.

## Input and collision

- The title screen reads `RING RUNNER` and `TAP TO START`.
- During play, one tap makes the player demon jump inward toward the centre of the ring.
- The jump follows a smooth arc and returns to the track.
- Contact with a thorn while on the track ends the round.
- A sufficiently deep inward jump clears a thorn.

## Result states

- Failure: show `OH NO, YOU FAILED!` and a visible `[ RETRY ]` control.
- Success: show `RING COMPLETE!` and a restart instruction.
- Tapping after either result starts a new round with red progress.

## Scene conventions

- Keep `GameController` on `Game Container`.
- The three thorns are direct children named `Obstacle Demon`, `Obstacle Demon 1`, and `Obstacle Demon 2`.
- `GameOver UI` is a direct child of `Game Container` and contains the result text.
- The final ring graph material exposes a float input named `coverage`, from `0` (all red) to `1` (all pink).
