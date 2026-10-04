# party: three real sessions with party loaded, in tmux. 3P (app-review)
# comments on PR #12 and is busy; 2P (app-feature) then tries to merge #12,
# party's lock turns the merge into a permission prompt naming 3P, and 2P
# waits on you. 1UP (app, left) opens /party: 2P's wait bar fills over
# nagMinutes (1, the lowest) and turns red. demos/party/start.sh builds the
# panes, isolates party's store and drives the side panes off camera; gh is
# the fixture stub (scenario party-lock).
Output assets/party.gif
Source demos/tapes/common.tape
# Bigger and finer than the rest, so three sessions and the full pane fit.
Set FontSize 14
Set Width 1400
Set Height 1050

Hide
Type `bash "$MODS_ROOT/demos/party/start.sh"` Enter
# 2P's lock prompt is up about 50 s in; let its wait run to about 55 s, so it passes nagMinutes (1) on camera.
Wait+Screen@150s /PARTY LOCK/
Sleep 50s
# Typed off camera; the trailing space keeps the command menu closed.
Type "/party "
Sleep 1s
Show

Sleep 2s
Enter
Sleep 26s

Hide
# Ctrl+Q ends the tmux server and every session in it (demos/party/tmux.conf).
Ctrl+Q
Sleep 1s
