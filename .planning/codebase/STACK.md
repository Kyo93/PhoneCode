# Technology Stack

**Analysis Date:** 2026-04-06

## Languages

**Primary:**
- JavaScript (Node.js) - Server-side runtime and CLI tools
- JavaScript (Browser) - Client-side UI and interactions

**Secondary:**
- Python 3.x - Launcher script and dependency management

## Runtime

**Environment:**
- Node.js >= 16.0.0 (specified in `package.json`)
- Python 3.x (for `launcher.py`)

**Package Manager:**
- npm (Node Package Manager)
- Lockfile: `package-lock.json` present

## Frameworks

**Core:**
- Express.js ^4.18.2 - HTTP server and REST API routing
- WebSocket (ws) ^8.18.0 - Real-time bidirectional communication between server and client

**Build/Dev:**
- No build tool (uses ES modules natively with `"type": "module"` in `package.json`)
- OpenSSL or Node.js crypto - SSL certificate generation (`generate_ssl.js`)

## Key Dependencies

**Critical:**
- `express` ^4.18.2 - HTTP server framework for REST API endpoints
- `ws` ^8.18.0 - WebSocket server/client for real-time chat snapshot streaming
- `dotenv` ^16.4.7 - Environment variable management from `.env` file

**Middleware:**
- `compression` ^1.8.1 - Gzip compression for HTTP responses
- `cookie-parser` ^1.4.7 - Cookie parsing and authentication token management

**Runtime Support:**
- Node.js built-in modules: `http`, `https`, `fs`, `os`, `path`, `child_process` (execSync)

## Configuration

**Environment:**
- Configuration via `.env` file (template: `.env.example`)
- Required environment variables:
  - `PORT` - Server port (default: 3000)
  - `APP_PASSWORD` - Password for mobile interface authentication
  - `NGROK_AUTHTOKEN` - Optional ngrok tunnel authentication token for internet tunneling
  - `SESSION_SECRET` - Optional session signing secret (default provided)
  - `AUTH_SALT` - Optional password hashing salt (default provided)

**Build:**
- No build configuration (native ES modules)
- SSL certificates generated via `node generate_ssl.js` and stored in `./certs/`
- Certificates: `./certs/server.key`, `./certs/server.cert`

## Platform Requirements

**Development:**
- Node.js >= 16.0.0
- OpenSSL (optional, for better SSL certificates; falls back to Node.js crypto)
  - On Windows: bundled with Git for Windows at `C:\Program Files\Git\usr\bin\openssl.exe`
- Python 3.x (for launcher script)
- Windows, macOS, or Linux

**Production:**
- Node.js runtime
- HTTPS support (self-signed certificates generated on first run)
- ngrok tunnel (optional, for internet-accessible URLs)
- Port access (default 3000 or configured via `PORT`)

## Runtime Characteristics

**Architecture:**
- Hybrid: Node.js server provides HTTP/HTTPS and WebSocket endpoints; Browser client connects via WebSocket
- Event-driven: Uses EventEmitter patterns for WebSocket message handling and lifecycle

**Protocols:**
- HTTP/HTTPS for REST API and static file serving
- WebSocket (secured via same certificate as HTTPS)
- Chrome DevTools Protocol (CDP) over WebSocket to communicate with Antigravity/Claude Code

**Processes:**
- Port management: Automatically kills existing processes on target port (Windows `taskkill`, Unix `kill`)
- SSL certificate generation: Runs on first startup if certificates don't exist
- Python launcher: Manages Node.js startup, ngrok tunneling, QR code generation

---

*Stack analysis: 2026-04-06*
