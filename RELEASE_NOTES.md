# coding-tools-mcp-extension v0.0.2

Safer Sync against ChatGPT personal plugins.

Sync now reuses the open plugins tab, finds the exact `coding-tools-mcp` grid card, and deletes only through that card's Manage menu before recreate. If the card is still present, create is refused. Wrong menus such as Pets, conversation options, or project options are rejected, and Sync Escapes instead of clicking elsewhere.

Load the unpacked folder from this release (or the attached zip), reload the extension in `chrome://extensions`, then run Sync + OAuth once.
