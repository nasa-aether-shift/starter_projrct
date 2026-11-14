`api.generated.ts` is produced by `npm run gen:types` from the API's `/openapi.json`.

The API currently returns untyped dicts, so the generated response types are loose. The **Zod schemas in
`lib/schemas/` are the source of truth** for response shapes; generated types are used only for request paths.
