# Planning

How work on Bochica is planned and tracked. Written for whoever picks up the next task — a
contributor or an AI agent.

| File                     | What it holds                                                    |
| ------------------------ | ---------------------------------------------------------------- |
| [ROADMAP.md](ROADMAP.md) | Milestones and the order of sprints. The big picture.            |
| [BACKLOG.md](BACKLOG.md) | Ideas and requests not yet scheduled into a sprint.              |
| [sprints/](sprints/)     | One file per sprint: goal, tasks with acceptance criteria, demo. |
| [../design/](../design/) | Design specs that several sprints build on (e.g. guardrails).    |

## Workflow

1. Work on the **active sprint** (marked in ROADMAP.md). Take the first unchecked task whose
   dependencies are done.
2. A task is done when every acceptance criterion holds **and** `bun run check` passes. Tick it
   (`- [x]`) in the sprint file in the same commit as the work.
3. If a task turns out bigger than expected, split it in the sprint file rather than leaving it
   half done. If it no longer makes sense, strike it and say why in one line.
4. When every task is ticked, run the sprint's demo, write the "Outcome" section (what shipped,
   what moved to a later sprint), mark the sprint done in ROADMAP.md and activate the next one.
5. New requests go to BACKLOG.md first. They are pulled into a sprint when it is planned, not
   inserted into the active one, unless they block it.

## Writing a sprint

Detail only the active sprint and the next one. Later sprints stay as a short outline in
ROADMAP.md until they are close, because plans change as the code grows.

Each task has an id (`S3-02`), a one-line title, the packages it touches, and acceptance
criteria that can be checked by running something or looking at the app — not "works well".
