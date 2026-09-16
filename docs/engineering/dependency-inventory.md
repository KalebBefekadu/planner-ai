# Release Dependency Inventory

Generated from `web/package-lock.json`. Do not edit by hand; run
`npm run inventory:dependencies`. `npm test` fails if it is stale.

Only the production closure is listed. Development and test tooling does not
reach a release and is excluded.

## Summary

| Measure | Count |
| --- | --- |
| Direct production dependencies | 28 |
| Direct dependencies pinned to an exact version | 22 |
| Production closure, including transitive | 412 |
| Of those, platform-optional | 45 |
| Distinct registries | 1 |

Registries: `registry.npmjs.org`.

A single registry is the point. Anything else appearing here is a supply-chain
change, not a dependency change.

## Direct production dependencies

`Declared` is what `package.json` asks for. A range means a future
`npm install` may resolve it differently; an exact version means it may not.
Packages that hold credentials, speak to the network, or parse input a person
did not write are pinned exactly.

| Package | Declared | Locked | Exact |
| --- | --- | --- | --- |
| `@modelcontextprotocol/sdk` | `1.30.0` | `1.30.0` | yes |
| `@supabase/ssr` | `0.12.3` | `0.12.3` | yes |
| `@supabase/supabase-js` | `2.110.7` | `2.110.7` | yes |
| `@tiptap/extension-list` | `^3.31.3` | `3.31.3` | no |
| `@tiptap/extension-table` | `^3.31.3` | `3.31.3` | no |
| `@tiptap/pm` | `^3.31.3` | `3.31.3` | no |
| `@tiptap/react` | `^3.31.3` | `3.31.3` | no |
| `@tiptap/starter-kit` | `^3.31.3` | `3.31.3` | no |
| `@types/archiver` | `^8.0.0` | `8.0.0` | no |
| `archiver` | `7.0.1` | `7.0.1` | yes |
| `csv-parse` | `7.0.2` | `7.0.2` | yes |
| `groq-sdk` | `1.3.0` | `1.3.0` | yes |
| `lucide-react` | `0.544.0` | `0.544.0` | yes |
| `mdast-util-from-markdown` | `2.0.3` | `2.0.3` | yes |
| `mdast-util-frontmatter` | `2.0.1` | `2.0.1` | yes |
| `mdast-util-gfm` | `3.1.0` | `3.1.0` | yes |
| `mdast-util-to-markdown` | `2.1.2` | `2.1.2` | yes |
| `micromark-extension-frontmatter` | `2.0.0` | `2.0.0` | yes |
| `micromark-extension-gfm` | `3.0.0` | `3.0.0` | yes |
| `next` | `16.3.4` | `16.3.4` | yes |
| `openai` | `7.5.0` | `7.5.0` | yes |
| `react` | `19.2.4` | `19.2.4` | yes |
| `react-dom` | `19.2.4` | `19.2.4` | yes |
| `react-markdown` | `10.1.0` | `10.1.0` | yes |
| `remark-gfm` | `4.0.1` | `4.0.1` | yes |
| `resend` | `6.18.0` | `6.18.0` | yes |
| `yauzl` | `3.4.0` | `3.4.0` | yes |
| `zod` | `4.4.3` | `4.4.3` | yes |

## Production closure

| Package | Version | Optional |
| --- | --- | --- |
| `@emnapi/runtime` | `1.11.3` | yes |
| `@floating-ui/core` | `1.8.0` | yes |
| `@floating-ui/dom` | `1.8.0` | yes |
| `@floating-ui/utils` | `0.2.12` | yes |
| `@hono/node-server` | `2.1.1` |  |
| `@img/colour` | `1.1.0` | yes |
| `@img/sharp-darwin-arm64` | `0.35.4` | yes |
| `@img/sharp-darwin-x64` | `0.35.4` | yes |
| `@img/sharp-freebsd-wasm32` | `0.35.4` | yes |
| `@img/sharp-libvips-darwin-arm64` | `1.3.3` | yes |
| `@img/sharp-libvips-darwin-x64` | `1.3.3` | yes |
| `@img/sharp-libvips-linux-arm` | `1.3.3` | yes |
| `@img/sharp-libvips-linux-arm64` | `1.3.3` | yes |
| `@img/sharp-libvips-linux-ppc64` | `1.3.3` | yes |
| `@img/sharp-libvips-linux-riscv64` | `1.3.3` | yes |
| `@img/sharp-libvips-linux-s390x` | `1.3.3` | yes |
| `@img/sharp-libvips-linux-x64` | `1.3.3` | yes |
| `@img/sharp-libvips-linuxmusl-arm64` | `1.3.3` | yes |
| `@img/sharp-libvips-linuxmusl-x64` | `1.3.3` | yes |
| `@img/sharp-linux-arm` | `0.35.4` | yes |
| `@img/sharp-linux-arm64` | `0.35.4` | yes |
| `@img/sharp-linux-ppc64` | `0.35.4` | yes |
| `@img/sharp-linux-riscv64` | `0.35.4` | yes |
| `@img/sharp-linux-s390x` | `0.35.4` | yes |
| `@img/sharp-linux-x64` | `0.35.4` | yes |
| `@img/sharp-linuxmusl-arm64` | `0.35.4` | yes |
| `@img/sharp-linuxmusl-x64` | `0.35.4` | yes |
| `@img/sharp-wasm32` | `0.35.4` | yes |
| `@img/sharp-webcontainers-wasm32` | `0.35.4` | yes |
| `@img/sharp-win32-arm64` | `0.35.4` | yes |
| `@img/sharp-win32-ia32` | `0.35.4` | yes |
| `@img/sharp-win32-x64` | `0.35.4` | yes |
| `@isaacs/cliui` | `8.0.2` |  |
| `@modelcontextprotocol/sdk` | `1.30.0` |  |
| `@next/env` | `16.3.4` |  |
| `@next/swc-darwin-arm64` | `16.3.4` | yes |
| `@next/swc-darwin-x64` | `16.3.4` | yes |
| `@next/swc-linux-arm64-gnu` | `16.3.4` | yes |
| `@next/swc-linux-arm64-musl` | `16.3.4` | yes |
| `@next/swc-linux-x64-gnu` | `16.3.4` | yes |
| `@next/swc-linux-x64-musl` | `16.3.4` | yes |
| `@next/swc-win32-arm64-msvc` | `16.3.4` | yes |
| `@next/swc-win32-x64-msvc` | `16.3.4` | yes |
| `@pkgjs/parseargs` | `0.11.0` | yes |
| `@stablelib/base64` | `1.0.1` |  |
| `@supabase/auth-js` | `2.110.7` |  |
| `@supabase/functions-js` | `2.110.7` |  |
| `@supabase/phoenix` | `0.4.5` |  |
| `@supabase/postgrest-js` | `2.110.7` |  |
| `@supabase/realtime-js` | `2.110.7` |  |
| `@supabase/ssr` | `0.12.3` |  |
| `@supabase/storage-js` | `2.110.7` |  |
| `@supabase/supabase-js` | `2.110.7` |  |
| `@swc/helpers` | `0.5.23` |  |
| `@tiptap/core` | `3.31.3` |  |
| `@tiptap/extension-blockquote` | `3.31.3` |  |
| `@tiptap/extension-bold` | `3.31.3` |  |
| `@tiptap/extension-bubble-menu` | `3.31.3` | yes |
| `@tiptap/extension-bullet-list` | `3.31.3` |  |
| `@tiptap/extension-code` | `3.31.3` |  |
| `@tiptap/extension-code-block` | `3.31.3` |  |
| `@tiptap/extension-document` | `3.31.3` |  |
| `@tiptap/extension-dropcursor` | `3.31.3` |  |
| `@tiptap/extension-floating-menu` | `3.31.3` | yes |
| `@tiptap/extension-gapcursor` | `3.31.3` |  |
| `@tiptap/extension-hard-break` | `3.31.3` |  |
| `@tiptap/extension-heading` | `3.31.3` |  |
| `@tiptap/extension-horizontal-rule` | `3.31.3` |  |
| `@tiptap/extension-italic` | `3.31.3` |  |
| `@tiptap/extension-link` | `3.31.3` |  |
| `@tiptap/extension-list` | `3.31.3` |  |
| `@tiptap/extension-list-item` | `3.31.3` |  |
| `@tiptap/extension-list-keymap` | `3.31.3` |  |
| `@tiptap/extension-ordered-list` | `3.31.3` |  |
| `@tiptap/extension-paragraph` | `3.31.3` |  |
| `@tiptap/extension-strike` | `3.31.3` |  |
| `@tiptap/extension-table` | `3.31.3` |  |
| `@tiptap/extension-text` | `3.31.3` |  |
| `@tiptap/extension-underline` | `3.31.3` |  |
| `@tiptap/extensions` | `3.31.3` |  |
| `@tiptap/pm` | `3.31.3` |  |
| `@tiptap/react` | `3.31.3` |  |
| `@tiptap/starter-kit` | `3.31.3` |  |
| `@types/archiver` | `8.0.0` |  |
| `@types/debug` | `4.1.13` |  |
| `@types/estree` | `1.0.9` |  |
| `@types/estree-jsx` | `1.0.5` |  |
| `@types/hast` | `3.0.5` |  |
| `@types/mdast` | `4.0.4` |  |
| `@types/ms` | `2.1.0` |  |
| `@types/node` | `24.13.4` |  |
| `@types/react` | `19.2.17` |  |
| `@types/react-dom` | `19.2.3` |  |
| `@types/readdir-glob` | `1.1.5` |  |
| `@types/unist` | `2.0.11` |  |
| `@types/unist` | `3.0.3` |  |
| `@types/use-sync-external-store` | `0.0.6` |  |
| `@ungap/structured-clone` | `1.3.3` |  |
| `abort-controller` | `3.0.0` |  |
| `accepts` | `2.0.0` |  |
| `ajv` | `8.20.0` |  |
| `ajv` | `8.20.0` |  |
| `ajv-formats` | `3.0.1` |  |
| `ansi-regex` | `5.0.1` |  |
| `ansi-regex` | `5.0.1` |  |
| `ansi-regex` | `5.0.1` |  |
| `ansi-regex` | `6.3.0` |  |
| `ansi-styles` | `4.3.0` |  |
| `ansi-styles` | `6.2.3` |  |
| `archiver` | `7.0.1` |  |
| `archiver-utils` | `5.0.2` |  |
| `async` | `3.2.6` |  |
| `b4a` | `1.8.1` |  |
| `bail` | `2.0.2` |  |
| `balanced-match` | `1.0.2` |  |
| `bare-events` | `2.9.2` |  |
| `bare-fs` | `4.8.1` |  |
| `bare-path` | `3.1.2` |  |
| `bare-stream` | `2.13.4` |  |
| `bare-url` | `2.5.4` |  |
| `base64-js` | `1.5.1` |  |
| `baseline-browser-mapping` | `2.11.21` |  |
| `body-parser` | `2.3.0` |  |
| `brace-expansion` | `2.1.4` |  |
| `brace-expansion` | `2.1.4` |  |
| `buffer` | `6.0.3` |  |
| `buffer-crc32` | `1.0.0` |  |
| `bytes` | `3.1.2` |  |
| `call-bind-apply-helpers` | `1.0.2` |  |
| `call-bound` | `1.0.4` |  |
| `caniuse-lite` | `1.0.30001810` |  |
| `ccount` | `2.0.1` |  |
| `character-entities` | `2.0.2` |  |
| `character-entities-html4` | `2.1.0` |  |
| `character-entities-legacy` | `3.0.0` |  |
| `character-reference-invalid` | `2.0.1` |  |
| `client-only` | `0.0.1` |  |
| `color-convert` | `2.0.1` |  |
| `color-name` | `1.1.4` |  |
| `comma-separated-tokens` | `2.0.3` |  |
| `compress-commons` | `6.0.2` |  |
| `content-disposition` | `1.1.0` |  |
| `content-type` | `1.0.5` |  |
| `content-type` | `2.1.0` |  |
| `content-type` | `2.1.0` |  |
| `cookie` | `0.7.2` |  |
| `cookie` | `1.1.1` |  |
| `cookie-signature` | `1.2.2` |  |
| `core-util-is` | `1.0.3` |  |
| `cors` | `2.8.6` |  |
| `crc-32` | `1.2.2` |  |
| `crc32-stream` | `6.0.0` |  |
| `cross-spawn` | `7.0.6` |  |
| `csstype` | `3.2.3` |  |
| `csv-parse` | `7.0.2` |  |
| `debug` | `4.4.3` |  |
| `decode-named-character-reference` | `1.3.0` |  |
| `depd` | `2.0.0` |  |
| `dequal` | `2.0.3` |  |
| `devlop` | `1.1.0` |  |
| `dunder-proto` | `1.0.1` |  |
| `eastasianwidth` | `0.2.0` |  |
| `ee-first` | `1.1.1` |  |
| `emoji-regex` | `8.0.0` |  |
| `emoji-regex` | `8.0.0` |  |
| `emoji-regex` | `9.2.2` |  |
| `encodeurl` | `2.0.0` |  |
| `es-define-property` | `1.0.1` |  |
| `es-errors` | `1.3.0` |  |
| `es-object-atoms` | `1.1.2` |  |
| `escape-html` | `1.0.3` |  |
| `escape-string-regexp` | `5.0.0` |  |
| `escape-string-regexp` | `5.0.0` |  |
| `estree-util-is-identifier-name` | `3.0.0` |  |
| `etag` | `1.8.1` |  |
| `event-target-shim` | `5.0.1` |  |
| `events` | `3.3.0` |  |
| `events-universal` | `1.0.1` |  |
| `eventsource` | `3.0.7` |  |
| `eventsource-parser` | `3.1.1` |  |
| `express` | `5.2.1` |  |
| `express-rate-limit` | `8.6.2` |  |
| `extend` | `3.0.2` |  |
| `fast-deep-equal` | `3.1.3` |  |
| `fast-equals` | `5.4.2` |  |
| `fast-fifo` | `1.3.2` |  |
| `fast-sha256` | `1.3.0` |  |
| `fast-uri` | `3.1.7` |  |
| `fault` | `2.0.1` |  |
| `finalhandler` | `2.1.1` |  |
| `foreground-child` | `3.3.1` |  |
| `format` | `0.2.2` |  |
| `forwarded` | `0.2.0` |  |
| `fresh` | `2.0.0` |  |
| `fsevents` | `2.3.2` | yes |
| `function-bind` | `1.1.2` |  |
| `get-intrinsic` | `1.3.0` |  |
| `get-proto` | `1.0.1` |  |
| `glob` | `10.5.0` |  |
| `gopd` | `1.2.0` |  |
| `graceful-fs` | `4.2.11` |  |
| `groq-sdk` | `1.3.0` |  |
| `has-symbols` | `1.1.0` |  |
| `hasown` | `2.0.4` |  |
| `hast-util-to-jsx-runtime` | `2.3.6` |  |
| `hast-util-whitespace` | `3.0.0` |  |
| `hono` | `4.13.7` |  |
| `html-url-attributes` | `3.0.1` |  |
| `http-errors` | `2.0.1` |  |
| `iceberg-js` | `0.8.1` |  |
| `iconv-lite` | `0.7.3` |  |
| `ieee754` | `1.2.1` |  |
| `inherits` | `2.0.4` |  |
| `inline-style-parser` | `0.2.7` |  |
| `ip-address` | `10.5.0` |  |
| `ipaddr.js` | `1.9.1` |  |
| `is-alphabetical` | `2.0.1` |  |
| `is-alphanumerical` | `2.0.1` |  |
| `is-decimal` | `2.0.1` |  |
| `is-fullwidth-code-point` | `3.0.0` |  |
| `is-hexadecimal` | `2.0.1` |  |
| `is-plain-obj` | `4.1.0` |  |
| `is-promise` | `4.0.0` |  |
| `is-stream` | `2.0.1` |  |
| `isarray` | `1.0.0` |  |
| `isexe` | `2.0.0` |  |
| `jackspeak` | `3.4.3` |  |
| `jose` | `6.2.9` |  |
| `json-schema-traverse` | `1.0.0` |  |
| `json-schema-traverse` | `1.0.0` |  |
| `json-schema-typed` | `8.0.2` |  |
| `lazystream` | `1.0.1` |  |
| `linkifyjs` | `4.3.3` |  |
| `lodash` | `4.18.1` |  |
| `longest-streak` | `3.1.0` |  |
| `lru-cache` | `10.4.3` |  |
| `lucide-react` | `0.544.0` |  |
| `markdown-table` | `3.0.4` |  |
| `math-intrinsics` | `1.1.0` |  |
| `mdast-util-find-and-replace` | `3.0.2` |  |
| `mdast-util-from-markdown` | `2.0.3` |  |
| `mdast-util-frontmatter` | `2.0.1` |  |
| `mdast-util-gfm` | `3.1.0` |  |
| `mdast-util-gfm-autolink-literal` | `2.0.1` |  |
| `mdast-util-gfm-footnote` | `2.1.0` |  |
| `mdast-util-gfm-strikethrough` | `2.0.0` |  |
| `mdast-util-gfm-table` | `2.0.0` |  |
| `mdast-util-gfm-task-list-item` | `2.0.0` |  |
| `mdast-util-mdx-expression` | `2.0.1` |  |
| `mdast-util-mdx-jsx` | `3.2.0` |  |
| `mdast-util-mdxjs-esm` | `2.0.1` |  |
| `mdast-util-phrasing` | `4.1.0` |  |
| `mdast-util-to-hast` | `13.2.1` |  |
| `mdast-util-to-markdown` | `2.1.2` |  |
| `mdast-util-to-string` | `4.0.0` |  |
| `media-typer` | `1.1.1` |  |
| `merge-descriptors` | `2.0.0` |  |
| `micromark` | `4.0.2` |  |
| `micromark-core-commonmark` | `2.0.3` |  |
| `micromark-extension-frontmatter` | `2.0.0` |  |
| `micromark-extension-gfm` | `3.0.0` |  |
| `micromark-extension-gfm-autolink-literal` | `2.1.0` |  |
| `micromark-extension-gfm-footnote` | `2.1.0` |  |
| `micromark-extension-gfm-strikethrough` | `2.1.0` |  |
| `micromark-extension-gfm-table` | `2.1.1` |  |
| `micromark-extension-gfm-tagfilter` | `2.0.0` |  |
| `micromark-extension-gfm-task-list-item` | `2.1.0` |  |
| `micromark-factory-destination` | `2.0.1` |  |
| `micromark-factory-label` | `2.0.1` |  |
| `micromark-factory-space` | `2.0.1` |  |
| `micromark-factory-title` | `2.0.1` |  |
| `micromark-factory-whitespace` | `2.0.1` |  |
| `micromark-util-character` | `2.1.1` |  |
| `micromark-util-chunked` | `2.0.1` |  |
| `micromark-util-classify-character` | `2.0.1` |  |
| `micromark-util-combine-extensions` | `2.0.1` |  |
| `micromark-util-decode-numeric-character-reference` | `2.0.2` |  |
| `micromark-util-decode-string` | `2.0.1` |  |
| `micromark-util-encode` | `2.0.1` |  |
| `micromark-util-html-tag-name` | `2.0.1` |  |
| `micromark-util-normalize-identifier` | `2.0.1` |  |
| `micromark-util-resolve-all` | `2.0.1` |  |
| `micromark-util-sanitize-uri` | `2.0.1` |  |
| `micromark-util-subtokenize` | `2.1.0` |  |
| `micromark-util-symbol` | `2.0.1` |  |
| `micromark-util-types` | `2.0.2` |  |
| `mime-db` | `1.54.0` |  |
| `mime-types` | `3.0.2` |  |
| `minimatch` | `5.1.9` |  |
| `minimatch` | `9.0.9` |  |
| `minipass` | `7.1.3` |  |
| `ms` | `2.1.3` |  |
| `nanoid` | `3.3.18` |  |
| `negotiator` | `1.0.0` |  |
| `next` | `16.3.4` |  |
| `normalize-path` | `3.0.0` |  |
| `object-assign` | `4.1.1` |  |
| `object-inspect` | `1.13.4` |  |
| `on-finished` | `2.4.1` |  |
| `once` | `1.4.0` |  |
| `openai` | `7.5.0` |  |
| `orderedmap` | `2.1.1` |  |
| `package-json-from-dist` | `1.0.1` |  |
| `parse-entities` | `4.0.2` |  |
| `parseurl` | `1.3.3` |  |
| `path-key` | `3.1.1` |  |
| `path-scurry` | `1.11.1` |  |
| `path-to-regexp` | `8.4.2` |  |
| `pend` | `1.2.0` |  |
| `picocolors` | `1.1.1` |  |
| `pkce-challenge` | `5.0.1` |  |
| `postal-mime` | `2.7.5` |  |
| `postcss` | `8.5.23` |  |
| `process` | `0.11.10` |  |
| `process-nextick-args` | `2.0.1` |  |
| `property-information` | `7.2.0` |  |
| `prosemirror-changeset` | `2.4.2` |  |
| `prosemirror-commands` | `1.7.2` |  |
| `prosemirror-dropcursor` | `1.8.3` |  |
| `prosemirror-gapcursor` | `1.4.1` |  |
| `prosemirror-history` | `1.5.0` |  |
| `prosemirror-inputrules` | `1.5.1` |  |
| `prosemirror-keymap` | `1.2.3` |  |
| `prosemirror-model` | `1.25.11` |  |
| `prosemirror-schema-list` | `1.5.1` |  |
| `prosemirror-state` | `1.4.4` |  |
| `prosemirror-tables` | `1.8.5` |  |
| `prosemirror-transform` | `1.12.1` |  |
| `prosemirror-view` | `1.42.3` |  |
| `proxy-addr` | `2.0.7` |  |
| `qs` | `6.16.0` |  |
| `range-parser` | `1.3.0` |  |
| `raw-body` | `3.0.2` |  |
| `react` | `19.2.4` |  |
| `react-dom` | `19.2.4` |  |
| `react-markdown` | `10.1.0` |  |
| `readable-stream` | `2.3.8` |  |
| `readable-stream` | `4.7.0` |  |
| `readdir-glob` | `1.1.3` |  |
| `remark-gfm` | `4.0.1` |  |
| `remark-parse` | `11.0.0` |  |
| `remark-rehype` | `11.1.2` |  |
| `remark-stringify` | `11.0.0` |  |
| `require-from-string` | `2.0.2` |  |
| `resend` | `6.18.0` |  |
| `rope-sequence` | `1.3.4` |  |
| `router` | `2.2.0` |  |
| `safe-buffer` | `5.1.2` |  |
| `safe-buffer` | `5.2.1` |  |
| `safer-buffer` | `2.1.2` |  |
| `scheduler` | `0.27.0` |  |
| `semver` | `7.8.5` | yes |
| `send` | `1.2.1` |  |
| `serve-static` | `2.2.1` |  |
| `setprototypeof` | `1.2.0` |  |
| `sharp` | `0.35.4` | yes |
| `shebang-command` | `2.0.0` |  |
| `shebang-regex` | `3.0.0` |  |
| `side-channel` | `1.1.1` |  |
| `side-channel-list` | `1.0.1` |  |
| `side-channel-map` | `1.0.1` |  |
| `side-channel-weakmap` | `1.0.2` |  |
| `signal-exit` | `4.1.0` |  |
| `source-map-js` | `1.2.1` |  |
| `space-separated-tokens` | `2.0.2` |  |
| `standardwebhooks` | `1.0.0` |  |
| `statuses` | `2.0.2` |  |
| `streamx` | `2.28.1` |  |
| `string_decoder` | `1.1.1` |  |
| `string_decoder` | `1.3.0` |  |
| `string-width` | `4.2.3` |  |
| `string-width` | `5.1.2` |  |
| `string-width-cjs` | `4.2.3` |  |
| `stringify-entities` | `4.0.4` |  |
| `strip-ansi` | `6.0.1` |  |
| `strip-ansi` | `6.0.1` |  |
| `strip-ansi` | `7.2.0` |  |
| `strip-ansi-cjs` | `6.0.1` |  |
| `style-to-js` | `1.1.21` |  |
| `style-to-object` | `1.0.14` |  |
| `styled-jsx` | `5.1.6` |  |
| `tar-stream` | `3.2.1` |  |
| `teex` | `1.0.1` |  |
| `text-decoder` | `1.2.7` |  |
| `toidentifier` | `1.0.1` |  |
| `trim-lines` | `3.0.1` |  |
| `trough` | `2.2.0` |  |
| `tslib` | `2.8.1` |  |
| `type-is` | `2.1.0` |  |
| `undici-types` | `7.18.2` |  |
| `unified` | `11.0.5` |  |
| `unist-util-is` | `6.0.1` |  |
| `unist-util-position` | `5.0.0` |  |
| `unist-util-stringify-position` | `4.0.0` |  |
| `unist-util-visit` | `5.1.0` |  |
| `unist-util-visit-parents` | `6.0.2` |  |
| `unpipe` | `1.0.0` |  |
| `use-sync-external-store` | `1.6.0` |  |
| `util-deprecate` | `1.0.2` |  |
| `vary` | `1.1.2` |  |
| `vfile` | `6.0.3` |  |
| `vfile-message` | `4.0.3` |  |
| `w3c-keyname` | `2.2.8` |  |
| `which` | `2.0.2` |  |
| `wrap-ansi` | `8.1.0` |  |
| `wrap-ansi-cjs` | `7.0.0` |  |
| `wrappy` | `1.0.2` |  |
| `yauzl` | `3.4.0` |  |
| `zip-stream` | `6.0.1` |  |
| `zod` | `4.4.3` |  |
| `zod-to-json-schema` | `3.25.2` |  |
| `zwitch` | `2.0.4` |  |
