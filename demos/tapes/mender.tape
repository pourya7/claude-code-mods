# mender: a stand-in MCP cart server with strict schemas; the model sends
# add_item one tag as a plain string and a key the tool does not take, mender
# repairs both before the call, the call succeeds, and /mender shows the log.
Output assets/mender.gif
Source demos/tapes/common.tape
# Taller than the rest, so the /mender pane has room for its repair list.
Set Height 820

Hide
Type "source $MODS_ROOT/demos/session.sh mender" Enter
# The server's config and its tools/list answer as mender's schema file, next
# to the app so no other path is involved. An old copy is moved aside.
Type `CFG="$(dirname "$DEMO_DIR")/mender"; if [ -e "$CFG" ]; then mv "$CFG" "$(mktemp -d)/"; fi; mkdir -p "$CFG"` Enter
Type `node "$MODS_ROOT/demos/mcp/cart-server.js" --tools-list > "$CFG/schemas.json"` Enter
Type `printf '{"mcpServers":{"cart":{"command":"node","args":["%s"]}}}' "$MODS_ROOT/demos/mcp/cart-server.js" > "$CFG/mcp.json"` Enter
Type `MENDER_SETTINGS="{\"alwaysThinkingEnabled\":false,\"spinnerTipsEnabled\":false,\"pluginConfigs\":{\"mender\":{\"options\":{\"schemaFile\":\"$CFG/schemas.json\"}}}}"` Enter
# Tool search off, so the cart tools are loaded up front instead of searched for.
Type "export CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 MAX_THINKING_TOKENS=0 TZ=UTC ENABLE_TOOL_SEARCH=false" Enter
Type `clear && claude --effort low --settings "$MENDER_SETTINGS" --mcp-config "$CFG/mcp.json" --allowedTools "mcp__cart" && clear` Enter
Sleep 4s
# Trust the folder.
Down
Enter
Sleep 4s
# Warm up off camera so one-off account notices show and expire before
# recording, then rewind the warm-up away.
Type "reply with just: ok" Enter
Sleep 15s
Escape
Sleep 300ms
Escape
Sleep 1s
Up
Sleep 300ms
Enter
Sleep 2s
Enter
Sleep 2s
Ctrl+U
Sleep 500ms
Ctrl+L
Sleep 6s
Show

Sleep 1s
Set TypingSpeed 25ms
Type `call cart add_item with exactly {"sku":"MUG-01","qty":3,"tags":"fragile","color":"blue"}. The string tags and extra color key are wrong on purpose. Then quote the result and mender's note, nothing else.`
Sleep 500ms
Enter
Sleep 11s
# Type the command off camera: a partial "/me" lists every installed
# command, including the recorder's own.
Hide
Type "/mender"
Sleep 800ms
Show
Sleep 600ms
Enter
Sleep 4s

Hide
Ctrl+C
Ctrl+C
