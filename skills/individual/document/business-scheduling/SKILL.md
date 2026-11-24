---
name: business-scheduling
description: Build a resource-bounded schedule and budget for business or office work from a confirmed requirement record. Use when the user needs a timeline with owners, a resource/budget allocation, or a what-fits-in-the-window decision for non-software work. Takes an interview/requirement record as input; produces a schedule plan and budget sheet with explicit assumptions.
---

# Business Scheduling and Resource Budget Workflow

This skill turns a confirmed requirement record (see business-interviewing) into a schedule and
a budget that fit the stated constraints — or an honest statement that they do not fit. It is
arithmetic plus explicit assumptions; it is not a project-management system and does not track
execution.

## When to Use

**Trigger conditions:**
- The user asks for a timeline, schedule, staffing plan, or budget for business/office work
- A fixed window or budget exists and the question is "what fits"
- Resource contention between work items must be resolved before commitment

**Inputs required:**
- A requirement record with work items, constraints, and cost drivers (from business-interviewing
  or provided directly). If absent, stop and run the interview skill first — do not invent inputs.

**Do not use when:**
- The work is software implementation planning with code/test steps — use writing-plans
- The user wants execution tracking rather than a one-shot schedule

## Workflow

1. **Load and check inputs.** Work items must each have a cost driver and an estimate basis.
   Items without a driver are listed as `unpriced` and excluded from totals.
2. **Resolve contention.** If two items need the same person/room/budget line in the same
   window, record the conflict and resolve it explicitly (defer, split, or escalate). Never
   silently double-book a resource.
3. **Sequence by dependency, not by preference.** Build the item graph from the record's
   dependency notes; items with no dependency may run in parallel only if the resource plan
   allows it.
4. **Compute the fit.** For the stated window: sum item durations along each dependency chain
   (critical path), compare with resource availability per period. If the work does not fit,
   output the shortfall and the top three options (cut scope, extend window, add resource with
   cost) — the decision belongs to the stakeholder, not this skill.
5. **Build the budget.** Map cost drivers to budget lines per period. Unpriced items appear as
   explicit `unpriced` lines; the budget total covers priced items only and says so.
6. **Record assumptions.** Every estimate carries its basis (who said it, from which record
   entry, or `assumption` with the reason). An estimate without a basis is not published.
7. **Hand off for acceptance.** The schedule plan and budget sheet go back to the stakeholder
   with the acceptance criteria from the requirement record attached.

## Honesty Rules

- If inputs are missing, say so and stop — a schedule built on invented inputs is fiction.
- The critical path and the resource plan must agree; if they cannot, the schedule does not
  close and that fact is the deliverable.
- Do not present an `unpriced` item inside a total. Totals include priced items only.
- Rounding is shown, not hidden: state the unit and the rounding rule used in sums.

## Output Artifacts

- `templates/schedule-plan.md` — items, dependencies, owners, timeline, critical path, fit verdict
- `templates/budget-sheet.md` — budget lines per period, unpriced items, assumptions

## Limits

- One-shot planning: no progress tracking, no automatic rescheduling.
- Arithmetic is transparent but assumes the input estimates; bad estimates in, bad schedule out.
- Calendar effects (holidays, part-time availability) must be entered as resource constraints;
  they are not detected automatically.
