# solidcraft-app

Publishes the latest release of the SolidCraft web app at https://app.solidcraft.io/.

Nothing is built here. `assemble.sh` takes the web zip attached to the [SolidCraft release](https://github.com/tangency-labs/solidcraft/releases), checks it against `SHA256SUMS.txt`, and deploys it to GitHub Pages. A workflow checks for a new release hourly, or run **Deploy** by hand.

The source is in [tangency-labs/solidcraft](https://github.com/tangency-labs/solidcraft).
