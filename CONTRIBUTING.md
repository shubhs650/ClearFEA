# Contributing to ClearFEA

Thank you for your interest. ClearFEA is a community project and is at an early stage. Until the Phase 0 prototype is complete, the most useful contributions are issues: STEP files that fail to import or mesh, wrong results, confusing interface behaviour, and benchmark cases with known answers.

## Before you start

- Read [docs/DECISIONS.md](docs/DECISIONS.md), especially the non-goals. Pull requests for features on that list will be declined for now, however good.
- For anything larger than a small fix, open an issue first so the approach can be agreed.

## Developer Certificate of Origin

ClearFEA uses the [Developer Certificate of Origin](https://developercertificate.org/) (DCO) and has no contributor licence agreement. You keep the copyright in your contribution and license it under AGPL v3 like the rest of the project.

Every commit must carry a sign-off line:

```
Signed-off-by: Your Name <your.email@example.com>
```

Add it with `git commit -s`. By signing off you certify that you wrote the change or otherwise have the right to submit it under the project licence. A check on every pull request verifies the sign-off.

## Contributions written with AI tools

Much of this project is written with AI coding tools, and such contributions are welcome. The person who submits the change is responsible for it: you must understand it, have tested it, and be able to certify its origin under the DCO.

## Never commit

- Credentials, tokens or keys
- Geometry or data belonging to a client or employer
- Copyrighted material, including tables or text from design codes and standards
- Material property data you do not have the right to publish

Test models must be original geometry created for this project.

## Pull requests

1. Branch from `main`.
2. Keep the change focused on one thing.
3. Run `make test` before pushing.
4. If you touch a physics-critical module (units, deck generation, load translation, result extraction, billing), say so in the description and include the results of the affected verification cases. See [docs/VERIFICATION.md](docs/VERIFICATION.md).
5. A new load, support or analysis type must come with a verification case.
6. Include screenshots for interface changes.

## Reporting a wrong result

A suspected wrong result is the most important kind of issue. Please include the run's downloaded solver input and log, what you expected and why, and the software versions shown in the run. Do not attach confidential geometry; reduce the problem to a simple shape if you can.

## Support

Self-hosted installations are supported by the community through issues and discussions. There is no guaranteed response time.

## Conduct

Be respectful and constructive. Criticise the work, not the person.
