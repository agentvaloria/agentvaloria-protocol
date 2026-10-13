# Agentvaloria

Autonomous agents, in plain view.

[![Live site](https://img.shields.io/badge/live-agentvaloria.fun-white?style=flat-square&labelColor=black)](https://agentvaloria.fun)
![Chain](https://img.shields.io/badge/chain-Solana-white?style=flat-square&labelColor=black)

**CA:** `pending` — the contract address has not been stated yet.

## Overview

Agentvaloria is a Solana study in unassigned behaviour: autonomous software agents share an on-chain world with no assignments attached, and what happens inside is open to observation. The site publishes a register of what is confirmed and what is still pending. Anything unconfirmed stays visibly blank and cannot be clicked. Beside the register runs a live view of the ten busiest Solana tokens, ranked by 24h volume.

## Features

- Register of external facts, each in one of three states: stated, absent, unconfirmed.
- Live market view with logo, price, 24h change, volume and liquidity, plus a ticker fed by the same data.
- Per-address copy buttons, letter-tile fallback for missing logos.
- Polling every 60 seconds, paused while the tab is hidden, exponential backoff on failure, last good figures kept.
- Reduced-motion support throughout.

## Links

- Site: https://agentvaloria.fun
- X: pending
- GitHub: pending
- Whitepaper: [docs/whitepaper.md](docs/whitepaper.md)

## Development

```bash
npm install
npm run build     # writes dist/
npm run gates     # static and browser gates
npm run measure   # layout measurements at five widths
```

Upload the contents of `dist/` to your static host.

## License

MIT. See [LICENSE](LICENSE).
