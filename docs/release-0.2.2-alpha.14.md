# 0.2.2-alpha.14 release

Published to npm `next` and GitHub on 2026-10-24. Install `dsh-article-review@0.2.2-alpha.14`; the package supports DSH `0.2.1-rc.3` and retains its older declared versions.

The [release workflow](https://github.com/Biogod2020/dsh-article-review/actions/runs/40074973295) passed verification, npm OIDC publication and installation acceptance. Initial publication was refused until the owner configured and verified the repository's Trusted Publisher; the successful retry reused the same tested archive. The new connection allows `publish.yml` to publish this package directly and does not grant dist-tag management.

The rc.3 lane passed 298 integration tests and Host/Client type checks. The source quality matrix passed on Linux, macOS and Windows with Node 22/24, plus the alpha.4 integration lane. Local Python helper tests passed 24 checks. Installed-package checks verified authentication, manuscript opening, annotations, human review baselines and restart recovery without model calls. Windows Desktop operation remains unverified on hardware.

Official npm and the mirror's actual CDN served the exact CI archive, 369382 bytes, SHA-256 `2ba0d45e31f083259bbadb6113decd9f85d72340fc8d1bc52e5a5446a1bdd66d`. Both registries passed installation by package name in rc.3; macOS repeated both registry installations with the installed Desktop CLI. The [GitHub Release](https://github.com/Biogod2020/dsh-article-review/releases/tag/v0.2.2-alpha.14) provides the same archive and checksums. Source is on `main`; the version tag adds the prebuilt runtime and portable dependency manifest.
