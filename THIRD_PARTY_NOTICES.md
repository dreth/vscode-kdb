# Third-Party Notices

KX for VS Code includes third-party software and uses third-party trademark material as recorded below.

## KX logo

The Marketplace and Activity Bar icons are recolored, padded derivatives of the official KX logo.

- Source: [Official KX logo PNG](https://kx.com/wp-content/uploads/2024/06/kx-logo-white.png)
- Retrieved: 2026-07-22
- Attribution: KX

KX and the KX logo are trademarks of KX. They are used here solely to identify KX/kdb+ integration. This independent project is not affiliated with or endorsed by KX.

The original white source file is not distributed in source control or release artifacts; only the recolored, padded derivative assets are packaged.

## KX q parser adaptation

Selected q parser/token/source utilities are adapted from
[`KxSystems/kx-vscode`](https://github.com/KxSystems/kx-vscode) at immutable
commit `955292b68a53179cb1865608e917d4bcdc833ca1`.

Copyright (c) 1998-2026 KX Systems Inc.

The adapted upstream paths are `server/src/parser/{checks,index,keywords,language,lexer,literals,parser,ranges,source,tokens,utils}.ts`;
their local destinations are the same names under `language-server/src/parser/`.
Local modifications migrate Chevrotain 11.1.2 behavior to 13.2.0, remove the
obsolete lodash dependency chain, handle unavailable token locations and
stricter DSL types, close documented q lexical gaps, and generate this
extension's standard-scope TextMate grammar. Retained file headers and
[`language-server/PROVENANCE.md`](language-server/PROVENANCE.md) record the
boundary in detail. No other KX extension code or assets are included.

These adaptations are licensed under the Apache License, Version 2.0. The full
license text is distributed as `language-server/APACHE-2.0.txt`.

## Chevrotain

Chevrotain 13.2.0 is used by the bundled q language server and is distributed
under the Apache License, Version 2.0.

Copyright (c) 2015 SAP SE or an SAP affiliate company.

The full Apache-2.0 text is distributed as
`language-server/APACHE-2.0.txt`. This release does not contain Chevrotain 11
or `lodash-es`.

## VS Code language protocol packages

`vscode-languageclient` 9.0.1, `vscode-languageserver` 9.0.1, and
`vscode-languageserver-textdocument` 1.0.13 are Copyright (c) Microsoft
Corporation and licensed under the MIT License. The MIT grant and disclaimer
reproduced below for uPlot apply to these packages with Microsoft as the
copyright holder. Their upstream third-party notices are retained when their
corresponding package files are distributed.

## uPlot

Copyright (c) 2022 Leon Sorokin

The MIT License (MIT)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.

## JSZip

JSZip is dual licensed under MIT or GPLv3; this distribution uses the MIT option.

Copyright (c) 2009-2016 Stuart Knightley, David Duponchel, Franz Buchinger, António Afonso

The MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.

## JSZip runtime dependency tree

The VSIX also contains JSZip's production dependencies. Their own license
files are preserved beside their code in `node_modules` in the VSIX. The MIT
grant and disclaimer reproduced above apply to these MIT components together
with their respective notices:

- core-util-is — Copyright Node.js contributors.
- immediate — Copyright (c) 2012 Barnesandnoble.com, llc, Donavon West,
  Domenic Denicola, Brian Cavalier.
- isarray — Copyright Julian Gruber.
- lie — Copyright (c) 2014-2018 Calvin Metcalf, Jordan Harband.
- process-nextick-args — Copyright (c) 2015 Calvin Metcalf.
- readable-stream and string_decoder — Copyright Node.js contributors and the
  additional contributors identified in their bundled license files.
- safe-buffer — Copyright (c) Feross Aboukhadijeh.
- setimmediate — Copyright (c) 2012 Barnesandnoble.com, llc, Donavon West,
  and Domenic Denicola.
- util-deprecate — Copyright (c) 2014 Nathan Rajlich.

`inherits` is distributed under the ISC License, Copyright (c) Isaac Z.
Schlueter. Its full license is bundled at `node_modules/inherits/LICENSE`.

`pako` is distributed under MIT and zlib terms. Copyright (C) 2014-2017
Vitaly Puzrin and Andrei Tuputcyn; its zlib-derived portions retain Copyright
(C) 1995-2013 Jean-loup Gailly and Mark Adler. The MIT license and zlib notice
are bundled with the component.
