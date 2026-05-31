# Stuff in Space FPV

Space is not crowded the way a room is crowded.

It is crowded the way a dark ocean is crowded: almost nothing in sight, then one cold light crosses the window at impossible speed. The Earth fills half the sky. The rest is black. At real time, the silence feels absolute. At 1000x, the statistics begin to move.

This fork turns the classic Stuff in Space catalog viewer into a first-person low-Earth-orbit experience. Instead of looking at Earth from outside the whole swarm, you ride through LEO and watch the catalog move around you.

## What it shows

- **First-person LEO view** anchored to a custom circular orbit or the ISS.
- **Observer controls** for altitude, inclination, and longitude of ascending node.
- **Ride with ISS** mode that follows the ISS while excluding the ISS itself from nearest-object calculations.
- **Time warp** at 1x, 10x, 100x, and 1000x.
- **Distance filters** for all visible catalog objects, objects within 100 km, or objects within 100 m.
- **HUD readouts** for nearest object, counts within 1 km / 10 km / 100 km, relative velocity, and estimated next `<1 km` pass.
- **Dust mode** with synthetic mm-scale debris: too small to track like catalog objects, still meaningful enough to scar spacecraft, shown with a separate dust-in-view count.
- **Earth with landmass and night terminator**, so the planet feels like a place rather than a blue placeholder.
- **Click-and-drag look controls** for changing the first-person view.

The point is the paradox: space is mostly empty, and that emptiness is exactly why the rare close pass matters.

## How to read the view

At **1x**, almost nothing happens. Earth dominates. The sky feels peaceful.

At **100x**, objects begin to drift like slow meteors with intent.

At **1000x**, the statistical reality becomes visible: not a storm of satellites, but occasional crossings, rare near passes, and long stretches of nothing. Turn on dust mode and the black starts to acquire a faint granular texture, a reminder that the smallest things are often the most numerous.

The next-pass estimate is an educational visualization based on TLE propagation and coarse sampling. It is not an operational conjunction assessment.

## Running for development

1. Install dependencies: `npm install`
2. Start the dev server: `npm run dev`
3. Open http://localhost:5173

## Testing

Run the browser tests with:

```bash
npm run test:e2e
```

The Playwright suite checks the FPV controls, ISS ride-along exclusion, drag pitch behavior, distance filters, dust mode counts, and visible Earth rendering.

## Building for deployment

1. Install dependencies: `npm install`
2. Build the project: `npm run build`

The resulting assets will be in `dist`.

## Data

TLE data is included in the project, but it may not be current. To refresh it, get the latest TLE JSON from [Space-Track.org](https://www.space-track.org/) and update:

- `public/data/TLE.json` for development
- `data/TLE.json` for deployed assets

Example Space-Track query:

```text
https://www.space-track.org/basicspacedata/query/class/tle_latest/ORDINAL/1/EPOCH/%3Enow-30/orderby/NORAD_CAT_ID/format/json
```

## Credits

Original Stuff in Space by James Yoder: https://github.com/jeyoder

This fork keeps the orbital catalog spirit and reframes it from the inside: a small window in a very large dark.

## License

MIT license
