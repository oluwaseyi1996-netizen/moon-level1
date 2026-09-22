# SealedBid — Security Documentation

Threat model, trust assumptions, and design rationale for the SealedBid
commit-reveal auction contract.

## 1. Product summary

SealedBid is a sealed-bid (first-price) auction for the Midnight network. Every
bidder publishes only a cryptographic commitment
`H(domain, amount, nonce, bidderId)` during the bidding phase; bid amounts are
circuit-private inputs and never touch the ledger until the winner is settled.
The winning amount is the only bid value ever disclosed.

## 2. Assets and adversaries

Protected assets:

* **Bid amounts** — the core confidentiality asset. Losing and below-reserve
  amounts remain private forever; the winning amount is public by design.
* **Bidder linkages** — which commitments belong to which pseudonymous identity
  is public during the auction (required for binding), but the mapping from
  pseudonym to real-world party is not on the ledger.
* **Auction integrity** — the winner and winning amount must be exactly what
  the revealed bids determine; no party can alter the outcome.

Adversaries considered:

* **A curious observer / indexer reader** — sees all public ledger state.
* **The auctioneer** — controls phase transitions, may be fully dishonest.
* **Competing bidders** — may copy, replay or withhold reveals; may bid under
  many identities.
* **A malicious circuit caller** — may supply arbitrary witness values but can
  only act through the compiled circuits.

Out of scope: compromise of the prover machine (witnesses are trusted local
inputs), the underlying Midnight protocol (consensus, zswap privacy), and the
post-auction payment/settlement rail, which this contract intentionally does
not implement (it records the outcome; it does not escrow funds).

## 3. Identity and authorisation model

Identity is "knowledge of a 32-byte secret". Every on-chain identity is a
domain-separated one-way hash derived by a witness:

* `deriveBidderId(sk)  = H("sealedbid:bidder:v1", sk)`
* `deriveAuctioneerId(sk) = H("sealedbid:auctioneer:v1", sk)`

Design decisions and their rationale:

* **`ownPublicKey()` is deliberately not used.** It returns a prover-claimed
  value with no cryptographic binding to the transaction signer, so any
  authorisation built on it is bypassable. All authorisation here is expressed
  as a comparison between two derived hashes, which the circuit enforces.
* **Separate derivation domains** for bidder and auctioneer pseudonyms ensure
  the same secret can hold both roles without cross-role confusion, and an
  observer cannot mistake one for the other.
* **The secret never leaves the prover.** Witnesses return it only to the
  circuit; the ledger stores only derived hashes. Leaking the entire ledger
  does not recover any secret.

## 4. Privacy analysis

* **Commitment scheme.** `computeCommitment(amount, nonce, bidderId) =
  H("sealedbid:commit:v1", amount, nonce, bidderId)` with a fresh 32-byte
  `nonce` per bid. Without the nonce, a guessed amount cannot be checked
  against a commitment off-chain; the amount is bound and cannot be substituted.
* **What is disclosed, when.**
  * Bidding phase: only `commitment → bidderId` and `bidderId → commitment`.
    No amounts, no timing correlation beyond transaction ordering.
  * Reveal phase: participation (`revealedCommitments`), the two outcome bits
    (`meetsReserve`, `beatsCurrentBest`) and — only when a bid becomes the new
    best — the amount itself.
  * Losing amounts (valid-but-losing, below-reserve) are never written to any
    ledger cell. This is asserted by tests that serialise the entire raw ledger
    state and search it for the amounts (`security.sim.test.ts`), with a
    positive control proving the scan can detect values that *are* present.
* **Residual linkability.** Commitments are linkable to reveals per bidder
  (one sealed bid per identity), and transaction timing/order is observable.
  The design therefore protects amounts, not bidder behavioural metadata.

## 5. Liveness and anti-rug properties

* **A committed bid can always be opened and settled.** `cancel` is refused
  once any sealed bid exists (`bidCount == 0` guard), in both the BIDDING and
  REVEAL phases. Once bidding is closed, `finalize` is permissionless, so no
  party — not even the auctioneer — can block settlement. Asserted by tests.
* **Unfair-cancel protection.** The auctioneer may cancel only a lot with zero
  sealed bids. There is no state in which a bidder's committed capital can be
  stranded by auctioneer action.
* **Shill resistance.** One sealed bid per identity (`bidderCommitment` map)
  and no value attributed to a bid that is never correctly opened. Fake bids
  cost exactly as much as real ones and can never inflate the price.
* **Forward-only state machine.** `BIDDING → REVEAL → FINALIZED`, with
  `CANCELLED` reachable only from a bid-free BIDDING/REVEAL state. No
  transition can resurrect a closed phase (re-bidding, re-closing,
  re-finalizing and re-revealing are all asserted impossible in tests).

## 6. Trust assumptions (honest but observable auctioneer)

Compact language version 0.23 exposes no on-chain block clock, so the contract
cannot enforce wall-clock deadlines itself. The advertised
`bidDeadline`/`revealDeadline` are recorded on the ledger as a **public
commitment to the schedule**: participants can verify after the fact whether
the auctioneer closed the lot when they said they would, but the transition
itself is auctioneer-controlled. A dishonest auctioneer can therefore close
late (not early — closing early is observable), but can never learn bid
amounts, alter the winner, or strand committed bids.

Other accepted assumptions:

* Commit-reveal auctions reward bidders who stay online through the reveal
  window; a bidder who never reveals forfeits only participation, never funds
  (no escrow exists here).
* First-price semantics: the winner pays their own bid. The winning amount is
  the highest revealed bid above reserve.

## 7. Known limitations

* **No on-chain clock** (see above) — deadlines are advisory commitments.
* **Single auction per contract deployment.** One auctioneer, one lot. Deploy
  again for another auction; there is no factory.
* **No escrow/settlement of funds.** The contract declares the winner and
  amount; transferring payment is intentionally out of scope and should be
  handled by a separate settlement mechanism.
* **First-price only.** No second-price (Vickrey) mode.
* **Identity is secret knowledge**, not a regulatory identity: stealing a
  32-byte secret steals the corresponding bidder/auctioneer authority.

## 8. Reporting

See the root `README.md` for supported networks and deployment records. To
report a security issue, contact the repository owner privately; do not open a
public issue for exploitable findings.
