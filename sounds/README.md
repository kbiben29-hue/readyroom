# Sound effects

One file per moment in the game. To use your own sound, delete the file here
and add yours with the same name (only the extension may differ: `.mp3`,
`.wav`, `.m4a`, `.aac` or `.ogg`). A moment with no file is silent.

| Name       | When it plays                                     |
| ---------- | ------------------------------------------------- |
| `play`     | Playing a card                                    |
| `activate` | Using a card already in play                      |
| `swoosh`   | Chits and tokens flying                           |
| `land`     | A token landing                                   |
| `alert`    | Red event cards (Red Alert and other Incidents)   |
| `warning`  | Taking an Incident                                |
| `pass`     | Ending a phase                                    |
| `endTurn`  | Ending your turn                                  |
| `mission`  | Completing a mission                              |
| `undo`     | Undo                                              |
| `beam`     | A card beamed aboard, or an Away Team sent down   |
| `click`    | Any other button press                            |
| `victory`  | End of the game, you won                          |
| `defeat`   | End of the game, you lost                         |
| `theme`    | Music on the main menu (loops)                    |

The game picks up the files when it is built: the iPad/iPhone web page
rebuilds by itself after a change here, and the Windows/Mac installers need a
new build.
