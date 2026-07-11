# Photon Bench

Photon Bench is a standalone, interactive browser simulator for fiber-optic waveguides and digital links. It connects physical manipulation of a five-node Catmull-Rom fiber spine and pivoting laser source to live ray behavior, attenuation, splice/end-face inspection, time-domain waveforms, and eye diagrams.

**Production:** [photonbench.camozeroday.dev](https://photonbench.camozeroday.dev)

## Run locally

```bash
cd /Users/dosisek/Documents/GitHub/photon-bench
npm start
```

Open `http://localhost:4173`.

## Test

```bash
npm test
```

Create the production artifact with `npm run build`. The deployment workflow publishes `dist/` to Cloudflare Pages after every passing push to `main`.

## Included interactions

- Drag all five numbered waveguide nodes to bend or loop the fiber.
- Drag the emitter housing vertically and use its gold pivot handle to rotate it.
- Switch step/graded index and single/multi-mode behavior.
- Explore UV, visible, and telecom wavelengths with wavelength-dependent Rayleigh loss.
- Compare core-alignment and cladding-alignment splices.
- Switch between clean and contaminated end faces and vary contamination.
- Read the same live model through link-budget metrics, a loss ledger, Tx/Rx waveforms, and an eye diagram.

## Model scope

The simulator uses engineering equations and representative silica-fiber defaults. Geometric optics, modal delay, Gaussian overlap, and the silica Sellmeier equation are physically grounded. Macrobend loss and contamination severity use clearly labeled illustrative transfer functions because exact results depend on fiber construction, particle geometry, launch conditions, and manufacturer-specific bend-loss coefficients. This is an educational/design tool, not a substitute for an OTDR, OLTS, fusion-splicer estimate, or certified link-budget calculation.

## Calibration references

- [ITU-T L.400 — fusion-splice procedures and alignment-loss models](https://www.itu.int/rec/T-REC-L.400-202202-I/en)
- [ITU-T G.657 — bend-insensitive single-mode fiber](https://www.itu.int/rec/T-REC-G.657/en)
- [Corning SMF-28 Ultra product information](https://www.corning.com/media/worldwide/coc/documents/Fiber/product-information-sheets/PI-1424-AEN.pdf)
- [Corning ClearCurve multimode product information](https://www.corning.com/content/dam/corning/media/worldwide/coc/documents/Fiber/product-information-sheets/PI-1468-AEN.pdf)
- [Corning connector cleanliness study](https://www.corning.com/catalog/coc/documents/white-papers/LAN-2730-AEN.pdf)
- [Malitson fused-silica Sellmeier coefficients](https://doi.org/10.1364/JOSA.55.001205)

Deployment and rollback details are documented in [DEPLOYMENT.md](./DEPLOYMENT.md).
