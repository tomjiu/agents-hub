---
name: business-interviewing
description: Structured interview workflow for non-software business requirements, cost drivers, and acceptance expectations. Use when the user needs to clarify business needs with stakeholders before any planning or document work starts — for example interviews, requirement gathering for office/process/business tasks, or cost assessment interviews. Not for software requirement engineering (use writing-plans for that).
---

# Business Interviewing Workflow

This skill guides a structured interview with business stakeholders to surface requirements,
constraints, cost drivers, and acceptance expectations **before** any plan is written. It is a
method skill: it produces an interview record and a requirement summary, not a plan itself.
Hand off to a planning skill (business-scheduling or writing-plans) only after the summary is
confirmed by the stakeholder.

## When to Use

**Trigger conditions:**
- The user mentions interviewing stakeholders, gathering business requirements, or clarifying
  what a business/office/process task actually needs
- A task is described too vaguely to plan ("make our reporting better", "organize the event")
- Cost drivers or budget expectations are unclear before a commitment is made

**Do not use when:**
- The task is already well specified — go straight to planning
- The task is software requirement engineering — use writing-plans instead
- The stakeholder is not available; record assumptions explicitly instead of inventing answers

## Interview Loop

Run the loop below. Ask questions **one at a time**; never present a form with ten questions.

1. **Frame the goal.** Ask what outcome the stakeholder wants to see when the work is done, in
   their own words. Write it down verbatim — do not paraphrase into technical language yet.
2. **Surface the current state.** Ask how the work is done today and what hurts. Capture the
   pain points as quoted statements, each with the speaker's role.
3. **Bound the scope.** Ask what is explicitly out of scope this round. Record exclusions as
   first-class entries; scope creep usually enters through unstated exclusions.
4. **Identify constraints.** Walk the constraint checklist: deadline, budget ceiling, people
   available, compliance or approval steps, systems that must not change.
5. **Clarify cost drivers.** For each candidate work item, ask what makes it expensive
   (people-time, licenses, external services, approval latency). Record the driver, not just
   the amount — the driver survives repricing.
6. **Define acceptance.** Ask "how will you decide this succeeded?" Capture the top three
   checkable criteria and who judges them. If a criterion cannot be checked, mark it
   `unverifiable — needs an operational definition` and ask once for one.
7. **Read back.** Summarize the record back to the stakeholder and ask for corrections.
   Only a corrected-then-confirmed record may be handed off.

**Stop conditions:** the stakeholder ends the interview, answers stop producing new information
for two consecutive questions, or the time box agreed at the start is reached. Record which
stop condition fired and which sections remain thin.

## Honesty Rules

- Never invent a stakeholder answer. Missing answers are recorded as **open questions** with
  who should answer them.
- Distinguish verbatim stakeholder statements from interviewer interpretations; interpretations
  are marked `[interpretation]` and must be confirmed.
- Do not silently resolve contradictions between stakeholders. Record both statements and flag
  the conflict for explicit resolution.
- A cost figure without a driver is recorded as `unpriced` — it is not a budget.

## Output Artifacts

Produce the interview record using the templates in `templates/`:

- `templates/interview-record.md` — the structured record (verbatim quotes, constraints, open
  questions, acceptance criteria)
- `templates/cost-driver-worksheet.md` — cost drivers and budget expectations per work item

Hand off: requirement summary → planning skill (business-scheduling for schedule/budget,
writing-plans for software implementation plans). The summary must state open questions and
unresolved conflicts explicitly; a plan that hides them inherits them silently.

## Limits

- This is a method skill; it does not transcribe audio or attend meetings for you.
- Interview quality depends on stakeholder availability; record honestly what was not covered.
- Nothing here certifies business correctness — acceptance criteria belong to the stakeholder.
