# Technology Stack

**Analysis Date:** 2026-04-08

## Languages

**Primary:**
- JavaScript - ES2022+ with async/await, used throughout server and client
- HTML5 - Template/UI rendering
- CSS3 - Styling with Tailwind CSS utility classes

**Secondary:**
- Python - Launcher script (`launcher.py`) for system integration
- Bash - Shell scripts for context menu installation and certificate generation

## Runtime

**Environment:**
- Node.js >= 16.0.0 (specified in package.json `engines` field)
- Browser: Modern browsers supporting WebSocket, Clipboard API, ES2020+ features

**Package Manager:**
- npm (Node Package Manager)
- Lockfile: `package-lock.json` present

## Frameworks

**Core:**
- Express.js ^4.18.2 - HTTP server framework and routing
- ws ^8.18.0 - WebSocket server and client for real-time communication
- compression ^1.8.1 - HTTP compression middleware (gzip)
- cookie-parser ^1.4.7 - Cookie parsing and authentication token handling
- dotenv ^16.4.7 - Environment variable configuration loading

**Testing:**
- Not detected

**Build/Dev:**
- No build tool detected - runs directly with Node.js
- Manual server startup: `node server.js`

## Key Dependencies

**Critical:**
- ws 8.18.0 - WebSocket communication for snapshot streaming and remote control
- express 4.18.2 - Server framework for HTTP endpoints and static file serving
- compression 1.8.1 - Response compression to reduce bandwidth for large HTML snapshots
- cookie-parser 1.4.7 - Handles authentication token verification and session management

**Infrastructure:**
- dotenv 16.4.7 - Loads environment variables (`APP_PASSWORD`, `PORT`, `NGROK_AUTHTOKEN`, `AUTH_SALT`, `SESSION_SECRET`)

## Configuration

**Environment:**
- `.env` file present (not committed, contains secrets)
- `.env.example` provided as template
- Key variables: `APP_PASSWORD`, `PORT`, `NGROK_AUTHTOKEN`, `SESSION_SECRET`, `AUTH_SALT`
- Default port: 3000 (configurable via `PORT` env var)
- Server hostname: `0.0.0.0` (accessible from any network interface)

**Build:**
- No build configuration files detected
- Source served directly from `public/` directory
- Server entry: `server.js` (imports all modules with ES modules)

## Platform Requirements

**Development:**
- Node.js >= 16.0.0
- npm or yarn
- Chrome/Edge DevTools Protocol compatible browser (Antigravity, Claude Code extension, VS Code)
- Remote debugging port availability (9000-9003 by default)

**Production:**
- Node.js >= 16.0.0
- Network connectivity to debugging target browser (via CDP)
- Optional: ngrok for remote access (requires `NGROK_AUTHTOKEN`)
- Optional: HTTPS capability (auto-generates self-signed certificates)

## SSL/TLS

**Certificate Management:**
- Self-signed SSL certificate generation via `generate_ssl.js`
- Certificates stored in `certs/` directory
- Auto-detect and use HTTPS if certificates exist
- API endpoint `/generate-ssl` for on-demand certificate creation

---

*Stack analysis: 2026-04-08*
