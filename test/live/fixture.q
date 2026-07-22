\ Local-only in-memory fixture for npm run test:live-q.
\ Accept direct IPC handshakes; never use this policy for a production q process.
.z.pw:{[user;password] 1b}

trade:([] sym:`AAPL`MSFT; size:100 250i)
rootVector:til 8
rootFunction:{x+1}

\d .analytics
answer:42
quote:([] sym:`AAPL`MSFT`IBM; size:100 250 400)
analyticsVector:til 8
analyticsFunction:{x+2}
\d .
