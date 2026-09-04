# @ipfs-meshkit/mcp

MCP (Model Context Protocol) server for [IPFS Meshkit](https://github.com/IPFS-Meshkit/meshkit0). Exposes Kubo storage and IPNS operations as tools for AI agents in Cursor, Claude Desktop, and other MCP clients.

## Prerequisites

- **Node.js 20+**
- **`@ipfs-meshkit/meshkit` ≥ 1.2.1** (installed automatically as a dependency)
- A running [Kubo](https://docs.ipfs.tech/install/) node with RPC API reachable (default: `http://127.0.0.1:5001`), **or** set `MESHKIT_LOCAL_NODE=true` to start/attach to Kubo automatically (requires `ipfs` on `PATH`)

## Quick start

```bash
npx -y @ipfs-meshkit/mcp
```

Or install globally:

```bash
npm install -g @ipfs-meshkit/mcp
meshkit-mcp
```

## Configuration

Set environment variables in your MCP client config:

| Variable | Default | Description |
|----------|---------|-------------|
| `MESHKIT_NODES` | `http://127.0.0.1:5001` | Comma-separated Kubo RPC URLs |
| `MESHKIT_HEADERS` | — | Optional JSON object for RPC auth headers |
| `MESHKIT_LOCAL_NODE` | `false` | Start or attach to a local Kubo daemon (`true`/`1`/`yes`) |

### Cursor

Add to your MCP settings (`mcp.json`):

```json
{
  "mcpServers": {
    "meshkit": {
      "command": "npx",
      "args": ["-y", "@ipfs-meshkit/mcp"],
      "env": {
        "MESHKIT_LOCAL_NODE": "true"
      }
    }
  }
}
```

If you already run Kubo yourself, omit `MESHKIT_LOCAL_NODE` or set it to `false` and point `MESHKIT_NODES` at your RPC URL.

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "meshkit": {
      "command": "npx",
      "args": ["-y", "@ipfs-meshkit/mcp"],
      "env": {
        "MESHKIT_NODES": "http://127.0.0.1:5001"
      }
    }
  }
}
```

### Remote or authenticated Kubo

```json
{
  "mcpServers": {
    "meshkit": {
      "command": "npx",
      "args": ["-y", "@ipfs-meshkit/mcp"],
      "env": {
        "MESHKIT_NODES": "https://kubo.example.com:5001",
        "MESHKIT_HEADERS": "{\"Authorization\":\"Bearer YOUR_TOKEN\"}"
      }
    }
  }
}
```

## Tools

| Tool | Description |
|------|-------------|
| `ipfs_upload` | Upload text or base64 content; returns CID. Supports optional `password` and `pbkdf2Iterations` for client-side AES-256-GCM encryption before upload |
| `ipfs_retrieve` | Retrieve content by CID. Pass `password` to decrypt if the content was uploaded encrypted |
| `ipfs_pin` | Pin a CID on the node |
| `ipfs_list_pins` | List pinned CIDs on the primary node. Optional `limit`/`offset` page through large pinsets without draining the full stream |
| `ipfs_pin_count` | Count pins by type (`direct`, `recursive`, `indirect`, `total`) on the primary node. Streams and returns only counts — safe for nodes with millions of pins |
| `ipfs_publish_name` | Publish an IPNS record |
| `ipfs_resolve` | Resolve an IPNS name and retrieve content |
| `ipfs_generate_key` | Create a named IPNS signing key |
| `ipfs_list_keys` | List IPNS keys in the keystore |

### Examples

**Upload text:**

```json
{ "content": "Hello, IPFS!" }
```

**Upload text with encryption:**

```json
{
  "content": "confidential manifest data",
  "password": "correct-horse-battery-staple",
  "pbkdf2Iterations": 200000
}
```

The content is encrypted with AES-256-GCM (PBKDF2-SHA256 key derivation) before it leaves the local machine. The IPFS network and storage provider only ever see the ciphertext. `pbkdf2Iterations` defaults to 200,000 (OWASP 2023 minimum) and must be ≥ 1,000.

**Upload binary:**

```json
{ "base64": "aGVsbG8=" }
```

**Retrieve (no encryption):**

```json
{ "cid": "Qm..." }
```

**Retrieve and decrypt:**

```json
{
  "cid": "Qm...",
  "password": "correct-horse-battery-staple"
}
```

**Publish to IPNS:**

```json
{
  "value": "Qm...",
  "key": "latest",
  "ttl": "1m"
}
```

## How it works

The MCP server connects to your Kubo node(s) at startup via [`@ipfs-meshkit/meshkit`](https://www.npmjs.com/package/@ipfs-meshkit/meshkit). AI clients communicate over **stdio** (stdin/stdout JSON-RPC). Logs go to stderr only.

```
AI client  →  stdio  →  @ipfs-meshkit/mcp  →  Meshkit  →  Kubo RPC
```

## Development

From the monorepo root:

```bash
npm run build:mcp
npm run test:unit -- --project unit packages/mcp
```

## License

MIT
