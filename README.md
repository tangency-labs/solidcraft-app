# solidcraft-app

Publishes the latest release of the SolidCraft web app at https://app.solidcraft.io/.

Nothing is built here. `assemble.sh` takes the web zip attached to the [SolidCraft release](https://github.com/tangency-labs/solidcraft/releases), checks it against `SHA256SUMS.txt`, and deploys it to GitHub Pages. A workflow checks for a new release hourly, or run **Deploy** by hand.

`extra/move-designs.html` (with its script) is copied in by `assemble.sh` and served at https://app.solidcraft.io/move-designs.html: it brings designs saved in the browser at the old address, docs.solidcraft.io/app/, over to this one. The other half is `packaging/web/transfer` in the SolidCraft repository. A change to it reaches the site at the next release, or by running **Deploy** by hand with *force*.

The source is in [tangency-labs/solidcraft](https://github.com/tangency-labs/solidcraft).
