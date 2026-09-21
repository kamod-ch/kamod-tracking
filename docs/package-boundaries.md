# Package boundaries

Single package `@kamod-ch/tracking`. Public surface is only the `exports` map.

| Subpath      | Status   | Role                                                              | Required runtime                             |
| ------------ | -------- | ----------------------------------------------------------------- | -------------------------------------------- |
| `.`          | exported | Event contract, config, consent, sanitize, pipeline, memory store | none                                         |
| `./browser`  | exported | Browser client                                                    | none at import; `window` only inside methods |
| `./preact`   | exported | Optional Preact adapter                                           | `preact` peer                                |
| `./server`   | exported | Fetch collector                                                   | Fetch `Request`/`Response`                   |
| `./postgres` | exported | PostgreSQL migrations + scoped envelope store                     | optional peer `pg`                           |

Rules:

- Root and `./browser` must not import Preact, PostgreSQL, or Node-only modules (`node:fs`, `node:net`, …).
- Browser builds must not contain server secrets or collector code.
- Preact is an optional peer of the Preact entry only.
- Do not export a subpath until its implementation exists.
