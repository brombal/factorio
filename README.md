# Factorio production bus

An interactive planner that draws a Factorio production tree as a main bus. You pick the products you want and how fast you want them, and the chart shows what to build: which recipes, how many machines of each kind, and how many belts carry each item.

**Live site:** https://brombal.github.io/factorio/

## What it shows

Every item is a line running along the bus, and every recipe is a node beside it, with taps from its input lines and a drop onto its output line. Raw resources are nodes in the same row with no inputs. An item's line only exists for the stretch where it is produced and still consumed, so the chart stays compact and reads in the order that a factory is built.

- **Outputs:** turn items on in the outputs picker and set a rate per second for each; demand is propagated backward through the recipe tree to size every lane and tap.
- **Build choices:** pick a machine tier per machine type, a belt tier, and modules; machine counts, drill counts, and belt counts follow those choices.
- **Line widths:** each lane is as wide as the number of belts that it needs at the chosen tier.
- **Details:** hover or tap a node to see its inputs, outputs, and machine counts, or tap a lane to see its throughput, belt counts, and downstream consumers.
- **Layout:** pan and zoom like a map (including pinch on a phone), in a horizontal or vertical orientation.

Settings are saved to local storage, so there is no account or backend. The data covers vanilla Factorio 2.0 only for now; Space Age is not supported yet.

## Running it locally

Requires Node 24 or later.

```bash
npm install
npm run dev
```

The dev server runs at http://localhost:5173. Before opening a pull request, run the type check and Biome:

```bash
npx tsc -p tsconfig.app.json --noEmit && npx biome check src
```

## Project layout

| Path | What it holds |
|---|---|
| `src/lib/` | Pure engines for demand, layout, machine counts, and modules, with no DOM or React dependency |
| `src/App/` | The React UI: header pickers, the details panel, and the SVG chart in `Chart/BusChart.tsx` |
| `src/data/` | Data types, the generated `vanilla.json`, and hand-picked overrides for icons and colors |
| `scripts/importVanilla.ts` | Regenerates `src/data/vanilla.json` from FactorioLab's dataset |

`src/data/vanilla.json` is generated, so change `scripts/importVanilla.ts` or `src/data/overrides.ts` and rerun the import rather than editing it by hand:

```bash
node scripts/importVanilla.ts
```

## Deployment

Every push to `main` builds the site and deploys it to GitHub Pages through `.github/workflows/deploy.yml`.

## Contributing

Issues, pull requests, and forks are all welcome. If you want to take the chart in a different direction (another mod's recipes, a different layout, Space Age planets), forking it is encouraged; for fixes and smaller improvements, a pull request against `main` is the easiest route.

## Credits

Recipe data comes from [FactorioLab](https://github.com/factoriolab/factoriolab), and item icons come from the [official Factorio wiki](https://wiki.factorio.com/). Factorio is a trademark of Wube Software, and this project is not affiliated with or endorsed by Wube.

## License

[MIT](LICENSE)
