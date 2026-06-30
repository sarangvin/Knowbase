---
space: Economics
status: known
prerequisites:
  - "[[Market Structures]]"
  - "[[Externalities]]"
importance: 4
interest: 5
confidence: 3
last_reviewed: 2026-06-21
---

# Information Asymmetry

## AI Notes
The standard supply/demand model assumes buyers and sellers are equally well-informed. **Information asymmetry** is what happens when one side of a transaction knows something the other doesn't — and it's another major source of market failure, alongside [[Externalities]] and [[Public Goods & Common Resources]].

Two core problems that arise:

**Adverse selection** (the "hidden type" problem — asymmetry *before* the transaction):
One party has private information about their type that the other can't observe, so the market attracts the wrong mix of participants. George Akerlof's famous **"market for lemons"** (*"The Market for Lemons: Quality Uncertainty and the Market Mechanism"*, QJE 1970, Nobel Prize 2001) showed this with used cars: sellers know whether their car is good ("peach") or bad ("lemon"); buyers don't. Buyers offer the average expected value — but good-car owners won't sell at that price (it's below what their car is worth to them), so only lemons remain. Buyers, now knowing this, lower their offer further. The market can completely unravel even though mutually beneficial trades exist — purely because quality is unobservable.

The same logic applies to:
- **Insurance / healthcare**: people who know they're high-risk are most eager to buy insurance; insurers can't perfectly distinguish them from low-risk buyers, so premiums rise until low-risk people drop out, leaving an ever-riskier pool (the "death spiral"). Healthcare compounds this further: patients can't fully evaluate doctors' advice (principal-agent problem), insured patients over-consume care (moral hazard), and hospitals in markets without price transparency eliminate price competition entirely.
- **Credit markets**: borrowers know their own default risk better than lenders; lenders ration credit or charge high rates to all borrowers, which drives out good borrowers.

**Moral hazard** (the "hidden action" problem — asymmetry *after* the transaction):
Once a contract is signed, one party takes actions the other can't observe or verify — and the contract changes their incentives. Examples:
- A driver with full-coverage car insurance may park less carefully than one without it.
- A bank that expects a government bailout takes on more risk than it otherwise would ("too big to fail").
- An employee on a fixed salary has less incentive to work hard than one paid by results.

**Remedies:**
- **Screening**: the uninformed party tries to sort types before transacting (credit scores, medical underwriting, job interviews).
- **Signalling**: the informed party with a good type credibly reveals it — e.g. a job applicant gets an expensive degree not just for skills but as a *signal* that they're high-ability (Spence's signalling model). Signal must be costly enough that low-type agents can't profitably imitate it.
- **Incentive contracts**: align interests to reduce moral hazard — performance pay, deductibles in insurance, equity stakes for managers.
- **Government mandates**: requiring everyone to buy insurance (e.g. mandatory health insurance) forces the low-risk into the pool, preventing adverse-selection death spirals.

Information asymmetry is one of the reasons markets for insurance, credit, healthcare, and labour look very different from the frictionless supply/demand model — and why intermediaries (rating agencies, inspectors, recruiters) exist: they're paid to reduce information gaps.

## Useful Links
- [ ] [Oregon State Open Text: Asymmetric Information (Intermediate Microeconomics)](https://open.oregonstate.education/intermediatemicroeconomics/chapter/module-22/)
- [ ] [Pearson: Asymmetric Information — Adverse Selection and Moral Hazard](https://www.pearson.com/channels/microeconomics/learn/brian/ch-17-asymmetric-information-voting-and-public-choice/asymmetric-information-adverse-selection-and-moral-hazard)

## My Notes



## Questions
Q: Where does information asymmetry exist in healthcare?

A: Healthcare is probably the single richest real-world domain for information asymmetry — it appears at almost every layer of the system, running in multiple directions:

**Patient vs. Doctor (principal-agent problem)**
The patient (principal) hires the doctor (agent) to act in their interest, but the doctor has vastly more medical knowledge. The patient often can't assess whether the recommended treatment is truly necessary, optimal, or influenced by the doctor's financial incentives (e.g. fee-for-service systems incentivise more procedures). This is a moral hazard problem on the doctor's side — their actions after the "contract" (consultation) are hard for the patient to monitor or verify.

**Patient vs. Insurer (adverse selection)**
The patient knows their own health history, lifestyle, and risk tolerance far better than the insurer does. High-risk individuals are most motivated to seek comprehensive coverage; low-risk individuals may opt out if premiums reflect the average (elevated) risk pool. This drives the adverse-selection death spiral — premiums rise → healthy people leave → pool gets sicker → premiums rise further. It's why most countries mandate some form of universal coverage or community rating (charging everyone the same premium regardless of health status) to prevent market unravelling.

**Insurer vs. Patient (moral hazard after insurance)**
Once insured, patients have less incentive to avoid health risks or to economise on care — they bear only a fraction of the cost of each visit. This is why insurers use **co-pays, deductibles, and coverage limits**: they re-introduce a direct cost at the point of use to restore some of the patient's incentive to economise.

**Pharmaceutical companies vs. Regulators/Public**
Drug companies know far more about their trial data, side effects, and efficacy than regulators or patients do. This is why regulatory approval processes (FDA, EMA) are so extensive — they're a screening mechanism to extract and verify information the company holds privately. Even then, selective reporting of trial results remains a real problem.

**Hospitals vs. Patients on pricing**
In markets without price transparency (especially the US), patients often don't know the price of a procedure before receiving it — or even after. This eliminates price competition and is a major reason healthcare markets produce inefficient outcomes that standard supply/demand analysis doesn't predict well.

---

Q: How does screening occur in medical underwriting in this context?

A: **Medical underwriting** is the process by which an insurer assesses an individual's health risk *before* offering them a policy and setting a premium. It's a screening mechanism — the insurer (the uninformed party) tries to gather enough information to classify applicants by risk type, so it doesn't end up with an adversely-selected pool.

How it works in practice:

- **Health questionnaires**: applicants self-report pre-existing conditions, family history, lifestyle factors (smoking, BMI, exercise). The problem: self-reporting is unreliable — people under-disclose unfavourable information. Insurers counter this with fraud clauses (claims can be denied if misrepresentation is discovered later).
- **Medical records review**: the insurer requests access to GP or hospital records to verify self-reported health history. More thorough but expensive and time-consuming.
- **Medical examinations**: for large policies (e.g. life insurance), the insurer may require a physical exam, blood tests, or specific screenings (ECG, cholesterol, HIV test). These reveal information the applicant might not have disclosed or even known.
- **Exclusions and loadings**: rather than refusing all high-risk applicants outright, insurers often offer cover with specific **exclusions** (e.g. "pre-existing back condition not covered") or **loadings** (a higher premium for the elevated risk). This allows a broader market while pricing risk more accurately.
- **Waiting periods**: new policies often exclude coverage for conditions that manifest in the first 30–90 days, preventing people from taking out insurance specifically because they know they're about to need it.

The key economic insight: each of these mechanisms is costly (time, medical tests, administration), and those costs must be weighed against the benefit of better risk classification. In markets with community rating (everyone pays the same premium regardless of health), underwriting is prohibited — the government essentially takes on the adverse-selection risk by mandating participation.

---

Q: Explain market for lemons better with the reference.

A: The **market for lemons** is the title of a 1970 paper by **George Akerlof** (*"The Market for Lemons: Quality Uncertainty and the Market Mechanism"*, Quarterly Journal of Economics). It won Akerlof the Nobel Prize in 2001 and is one of the most cited papers in economics. "Lemon" is American slang for a defective used car.

**The setup:**
Imagine a used car market with two types of cars: *peaches* (good cars, worth $10,000) and *lemons* (bad cars, worth $2,000). Sellers know which they have. Buyers don't — they can only observe that it's a used car.

**What happens:**

1. Buyers know the market has some mix of peaches and lemons. Say 50% of each. They're willing to pay the *average* expected value — perhaps $6,000.
2. At $6,000: owners of peaches (worth $10,000 to them) won't sell — $6,000 is below what their car is worth. Owners of lemons (worth $2,000) are delighted to sell.
3. So the market fills with lemons. Buyers, now knowing this, revise their expectation downward. Maybe they'll only pay $3,000.
4. At $3,000: even fewer good-car owners sell. The market unravels further toward all-lemons — possibly collapsing entirely if buyers won't pay enough to attract any seller worth trading with.

**The result:** a market that *could* support mutually beneficial trades (a buyer who values a peach at $12,000, a seller who'd accept $10,000) fails to do so — not because the goods don't exist, but because quality is unobservable. This is a form of market failure caused purely by information, not externalities or market power.

**Akerlof's broader point** was that the same logic applies far beyond used cars: health insurance (sick people seek it more), credit markets (risky borrowers want loans most), labour markets (bad workers are most eager to accept any job offer), and antiques/collectibles (sellers know provenance better than buyers). He showed that information asymmetry is a *structural* feature of many markets, not an exception.

**The solutions Akerlof identified** (warranties, certification, brand reputation, licensing) all work by credibly transmitting quality information to reduce the asymmetry — essentially ways to make lemons and peaches distinguishable.