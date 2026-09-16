# The UX model this skill reasons with

Use this vocabulary so two runs on the same code produce comparable reviews.

## Six properties

A screen is working for its user to the extent it provides:

- **Visibility** — the user can see current state and what is available
- **Predictability** — an action's result matches what the control implied
- **Feedback** — every action produces an observable response
- **Hierarchy** — one thing is clearly primary
- **Consistency** — the same idea looks and behaves the same everywhere
- **Recovery** — every failure has a way forward

Map each finding to one property. If a finding maps to none of them, it is
probably a code-quality finding wearing a UX costume — report it under Code.

## Four questions per journey step

At each step of a reconstructed user journey ask:

1. Where am I?
2. What can I do here?
3. What just happened?
4. What should I do next — and what if it failed?

A step that cannot answer 3 or 4 from the code is where the feedback and
recovery findings cluster.

## Cognitive load signals

These are shape facts, weakly correlated with load. Treat them as prompts for
inspection, never as verdicts:

- many simultaneous controls with no visual primary
- long unsegmented forms (few headings relative to fields)
- repeated information within one view
- dense navigation
- state changing without a triggering user action

## What "user-centred" can honestly be detected from code

Only observable implementation signals. The chain is:

```
user action -> request -> loading state? -> success state? -> error state? -> recovery action?
```

Present links are evidence the experience was considered. Absent links are
evidence of a *potential* gap, because the handling may live in a parent, a
hook, an interceptor, or an error boundary. Write findings that reflect that
uncertainty — "no observable error state in this file", not "errors are
unhandled".

## Confidence language

- 0.75 and above: "X, which risks Y"
- 0.5 to 0.75: "X — if Z isn't handled upstream, that risks Y. Worth checking."
- below 0.5: mention only as part of a cluster, or omit
