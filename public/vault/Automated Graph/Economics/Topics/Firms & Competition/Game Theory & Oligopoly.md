---
space: Economics
status: known
prerequisites:
  - "[[Market Structures]]"
importance: 4
interest: 5
confidence: 4
last_reviewed: 2026-07-01
---

# Game Theory & Oligopoly

## AI Notes
In an [[Market Structures|oligopoly]], firms are few enough that each one's choices (price, output, advertising) directly affect the others — and each firm knows this, so decisions become *strategic*: "what will my rival do in response to what I do?" Game theory is the toolkit for reasoning about this interdependence.

Core building blocks:
- **Payoff matrix**: a 2×2 table showing what each firm earns under every combination of choices. To find a Nash equilibrium: for each column, mark the row with the higher payoff for Firm A; for each row, mark the column with the higher payoff for Firm B. Any cell where *both* are marked is a Nash equilibrium.
- **Nash equilibrium**: a set of strategies where no firm can improve its outcome by unilaterally changing its own strategy, given what the others are doing. Not necessarily the *best* collective outcome — just a stable one.
- **Prisoner's dilemma**: the classic example. Two firms each have a dominant strategy to defect (cut price / increase output) regardless of what the other does — the Nash equilibrium is both defecting, even though both cooperating would be better for *both*. Individual rationality produces a collectively worse outcome. This is the basic logic behind price wars and why cartels are unstable.

**Collusion** (firms coordinating to act like a monopoly — restrict output, raise price) is tempting because it's more profitable for the group, but unstable: each member has an incentive to secretly produce more / undercut price while others hold the line — unless there's a credible way to detect and punish cheating. Repeated interaction changes this: in a **repeated game**, strategies like "tit-for-tat" (cooperate until the other defects, then punish) can sustain cooperation, because the threat of future punishment outweighs the one-time gain from cheating — this is why cartels (e.g. OPEC) sometimes hold together and sometimes collapse depending on how credible punishment is and how patient/visible the players are.

Other recurring themes and model variants:
- **Stackelberg leader-follower**: one firm commits to its output *first*; the follower observes and reacts optimally. The leader, knowing the follower's reaction function in advance, produces *more* than in a symmetric simultaneous game and captures a larger profit share. Advantage holds only if the commitment is credible (e.g. a public capacity expansion the leader can't walk back).
- **Cournot competition**: firms choose quantities *simultaneously* — each guesses the other's output and picks its best response. Dominant strategy is high output; Nash equilibrium sits between the competitive and monopoly outcomes (moderate profit for both).
- **Bertrand competition**: firms compete on *price* simultaneously with identical products — dominant strategy is always to undercut. Nash equilibrium drives price to marginal cost and profit near zero with just two firms (the **Bertrand paradox**).
- **Credible commitment** is the thread across all of these: threats or promises only change behavior if the other player believes you'll actually follow through.

Which model applies depends on what firms actually compete on — if they set prices freely, Bertrand; if output/capacity is the binding decision made in advance, Cournot.

| Model | Compete on | Moves | Nash outcome |
|---|---|---|---|
| Cournot | Quantity | Simultaneous | Moderate output, moderate profit |
| Bertrand | Price | Simultaneous | Price = marginal cost, near-zero profit |
| Stackelberg | Quantity | Sequential | Leader gains, follower loses vs Cournot |

Why this sits at the "frontier" of the sequence: it's the point where the simple supply/demand/price-taking assumptions fully break down, and strategic interaction — not just individual optimization against a market price — becomes the central object of analysis.

## Useful Links
- [ ] [Khan Academy: Imperfect competition — Oligopoly and game theory (unit)](https://www.khanacademy.org/economics-finance-domain/ap-microeconomics/imperfect-competition/oligopoly-and-game-theory)
- [ ] [Khan Academy: Prisoners' dilemma and Nash equilibrium (video)](https://www.khanacademy.org/economics-finance-domain/ap-microeconomics/imperfect-competition/oligopoly-and-game-theory/v/prisoners-dilemma-and-nash-equilibrium)

## My Notes



## Questions
Q: There's a diagram associated with Nash Equilibrium, can I see that and get an explanation for it?

A: The standard diagram is a **payoff matrix** — a 2×2 table showing what each firm earns under every combination of choices. Here's the classic prisoner's dilemma applied to two competing firms deciding whether to keep prices high (cooperate) or cut prices (defect):

|  | **Firm B: Keep High** | **Firm B: Cut Price** |
|---|---|---|
| **Firm A: Keep High** | (10, 10) | (2, 14) |
| **Firm A: Cut Price** | (14, 2) | (5, 5) |

Each cell is `(Firm A's profit, Firm B's profit)`.

How to read it:
- If Firm B keeps prices high, Firm A earns 10 by cooperating or **14 by cutting** → A prefers to cut.
- If Firm B cuts prices, Firm A earns 2 by cooperating or **5 by cutting** → A still prefers to cut.
- Cutting is a **dominant strategy** for Firm A — it's better regardless of what B does. By symmetry, same is true for Firm B.

The **Nash equilibrium** is the bottom-right cell `(5, 5)`: both firms cut prices. Neither can improve by unilaterally switching — if A switches to "keep high" while B cuts, A drops from 5 to 2. So `(Cut, Cut)` is stable, even though `(Keep High, Keep High)` at `(10, 10)` would be better for *both*. That's the tragedy of the prisoner's dilemma: individual rationality produces a collectively worse outcome.

To find a Nash equilibrium in any payoff matrix: for each column, mark the row with the higher payoff for Firm A (underline it); for each row, mark the column with the higher payoff for Firm B. Any cell where *both* are marked is a Nash equilibrium.

Q: Explain Stackleberg leader follower model.

A: The **Stackelberg model** is a way of thinking about oligopoly competition where one firm (the **leader**) commits to its output quantity *first*, and the other firm (the **follower**) then observes that choice and picks its own best response.

The key difference from simultaneous games (like the payoff matrix above): **sequence matters**. The leader moves first and knows the follower will react optimally to whatever it does — so the leader can effectively choose its most advantageous point on the follower's reaction curve.

How it plays out:
1. The **follower's reaction function** describes how much the follower will produce for any given quantity the leader chooses. More leader output → lower market price → follower produces less.
2. The **leader knows this function** and picks the quantity that maximises its own profit *taking the follower's reaction into account*, not assuming the follower holds output constant.
3. The result: the leader produces **more** than in a symmetric simultaneous game (like Cournot competition), and the follower produces **less**. The leader captures a larger share of profit.

Real-world intuition: a dominant firm that publicly announces capacity expansion (new factories, locked-in supply contracts) is playing the Stackelberg leader role — it's committing to high output before rivals can respond, forcing them to scale back. This is why **credible commitment** is so important: the leader's advantage only holds if the follower actually believes the announced quantity is locked in.

The Stackelberg model is one of a family of oligopoly models alongside **Cournot** (firms choose quantities simultaneously) and **Bertrand** (firms choose prices simultaneously, which drives prices to marginal cost immediately). Each gives different predictions depending on whether firms compete on price vs. quantity and whether moves are sequential vs. simultaneous.

Q: Show payoff matrices for Cournot and Bertrand.

A: Unlike the prisoner's dilemma (which is about price), Cournot and Bertrand are usually modelled with continuous choices — but they can be simplified into 2×2 matrices to show the strategic logic. Strategies here are **High** (produce/price aggressively) vs **Low** (hold back).

**Cournot** — firms compete on *quantity*. "High" = produce more, "Low" = produce less (closer to monopoly output).

|  | **Firm B: Low Qty** | **Firm B: High Qty** |
|---|---|---|
| **Firm A: Low Qty** | (12, 12) | (6, 15) |
| **Firm A: High Qty** | (15, 6) | (8, 8) ← Nash |

- If B holds back, A earns more by producing more (15 > 12) → A plays High.
- If B produces a lot, A still earns more by producing more (8 > 6) → A still plays High.
- **Dominant strategy: High quantity.** Nash equilibrium = (8, 8) — both produce aggressively. Better than the competitive floor (e.g. 5, 5) but worse than the cooperative monopoly split (12, 12).

---

**Bertrand** — firms compete on *price*. "High" = charge a high price, "Low" = undercut to grab the whole market.

|  | **Firm B: High Price** | **Firm B: Low Price** |
|---|---|---|
| **Firm A: High Price** | (10, 10) | (0, 18) |
| **Firm A: Low Price** | (18, 0) | (1, 1) ← Nash |

- If B prices high, A earns more by undercutting and taking the whole market (18 > 10) → A plays Low.
- If B already prices low, A must also price low or earn nothing (1 > 0) → A still plays Low.
- **Dominant strategy: Low price.** Nash equilibrium = (1, 1) — the **Bertrand paradox**: with just two firms selling an identical product, competition drives price all the way to marginal cost and profit nearly to zero. Same outcome as perfect competition.

---

**The key takeaway across all three models:**

| Model | Compete on | Moves | Nash outcome |
|---|---|---|---|
| Prisoner's dilemma | Price | Simultaneous | Both defect — low profits |
| Cournot | Quantity | Simultaneous | Moderate output, moderate profit |
| Bertrand | Price | Simultaneous | Price = marginal cost, near-zero profit |
| Stackelberg | Quantity | Sequential | Leader gains, follower loses vs Cournot |

Bertrand and Cournot give very different predictions for the same two-firm market — which model fits reality depends on whether firms can more easily change *price* (Bertrand applies) or are constrained by *capacity/production* decisions made in advance (Cournot applies).