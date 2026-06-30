---
space: Economics
status: known
prerequisites:
  - "[[Supply and Demand]]"
  - "[[Elasticity]]"
importance: 4
interest: 4
confidence: 3
last_reviewed: 2026-06-22
---

# Factor Markets & Labour

## AI Notes
So far, [[Supply and Demand]] has been applied to goods markets — buyers purchasing output. **Factor markets** apply the same framework to the *inputs* of production: labour, capital, and land. The labour market is the most important and most discussed.

**How the labour market works:**
- **Demand for labour** comes from firms. A firm hires workers up to the point where the extra revenue a worker generates (**marginal revenue product**) equals the wage. This gives the labour demand curve its downward slope — as wages rise, firms hire fewer workers.
- **Supply of labour** comes from individuals choosing how many hours to work (or whether to participate at all) at a given wage. The labour supply curve generally slopes upward — higher wages attract more workers and more hours — but can "bend backward" at very high wages (people work fewer hours once they're rich enough, valuing leisure over extra income).
- **Equilibrium wage and employment** are set where supply meets demand, just like in goods markets.

**What shifts labour demand:** changes in the price of the output workers produce (if the good becomes more valuable, workers who make it become more valuable), changes in technology (automation reduces demand for routine labour; technology that complements workers raises it), and changes in the prices of other inputs (if capital gets cheaper, it may substitute for labour).

**What shifts labour supply:** changes in population, immigration, social norms around participation (e.g. female labour force participation), changes in non-wage benefits, and changes in the wages of alternative jobs.

**Key policy applications:**
- **Minimum wage** is a price floor in the labour market (connects directly to [[Price Controls]]). If set above equilibrium, it creates a surplus of labour (unemployment) — though real-world evidence on minimum wage effects is more nuanced because labour markets are often not perfectly competitive.
- **Monopsony**: when there's only one buyer of labour (e.g. a single large employer in a small town), the employer has market power that mirrors a monopoly seller exactly, just on the input side. A monopolist restricts *output* to keep *price* elevated (MR = MC, price read off demand above the competitive level); a monopsonist restricts *hiring* to keep the *wage* suppressed (VMP = marginal factor cost, wage read off supply below the competitive level). Both create deadweight loss relative to the competitive benchmark and both redistribute surplus toward the firm — monopoly from consumers, monopsony from workers. This gives a theoretical justification for minimum wages even in the presence of unemployment risk: a minimum wage can actually *increase* employment in a monopsony (unlike in a competitive labour market, where it would only create unemployment).
- **Unions**: act as a monopoly seller of labour, pushing wages above the competitive level in the organised sector — the flip side of monopsony, and a source of ongoing debate about efficiency vs. distributional effects.

Elasticity matters here too: labour demand tends to be more inelastic when labour is a small share of total costs, when there are few substitutes for the type of labour, and in the short run. The more inelastic demand is, the more a wage increase gets borne by employers rather than workers.

## Useful Links
- [ ] [Khan Academy: Factor markets — Microeconomics unit](https://www.khanacademy.org/economics-finance-domain/microeconomics/micro-factor-markets)
- [ ] [Khan Academy: Factor markets — AP/College Microeconomics](https://www.khanacademy.org/economics-finance-domain/ap-microeconomics/factor-markets)

## My Notes



## Questions

Q: Are monopsony and monopoly similar? How so?

A: Yes — they're mirror images of each other, just on opposite sides of the market.

- **Monopoly** = a single *seller* with market power. It restricts output below the competitive level and charges a price *above* what a competitive market would set, capturing extra profit at the expense of consumer surplus.
- **Monopsony** = a single *buyer* with market power (most commonly studied in labour markets, where one employer is the dominant or only buyer of labour in a local market). It restricts the *quantity it buys* below the competitive level and pays a price (wage) *below* what a competitive market would set, capturing the difference as extra surplus at the expense of the supplier (the worker).

The underlying logic is identical, just flipped:
- A monopolist faces a downward-sloping demand curve for its *output* and realises that selling more requires lowering price on *all* units sold — so it produces less than competitive output to keep price (and profit) higher.
- A monopsonist faces an upward-sloping supply curve for *labour* and realises that hiring more workers requires raising the wage for *all* workers hired — so it hires fewer workers than the competitive level to keep the wage (and profit) lower.

Both create deadweight loss relative to the competitive benchmark — monopoly by under-producing output, monopsony by under-hiring labour. Both also redistribute surplus toward the firm: monopoly takes consumer surplus, monopsony takes worker surplus (often called "surplus extraction" from labour).

The real-world labour market parallel to a multi-firm monopoly would be a **cartel of employers** colluding to suppress wages — which is exactly what monopsony power produces even with a single dominant employer (e.g. a single major hospital system or large factory in a small town with few alternative employers).

Q: Can you give supporting graphs for each of the cases?

A: Both follow the same template: a firm facing a curve where the "price" it must pay/charge depends on quantity, compared to the competitive benchmark.

---

**Monopoly** (single seller, output market)

```
P |
  |
Pm| - - - - - - -⊙              ← monopoly price (above P*)
  |              |\
P*| - - - - - - -|-X- - - -     ← competitive price
  |              | |\
  |          MR  |  \  D (= demand = average revenue)
  |         /     \   \
  +--------+-------+----+-- Q
          Qm       Q*
          ↑ monopoly output (below Q*, competitive output)
```

- The monopolist picks quantity where **Marginal Revenue (MR) = Marginal Cost (MC)** (MC curve not drawn here but intersects MR at Qm), then reads the *price* off the demand curve at Qm → that's **Pm**, above the competitive price P*.
- **Qm < Q\*** — output restricted relative to competition.
- **Pm > P\*** — price elevated relative to competition.
- The triangle between Qm and Q\* (bounded by demand and MC/supply) is the monopoly's deadweight loss.

---

**Monopsony** (single buyer, labour market)

```
W |
  |              S (labour supply = workers' marginal cost of working)
  |             /
W*| - - - - - X- - - - -          ← competitive wage
  |          /|
Wm| - - -⊙  | |                  ← monopsony wage (below W*)
  |      |\ | |
  |      | \|  MFC (marginal factor cost — rises faster than S)
  |  VMP |   \
  +------+----+----+-- L (labour quantity)
        Lm    L*
        ↑ monopsony employment (below L*, competitive employment)
```

- The monopsonist hires where the **Value of Marginal Product (VMP, = labour demand) = Marginal Factor Cost (MFC)** — MFC sits *above* the supply curve because hiring one more worker requires raising the wage for everyone already employed, not just the marginal hire.
- It then pays the *wage* off the supply curve at Lm → that's **Wm**, below the competitive wage W*.
- **Lm < L\*** — employment restricted relative to competition.
- **Wm < W\*** — wage suppressed relative to competition.
- The triangle between Lm and L\* is the monopsony's deadweight loss — mirroring the monopoly triangle exactly, just on the input side.

---

**Side-by-side comparison:**

| | Monopoly | Monopsony |
|---|---|---|
| Market power held by | Seller | Buyer |
| Restricts | Output sold | Labour hired |
| Distorts price | Above competitive (Pm > P*) | Below competitive (Wm < W*) |
| Decision rule | MR = MC | VMP = MFC |
| Surplus captured from | Consumers | Workers |
| DWL triangle | Between Qm and Q* | Between Lm and L* |